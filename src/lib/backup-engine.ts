import * as BackgroundTask from "expo-background-task";
import * as Battery from "expo-battery";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { ApiError, DriveFile, GunyDriveApi } from "./api";
import { loadCredentials } from "./credentials";
import {
  categorizeByMimeAndExt,
  copyUriToLocalFile,
  DeviceFileCategory,
  scanAllDeviceFiles,
  scanDeviceDelta,
} from "./device-files";
import { bufferToHex, formatShortTime } from "./format";
import {
  getPref,
  hasSourceInQueue,
  listQueueItems,
  listWorkerRuns,
  QueueItem,
  recordWorkerRun,
  setPref,
  upsertQueueItem,
  WorkerTriggerType,
} from "./storage";
import { createLocalEnqueuer } from "./local-backup";
import { scanWatchedFolders } from "./watched-folders";

export const BACKGROUND_BACKUP_TASK = "GUNYDRIVE_AUTO_BACKUP";
const CHUNK_SIZE = 1024 * 1024;
const PREF_RULES = "backup_rules_v1";

export type BackupFrequency = "on_open" | "every_6h" | "daily";

export type BackupRules = {
  enabled: boolean;
  paused: boolean;
  /** Google Photos-style instant auto-backup whenever a new device file is detected (default OFF). */
  autoBackupOnNewFile: boolean;
  /** Hour (0-23 local time) for daily background backup; defaults to 0 (00:00 / 12 midnight). */
  dailyBackupHour: number;
  frequency: BackupFrequency;
  wifiOnly: boolean;
  chargingOnly: boolean;
  galleryKind: "all" | "photo" | "video";
  includeGallery: boolean;
  includePhotos: boolean;
  includeVideos: boolean;
  includeDocuments: boolean;
  includeAudio: boolean;
  includeInbox: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastSuccessCount: number;
  lastDelayReason: string | null;
  lastDelayAction: "rules" | "permissions" | "storage" | "reconnect" | "retry" | null;
};

export const DEFAULT_BACKUP_RULES: BackupRules = {
  enabled: false,
  paused: false,
  autoBackupOnNewFile: false,
  dailyBackupHour: 0,
  frequency: "daily",
  wifiOnly: true,
  chargingOnly: false,
  galleryKind: "all",
  includeGallery: true,
  includePhotos: true,
  includeVideos: true,
  includeDocuments: true,
  includeAudio: true,
  includeInbox: true,
  lastRunAt: null,
  lastSuccessAt: null,
  lastSuccessCount: 0,
  lastDelayReason: null,
  lastDelayAction: null,
};

let activeRunLock = false;
export function backupCycleActive(): boolean { return activeRunLock; }
let currentCycle: Promise<{ uploaded: number; delayReason: string | null }> | undefined;
let shouldYieldCheckpoint = false;

function isExpoGoAndroid(): boolean {
  return Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export async function loadBackupRules(): Promise<BackupRules> {
  const stored = await getPref<Partial<BackupRules>>(PREF_RULES, {});
  const migratedPhotos =
    typeof stored.includePhotos === "boolean"
      ? stored.includePhotos
      : stored.includeGallery !== false && stored.galleryKind !== "video";
  const migratedVideos =
    typeof stored.includeVideos === "boolean"
      ? stored.includeVideos
      : stored.includeGallery !== false && stored.galleryKind !== "photo";

  const merged: BackupRules = {
    ...DEFAULT_BACKUP_RULES,
    ...stored,
    autoBackupOnNewFile:
      typeof stored.autoBackupOnNewFile === "boolean" ? stored.autoBackupOnNewFile : false,
    dailyBackupHour:
      typeof stored.dailyBackupHour === "number" && stored.dailyBackupHour >= 0 && stored.dailyBackupHour <= 23
        ? stored.dailyBackupHour
        : 0,
    includePhotos: migratedPhotos,
    includeVideos: migratedVideos,
    includeDocuments:
      typeof stored.includeDocuments === "boolean" ? stored.includeDocuments : true,
    includeAudio: typeof stored.includeAudio === "boolean" ? stored.includeAudio : true,
  };
  merged.includeGallery = merged.includePhotos || merged.includeVideos;
  merged.galleryKind =
    merged.includePhotos && merged.includeVideos
      ? "all"
      : merged.includeVideos
        ? "video"
        : "photo";

  // Clear stale permission-delay warnings when auto-backup is disabled or running inside Expo Go Android
  // (where Expo Go's Play Store manifest strips READ_MEDIA_* permissions).
  if (
    merged.lastDelayAction === "permissions" &&
    (!merged.enabled || isExpoGoAndroid())
  ) {
    const cleaned: BackupRules = {
      ...merged,
      lastDelayReason: null,
      lastDelayAction: null,
    };
    await setPref(PREF_RULES, cleaned).catch(() => undefined);
    return cleaned;
  }

  return merged;
}

export async function saveBackupRules(rules: BackupRules): Promise<void> {
  await setPref(PREF_RULES, rules);
  await syncBackgroundSchedule(rules);
}

export async function syncBackgroundSchedule(rules: BackupRules): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      return;
    }

    if (!rules.enabled || rules.paused || (rules.frequency === "on_open" && !rules.autoBackupOnNewFile)) {
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_BACKUP_TASK);
      if (registered) {
        await BackgroundTask.unregisterTaskAsync(BACKGROUND_BACKUP_TASK);
      }
      return;
    }

    // For daily midnight (00:00) schedule or Google-Photos auto-backup mode, wake up hourly so OS background
    // execution reliably catches the 00:00 midnight window and uploads newly captured files in background.
    const minimumInterval =
      rules.frequency === "daily" || rules.autoBackupOnNewFile ? 60 : 360;
    await BackgroundTask.registerTaskAsync(BACKGROUND_BACKUP_TASK, {
      minimumInterval,
    });
  } catch {
    // Graceful no-op in restricted environments.
  }
}

export async function importDocumentToInbox(): Promise<QueueItem | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    // On Android, keep content:// URI so Expo Go allows reading it without Missing 'READ' permission
    copyToCacheDirectory: Platform.OS === "ios",
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return null;
  }

  const asset = picked.assets[0];
  const filename = asset.name || "Berkas";
  const mimeType = asset.mimeType || "application/octet-stream";

  let localUri = asset.uri;
  let sizeBytes = asset.size ?? 0;
  let sha256: string | null = null;

  if (Platform.OS !== "web") {
    const inboxDir = new Directory(Paths.document, "kotak-masuk");
    if (!inboxDir.exists) {
      inboxDir.create({ intermediates: true, idempotent: true });
    }
    const id = Crypto.randomUUID();
    const safeName = filename.replace(/[/\\:*?"<>|]/g, "_");
    const dest = new File(inboxDir, `${id.slice(0, 8)}_${safeName}`);
    try {
      await copyUriToLocalFile(asset.uri, dest);
      sizeBytes = dest.size || sizeBytes;
      sha256 = (await dest.digest("SHA-256")).toLowerCase();
      localUri = dest.uri;
    } catch (err) {
      if (dest.exists) {
        dest.delete();
      }
      throw err;
    }

    const now = Date.now();
    const item: QueueItem = {
      id,
      idempotencyKey: id,
      sourceType: "inbox",
      sourceAssetId: `inbox:${id}`,
      sourceRevision: `${sizeBytes}:${now}`,
      localUri,
      filename,
      mimeType,
      sizeBytes,
      sha256,
      space: "regular",
      folderId: null,
      uploadSessionId: null,
      uploadedOffset: 0,
      status: "pending",
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      nextRetryAt: null,
      serverFileId: null,
      createdAt: now,
      updatedAt: now,
    };
    await upsertQueueItem(item);
    return item;
  }

  return null;
}

export async function scanGalleryIntoQueue(galleryKind: BackupRules["galleryKind"] = "all"): Promise<{
  added: number;
  permissionStatus: "granted" | "limited" | "denied";
}> {
  if (Platform.OS === "web") {
    return { added: 0, permissionStatus: "denied" };
  }

  const perm = await MediaLibrary.getPermissionsAsync().catch(() => null);
  if (!perm?.granted) {
    return { added: 0, permissionStatus: "denied" };
  }

  const access = perm.accessPrivileges === "limited" ? "limited" : "granted";
  const cursorKey = "gallery_scan_offset_v1_" + galleryKind;
  const types = [];
  if (galleryKind !== "video") types.push(MediaLibrary.MediaType.IMAGE);
  if (galleryKind !== "photo") types.push(MediaLibrary.MediaType.VIDEO);
  let offset = await getPref<number>(cursorKey, 0);
  let added = 0;
  do {
    const assets = await new MediaLibrary.Query()
      .within(MediaLibrary.AssetField.MEDIA_TYPE, types)
      .offset(offset)
      .limit(50)
      .exe();

    for (const asset of assets) {
      const revision = String(await asset.getModificationTime() ?? await asset.getCreationTime() ?? 0);
      const exists = await hasSourceInQueue(asset.id, revision);
      if (exists) continue;

      const info = await asset.getInfo();
      const uri = await asset.getUri({ version: MediaLibrary.AssetUriVersion.ORIGINAL });
      if (!uri) continue;

      let sizeBytes = 0;
      let mediaMime = "";
      try {
        const f = new File(uri);
        sizeBytes = f.size;
        mediaMime = f.type;
      } catch {
        continue;
      }

      const id = Crypto.randomUUID();
      const now = Date.now();
      const mime = mediaMime || (info.mediaType === MediaLibrary.MediaType.VIDEO ? "video/mp4" : "image/jpeg");

      await upsertQueueItem({
        id,
        idempotencyKey: `gal-${info.id}-${revision}`,
        sourceType: "gallery",
        sourceAssetId: info.id,
        sourceRevision: revision,
        localUri: uri,
        filename: info.filename || `IMG_${info.id}.jpg`,
        mimeType: mime,
        sizeBytes,
        sha256: null,
        space: "regular",
        folderId: null,
        uploadSessionId: null,
        uploadedOffset: 0,
        status: "pending",
        errorCode: null,
        errorMessage: null,
        attempts: 0,
        nextRetryAt: null,
        serverFileId: null,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }

    offset = assets.length < 50 ? 0 : offset + assets.length;
    await setPref(cursorKey, offset);
  } while (offset > 0 && !shouldYieldCheckpoint);
  return { added, permissionStatus: access };
}

function isCategoryEnabledByRules(cat: DeviceFileCategory, rules: BackupRules): boolean {
  if (cat === "images") return rules.includePhotos;
  if (cat === "videos") return rules.includeVideos;
  if (cat === "audio") return rules.includeAudio;
  return rules.includeDocuments;
}

function acceptsQueueItemByRules(item: QueueItem, rules: BackupRules): boolean {
  if (item.sourceType === "manual") return true;
  if (item.sourceType === "inbox") return rules.includeInbox;
  const cat = categorizeByMimeAndExt(item.filename, item.mimeType);
  return isCategoryEnabledByRules(cat, rules);
}

/**
 * Scans device photos, videos, documents, and audio directly from original URIs
 * (WITHOUT copying bytes into local app storage) according to BackupRules.
 */
export async function scanDeviceCategoriesIntoQueue(rules: BackupRules, includeWatchedFolders = true): Promise<{
  added: number;
  permissionStatus: "granted" | "limited" | "denied";
}> {
  if (Platform.OS === "web") {
    return { added: 0, permissionStatus: "denied" };
  }

  const anyEnabled =
    rules.includePhotos || rules.includeVideos || rules.includeDocuments || rules.includeAudio;
  if (!anyEnabled) {
    return { added: 0, permissionStatus: "granted" };
  }

  const scan = await scanAllDeviceFiles(includeWatchedFolders);
  const enqueue = await createLocalEnqueuer();
  let added = 0;

  for (const item of scan.items) {
    if (shouldYieldCheckpoint) break;
    if (item.sourceKind === "cloud_synced" || !item.uri) continue;
    if (!isCategoryEnabledByRules(item.category, rules)) continue;

    if (await enqueue({
      uri: item.storageUri ?? item.uri, name: item.name, sizeBytes: item.sizeBytes,
      mtime: item.modifiedAt, mimeType: item.mimeType,
    }, item.assetId ? "gallery" : "watched_folder", item.assetId ?? item.uri)) added++;
  }

  const permissionStatus: "granted" | "limited" | "denied" =
    scan.mediaPermission === "all"
      ? "granted"
      : scan.mediaPermission === "limited"
        ? "limited"
        : scan.items.length > 0
          ? "granted"
          : "denied";

  return { added, permissionStatus };
}

export async function uploadLocalFileDirect(params: {
  api: GunyDriveApi;
  localUri: string;
  fallbackUri?: string;
  sourceAssetId?: string;
  sourceModifiedAt?: number;
  filename: string;
  mimeType: string;
  space: "regular" | "private";
  folderId?: string | null;
  vaultToken?: string | null;
  existingServerFiles?: DriveFile[];
  onProgress?: (offset: number, total: number) => void;
}): Promise<DriveFile> {
  let stagedTempFile: File | null = null;
  let effectiveUri = params.localUri;
  if (Platform.OS !== "web" && effectiveUri.startsWith("ph://")) {
    effectiveUri = await new MediaLibrary.Asset(effectiveUri).getUri();
  }

  let file = new File(effectiveUri);
  if (
    Platform.OS !== "web" &&
    !effectiveUri.startsWith("content://") &&
    !file.exists &&
    params.fallbackUri
  ) {
    effectiveUri = params.fallbackUri;
    file = new File(effectiveUri);
  }

  const record = params.space === 'regular' && !params.folderId
    ? await createLocalEnqueuer().catch(() => null) : null;
  const sourceModifiedAt = params.sourceModifiedAt ?? (record ? file.lastModified ?? 0 : 0);
  async function remember(serverFile: DriveFile) {
    if (record) {
      await record(
        {
          uri: params.localUri,
          name: params.filename,
          mtime: sourceModifiedAt,
          mimeType: params.mimeType,
          sizeBytes: serverFile.size_bytes,
        },
        'manual',
        params.sourceAssetId ?? params.localUri,
        serverFile,
      ).catch(() => undefined);
    }
    return serverFile;
  }

  // Stage Android content:// URIs ONLY temporarily into cache during chunk transfer,
  // and ALWAYS delete the temp file in finally {} so zero duplicate storage accumulates.
  if (Platform.OS !== "web" && effectiveUri.startsWith("content://")) {
    const tempDir = new Directory(Paths.cache, "upload-stage");
    if (!tempDir.exists) {
      tempDir.create({ intermediates: true, idempotent: true });
    }
    stagedTempFile = new File(tempDir, `stage_${Crypto.randomUUID()}.bin`);
    try {
      await copyUriToLocalFile(effectiveUri, stagedTempFile);
    } catch (error) {
      if (stagedTempFile.exists) stagedTempFile.delete();
      throw error;
    }
    file = stagedTempFile;
  }

  try {
    const totalSize = file.size;
    const fullSha = (await file.digest("SHA-256")).toLowerCase();

    // Prevent uploading an exact duplicate file (same SHA-256 + filename in same space & folder)
    if (params.existingServerFiles && params.existingServerFiles.length > 0) {
      const dup = params.existingServerFiles.find(
        (sf) =>
          sf.space === params.space &&
          (sf.folder_id ?? null) === (params.folderId ?? null) &&
          sf.sha256.toLowerCase() === fullSha &&
          sf.name.toLowerCase() === params.filename.toLowerCase(),
      );
      if (dup) {
        return remember(dup);
      }
    }

    const idempotencyKey = `direct-${params.space}-${params.folderId ?? "root"}-${fullSha.slice(0, 24)}-${totalSize}`;

    const started = await params.api.createUploadSession(
      {
        idempotency_key: idempotencyKey,
        deduplicate: true,
        filename: params.filename,
        total_size_bytes: totalSize,
        expected_sha256: fullSha,
        space: params.space,
        folder_id: params.folderId ?? null,
        mime_type: params.mimeType,
      },
      params.vaultToken,
    );

    if (started.file) {
      return remember(started.file);
    }
    if (!started.upload) {
      throw new ApiError("upload_skipped", "Berkas sudah tercatat di server.", 200);
    }

    let offset = started.upload.received_offset;
    if (totalSize > 0) {
      const handle = file.open(FileMode.ReadOnly);
      try {
        while (offset < totalSize) {
          handle.offset = offset;
          const len = Math.min(CHUNK_SIZE, totalSize - offset);
          const chunk = await handle.readBytes(len);
          if (chunk.byteLength === 0) throw new Error("Berkas sumber berakhir sebelum ukuran yang dicatat.");

          const chunkHashBuf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, chunk);
          const chunkHex = bufferToHex(chunkHashBuf);

          const patched = await params.api.uploadChunk(
            started.upload.id,
            offset,
            chunk,
            chunkHex,
            params.vaultToken,
          );
          offset = patched.upload.received_offset;
          params.onProgress?.(offset, totalSize);
        }
      } finally {
        handle.close();
      }
    }

    const completed = await params.api.completeUpload(started.upload.id, params.vaultToken);
    // Record recent successful backup and clear stale permission/retry delay banners
    try {
      const currentRules = await loadBackupRules();
      const shouldClearDelay =
        currentRules.lastDelayAction === "permissions" ||
        currentRules.lastDelayAction === "retry";
      await setPref(PREF_RULES, {
        ...currentRules,
        lastSuccessAt: Date.now(),
        lastSuccessCount: (currentRules.lastSuccessCount ?? 0) + 1,
        ...(shouldClearDelay ? { lastDelayReason: null, lastDelayAction: null } : {}),
      });
    } catch {
      // Ignore non-critical pref update error
    }
    return remember(completed.file);
  } finally {
    if (stagedTempFile?.exists) {
      try {
        stagedTempFile.delete();
      } catch {
        // Ignore temp cleanup error
      }
    }
  }
}

async function readDeviceSnapshot(): Promise<{
  networkType: string;
  batteryState: string;
  permissionStatus: string;
}> {
  if (Platform.OS === "web") {
    return { networkType: "web", batteryState: "unknown", permissionStatus: "web" };
  }

  const [net, bat, perm] = await Promise.all([
    Network.getNetworkStateAsync().catch(() => null),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    MediaLibrary.getPermissionsAsync().catch(() => null),
  ]);

  const networkType = !net?.isConnected
    ? "offline"
    : net.type === Network.NetworkStateType.WIFI
      ? "wifi"
      : String(net.type ?? "cellular").toLowerCase();

  const batteryState =
    bat === Battery.BatteryState.CHARGING
      ? "charging"
      : bat === Battery.BatteryState.FULL
        ? "full"
        : bat === Battery.BatteryState.UNPLUGGED
          ? "unplugged"
          : "unknown";

  const permissionStatus = !perm
    ? "unknown"
    : !perm.granted
      ? "denied"
      : perm.accessPrivileges === "limited"
        ? "limited"
        : "granted";

  return { networkType, batteryState, permissionStatus };
}

export async function runBackupCycle(
  onUpdate?: () => void,
  respectRules = true,
  trigger: WorkerTriggerType = "manual",
): Promise<{ uploaded: number; delayReason: string | null }> {
  if (currentCycle) return currentCycle;
  activeRunLock = true;
  currentCycle = processBackupCycle(onUpdate, respectRules, trigger, true).finally(() => {
    activeRunLock = false;
    currentCycle = undefined;
  });
  return currentCycle;
}

export async function transferQueuedFiles(onUpdate?: () => void, respectRules = false) {
  while (currentCycle) await currentCycle;
  activeRunLock = true;
  currentCycle = processBackupCycle(onUpdate, respectRules, 'manual', false).finally(() => {
    activeRunLock = false;
    currentCycle = undefined;
  });
  return currentCycle;
}

/**
 * Google-Photos-style lightweight background backup triggered when the OS reports
 * newly captured/added device media. Runs a fast delta scan (~20ms) instead of
 * rescanning the entire phone, enqueues only newly detected files matching rules,
 * and uploads them immediately in the background.
 */
export async function runInstantNewFileBackup(
  onUpdate?: () => void,
): Promise<{ uploaded: number; added: number; delayReason: string | null }> {
  const rules = await loadBackupRules();
  if (!rules.enabled || rules.paused || !rules.autoBackupOnNewFile) {
    return { uploaded: 0, added: 0, delayReason: null };
  }
  const creds = await loadCredentials();
  if (!creds) {
    return { uploaded: 0, added: 0, delayReason: "Server belum terhubung" };
  }

  const delta = await scanDeviceDelta();
  if (delta.addedItems.length === 0) {
    return { uploaded: 0, added: 0, delayReason: null };
  }

  const enqueue = await createLocalEnqueuer();
  let added = 0;
  for (const item of delta.addedItems) {
    if (item.sourceKind === "cloud_synced" || !item.uri) continue;
    if (!isCategoryEnabledByRules(item.category, rules)) continue;
    if (
      await enqueue(
        {
          uri: item.storageUri ?? item.uri,
          name: item.name,
          sizeBytes: item.sizeBytes,
          mtime: item.modifiedAt,
          mimeType: item.mimeType,
        },
        item.assetId ? "gallery" : "watched_folder",
        item.assetId ?? item.uri,
      )
    ) {
      added++;
    }
  }

  if (added === 0) {
    return { uploaded: 0, added: 0, delayReason: null };
  }

  onUpdate?.();
  const transfer = await transferQueuedFiles(onUpdate, true);
  return { uploaded: transfer.uploaded, added, delayReason: transfer.delayReason };
}

async function processBackupCycle(
  onUpdate: (() => void) | undefined,
  respectRules: boolean,
  trigger: WorkerTriggerType,
  discover: boolean,
) {
  shouldYieldCheckpoint = false;
  const startedAt = Date.now();
  let lastCheckpointOffset = 0;
  let uploaded = 0;
  let delayReason: string | null = null;
  let delayAction: BackupRules["lastDelayAction"] = null;
  const automatic = trigger === "os_background" || trigger === "app_open";
  const snap = await readDeviceSnapshot();

  try {
    const rules = await loadBackupRules();
    if (
      automatic &&
      (!rules.enabled || (trigger === "os_background" && rules.frequency === "on_open" && !rules.autoBackupOnNewFile))
    ) {
      delayReason = "Penjadwalan otomatis tidak aktif";
      return { uploaded, delayReason };
    }
    if (automatic && rules.frequency === "daily") {
      // Daily background backup runs once per day after local midnight (00:00 / dailyBackupHour)
      const nowDate = new Date();
      const todayMidnightMs = new Date(
        nowDate.getFullYear(),
        nowDate.getMonth(),
        nowDate.getDate(),
        rules.dailyBackupHour ?? 0,
        0,
        0,
        0,
      ).getTime();
      const alreadyRanToday =
        rules.lastRunAt !== null && rules.lastRunAt >= todayMidnightMs && !rules.lastDelayReason;
      if (alreadyRanToday && !(trigger === "app_open" && rules.autoBackupOnNewFile)) {
        delayReason = "Backup harian jam 00:00 hari ini sudah selesai";
        return { uploaded, delayReason };
      }
    } else if (automatic) {
      const interval = rules.frequency === "every_6h" ? 21600000 : 0;
      if (
        rules.lastRunAt &&
        !rules.lastDelayReason &&
        Date.now() - rules.lastRunAt < interval &&
        !(trigger === "app_open" && rules.autoBackupOnNewFile)
      ) {
        delayReason = "Belum waktunya backup berikutnya";
        return { uploaded, delayReason };
      }
    }
    const creds = await loadCredentials();
    if (!creds) {
      delayReason = "Server belum terhubung";
      return { uploaded: 0, delayReason };
    }

    if (respectRules && rules.paused) {
      delayReason = "Backup dijeda oleh pengguna";
      return { uploaded: 0, delayReason };
    }

    if (respectRules && Platform.OS !== "web") {
      if (snap.networkType === "offline") {
        delayReason = "Menunggu koneksi jaringan";
        delayAction = "rules";
        await setPref(PREF_RULES, {
          ...rules,
          lastDelayReason: delayReason,
          lastDelayAction: delayAction,
        });
        onUpdate?.();
        return { uploaded: 0, delayReason };
      }

      if (rules.wifiOnly && snap.networkType !== "wifi") {
        const pendingCount = (await listQueueItems()).filter(
          (i) => i.status === "pending" || i.status === "uploading",
        ).length;
        delayReason = `Menunggu Wi-Fi · ${pendingCount} berkas`;
        delayAction = "rules";
        await setPref(PREF_RULES, {
          ...rules,
          lastDelayReason: delayReason,
          lastDelayAction: delayAction,
        });
        onUpdate?.();
        return { uploaded: 0, delayReason };
      }

      if (rules.chargingOnly && snap.batteryState !== "charging" && snap.batteryState !== "full") {
        delayReason = "Menunggu perangkat diisi daya";
        delayAction = "rules";
        await setPref(PREF_RULES, {
          ...rules,
          lastDelayReason: delayReason,
          lastDelayAction: delayAction,
        });
        onUpdate?.();
        return { uploaded: 0, delayReason };
      }
    }

    let deviceAccessAllowed = true;
    if (discover) {
      // Also scan user-authorized device folders (SAF Android / Files iOS) filtered by enabled categories
      const watchedScan = await scanWatchedFolders({
        includePhotos: rules.includePhotos,
        includeVideos: rules.includeVideos,
        includeDocuments: rules.includeDocuments,
        includeAudio: rules.includeAudio,
      });

      const wantsDeviceBackup =
        rules.includePhotos || rules.includeVideos || rules.includeDocuments || rules.includeAudio;
      deviceAccessAllowed = false;
      if (wantsDeviceBackup) {
        const scan = await scanDeviceCategoriesIntoQueue(rules, false);
        deviceAccessAllowed = scan.permissionStatus !== "denied" || watchedScan.activeFolderCount > 0;
        if (!deviceAccessAllowed && !isExpoGoAndroid()) {
          delayReason = "Akses foto/folder perangkat perlu diberikan";
          delayAction = "permissions";
          await setPref(PREF_RULES, {
            ...rules,
            lastDelayReason: delayReason,
            lastDelayAction: delayAction,
          });
          onUpdate?.();
        }
      }
    }

    const api = new GunyDriveApi(creds);
    const items = (await listQueueItems()).filter(
      (i) =>
        acceptsQueueItemByRules(i, rules) &&
        (i.sourceType !== "gallery" || deviceAccessAllowed) &&
        (i.status === "pending" || i.status === "uploading" || i.status === "failed") &&
        (i.nextRetryAt === null || i.nextRetryAt <= Date.now()),
    );

    transferLoop: for (const item of items) {
      let checkpoint = item;
      const latestRules = await loadBackupRules();
      if ((respectRules && latestRules.paused) || shouldYieldCheckpoint) {
        delayReason = shouldYieldCheckpoint
          ? "Waktu kerja latar OS habis (checkpoint disimpan)"
          : "Backup dijeda";
        delayAction = "rules";
        break;
      }

      if (respectRules && Platform.OS !== "web" && latestRules.wifiOnly) {
        const currentNet = await Network.getNetworkStateAsync().catch(() => null);
        if (!currentNet?.isConnected || currentNet.type !== Network.NetworkStateType.WIFI) {
          delayReason = "Wi-Fi terputus di tengah transfer (checkpoint disimpan)";
          delayAction = "rules";
          break;
        }
      }

      let stagedQueueFile: File | null = null;
      try {
        const inputUri = item.localUri.startsWith('ph://') ? await new MediaLibrary.Asset(item.localUri).getUri() : item.localUri;
        let file = new File(inputUri);
        if (Platform.OS !== "web" && item.localUri.startsWith("content://")) {
          const tempDir = new Directory(Paths.cache, "upload-stage");
          if (!tempDir.exists) {
            tempDir.create({ intermediates: true, idempotent: true });
          }
          stagedQueueFile = new File(tempDir, `qstage_${Crypto.randomUUID()}.bin`);
          await copyUriToLocalFile(item.localUri, stagedQueueFile);
          file = stagedQueueFile;
        } else if (!file.exists) {
          await upsertQueueItem({
            ...item,
            status: "failed",
            errorCode: "source_missing",
            errorMessage: "Berkas sumber lokal tidak lagi ditemukan.",
            updatedAt: Date.now(),
          });
          onUpdate?.();
          continue;
        }

        const sha256 = item.sha256 ?? (await file.digest("SHA-256")).toLowerCase();
        const totalSize = file.size;

        const working: QueueItem = {
          ...item,
          sha256,
          sizeBytes: totalSize,
          status: "uploading",
          errorCode: null,
          errorMessage: null,
          updatedAt: Date.now(),
        };
        checkpoint = working;
        await upsertQueueItem(working);
        onUpdate?.();

        let sessionId = working.uploadSessionId;
        let offset = working.uploadedOffset;

        if (sessionId) {
          try {
            const st = await api.getUploadSession(sessionId);
            offset = st.upload.received_offset;
          } catch {
            sessionId = null;
            offset = 0;
          }
        }

        if (!sessionId) {
          const started = await api.createUploadSession({
            idempotency_key: `direct-regular-${working.folderId ?? "root"}-${sha256.slice(0, 24)}-${totalSize}`,
            filename: working.filename,
            total_size_bytes: totalSize,
            expected_sha256: sha256,
            deduplicate: true,
            space: "regular",
            folder_id: working.folderId,
            mime_type: working.mimeType,
            source_asset_id: working.sourceAssetId && working.sourceAssetId.length > 255 ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, working.sourceAssetId) : working.sourceAssetId,
            source_revision: working.sourceRevision,
            auto_backup: working.sourceType !== "manual",
          });

          if (started.skipped) {
            await upsertQueueItem({
              ...working,
              status: "skipped",
              errorMessage: `Dilewati (${started.reason ?? "sudah ditangani"})`,
              updatedAt: Date.now(),
            });
            onUpdate?.();
            continue;
          }

          if (started.file) {
            await upsertQueueItem({
              ...working,
              status: "completed",
              uploadedOffset: totalSize,
              serverFileId: started.file.id,
              updatedAt: Date.now(),
            });
            lastCheckpointOffset = totalSize;
            uploaded++;
            onUpdate?.();
            continue;
          }

          if (started.upload) {
            sessionId = started.upload.id;
            offset = started.upload.received_offset;
            working.uploadSessionId = sessionId;
            working.uploadedOffset = offset;
            await upsertQueueItem(working);
          }
        }

        if (sessionId && totalSize > 0) {
          const handle = file.open(FileMode.ReadOnly);
          try {
            while (offset < totalSize) {
              if (shouldYieldCheckpoint) {
                delayReason = "Waktu kerja latar OS habis (checkpoint disimpan)";
                delayAction = "rules";
                break;
              }
              const current = await loadBackupRules();
              const state = await readDeviceSnapshot();
              let interruption: string | null = null;
              if (respectRules && (current.paused || (automatic && !current.enabled))) interruption = "Backup dijeda";
              else if (respectRules && !acceptsQueueItemByRules(item, current))
                interruption = "Kategori berkas dinonaktifkan";
              else if (respectRules && item.sourceType === "gallery" && state.permissionStatus === "denied" && !isExpoGoAndroid())
                interruption = "Sumber galeri tidak tersedia";
              else if (respectRules && current.wifiOnly && state.networkType !== "wifi")
                interruption = "Menunggu Wi-Fi";
              else if (respectRules && current.chargingOnly && !["full", "charging"].includes(state.batteryState))
                interruption = "Menunggu perangkat diisi daya";
              else if (state.networkType === "offline") interruption = "Menunggu koneksi jaringan";
              else if (shouldYieldCheckpoint) interruption = "Waktu kerja latar habis";
              if (interruption) {
                delayReason = interruption;
                delayAction = "rules";
                break transferLoop;
              }
              handle.offset = offset;
              const len = Math.min(CHUNK_SIZE, totalSize - offset);
              const chunk = await handle.readBytes(len);
              if (chunk.byteLength === 0) throw new Error("Berkas sumber berakhir sebelum ukuran yang dicatat.");

              const chunkHash = bufferToHex(
                await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, chunk),
              );

              const res = await api.uploadChunk(sessionId, offset, chunk, chunkHash);
              offset = res.upload.received_offset;
              lastCheckpointOffset = offset;
              working.uploadedOffset = offset;
              working.updatedAt = Date.now();
              await upsertQueueItem(working);
              onUpdate?.();
            }
          } finally {
            handle.close();
          }
        }

        if (shouldYieldCheckpoint) {
          break;
        }

        if (sessionId) {
          const done = await api.completeUpload(sessionId);
          await upsertQueueItem({
            ...working,
            status: "completed",
            uploadedOffset: totalSize,
            serverFileId: done.file.id,
            updatedAt: Date.now(),
          });
          // Delete temporary inbox copy after successful cloud backup so local storage never bloats
          if (item.sourceType === "inbox" && Platform.OS !== "web") {
            try {
              const inboxCopy = new File(item.localUri);
              if (inboxCopy.exists) inboxCopy.delete();
            } catch {
              // Ignore cleanup error
            }
          }
          lastCheckpointOffset = totalSize;
          uploaded++;
          onUpdate?.();
        }
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        const attempts = item.attempts + 1;
        const backoffMs =
          apiErr?.retryAfterSeconds !== undefined
            ? apiErr.retryAfterSeconds * 1000
            : Math.min(3600_000, 15_000 * 2 ** Math.min(attempts, 6));

        await upsertQueueItem({
          ...checkpoint,
          status: "failed",
          attempts,
          nextRetryAt: Date.now() + backoffMs,
          errorCode: apiErr?.code ?? "network_error",
          errorMessage: apiErr?.message ?? "Transfer terputus sementara.",
          updatedAt: Date.now(),
        });

        if (apiErr?.code === "quota_exceeded") {
          delayReason = "Penyimpanan penuh · unggahan tertunda";
          delayAction = "storage";
          break;
        }
        if (apiErr?.code === "token_revoked" || apiErr?.code === "token_expired") {
          delayReason = "Akses perangkat dicabut · Hubungkan ulang";
          delayAction = "reconnect";
          break;
        }

        delayReason = "1 unggahan gagal sementara";
        delayAction = "retry";
        onUpdate?.();
      } finally {
        if (stagedQueueFile?.exists) {
          try {
            stagedQueueFile.delete();
          } catch {
            // Ignore temp cleanup
          }
        }
      }
    }

    const finalRules: BackupRules = {
      ...(await loadBackupRules()),
      lastRunAt: Date.now(),
      lastSuccessAt: uploaded > 0 ? Date.now() : rules.lastSuccessAt,
      lastSuccessCount: uploaded > 0 ? uploaded : rules.lastSuccessCount,
      lastDelayReason: delayReason,
      lastDelayAction: delayAction,
    };
    await setPref(PREF_RULES, finalRules);
    onUpdate?.();

    return { uploaded, delayReason };
  } finally {
    const remaining = (await listQueueItems()).filter(
      (i) => i.status === "pending" || i.status === "uploading",
    ).length;

    await recordWorkerRun({
      id: Crypto.randomUUID(),
      trigger,
      startedAt,
      finishedAt: Date.now(),
      networkType: snap.networkType,
      batteryState: snap.batteryState,
      permissionStatus: snap.permissionStatus,
      uploadedCount: uploaded,
      pendingCount: remaining,
      lastCheckpointOffset,
      delayReason,
    });
  }
}

export async function triggerDebugWorker(onUpdate?: () => void): Promise<string> {
  const result = await runBackupCycle(onUpdate, true, "debug");
  return result.delayReason
    ? `Pemicu debug selesai dengan jeda: ${result.delayReason}`
    : `Pemicu debug selesai · ${result.uploaded} berkas terunggah.`;
}

export async function buildDiagnosticReportMarkdown(): Promise<string> {
  const [rules, runs, queue] = await Promise.all([
    loadBackupRules(),
    listWorkerRuns(20),
    listQueueItems(),
  ]);

  const debugRuns = runs.filter((r) => r.trigger === "debug");
  const osRuns = runs.filter((r) => r.trigger === "os_background" || r.trigger === "app_open");
  const pending = queue.filter((i) => i.status === "pending" || i.status === "uploading").length;
  const completed = queue.filter((i) => i.status === "completed").length;

  const lines = [
    "# Laporan Uji Perangkat T02 / T10 GunyDrive",
    `- Platform: ${Platform.OS} ${String(Platform.Version)}`,
    `- Perangkat: ${Device.modelName ?? "Tidak diketahui"} (${Device.osName ?? Platform.OS} ${Device.osVersion ?? ""})`,
    `- Versi Aplikasi: ${Constants.expoConfig?.version ?? "1.0.0"}`,
    `- Aturan Backup: aktif=${String(rules.enabled)}, frekuensi=${rules.frequency}, wifiOnly=${String(rules.wifiOnly)}, chargingOnly=${String(rules.chargingOnly)}`,
    `- Antrean SQLite: ${completed} selesai, ${pending} tertunda`,
    "",
    "## Observasi Penjadwalan OS & Pembukaan Aplikasi",
    ...(osRuns.length === 0
      ? ["- Belum ada eksekusi os_background / app_open tercatat."]
      : osRuns.map(
          (r) =>
            `- [${r.trigger}] ${formatShortTime(r.startedAt)} | net=${r.networkType} bat=${r.batteryState} izin=${r.permissionStatus} | unggah=${r.uploadedCount} sisa=${r.pendingCount} checkpoint=${r.lastCheckpointOffset}B | tunda=${r.delayReason ?? "-"}`,
        )),
    "",
    "## Hasil Pemicu Debug (terpisah dari jadwal OS)",
    ...(debugRuns.length === 0
      ? ["- Belum ada pemicu debug tercatat."]
      : debugRuns.map(
          (r) =>
            `- [debug] ${formatShortTime(r.startedAt)} | net=${r.networkType} bat=${r.batteryState} izin=${r.permissionStatus} | unggah=${r.uploadedCount} sisa=${r.pendingCount} checkpoint=${r.lastCheckpointOffset}B | tunda=${r.delayReason ?? "-"}`,
        )),
  ];

  return lines.join("\n");
}

if (Platform.OS !== "web") {
  BackgroundTask.addExpirationListener(() => {
    shouldYieldCheckpoint = true;
  });

  TaskManager.defineTask(BACKGROUND_BACKUP_TASK, async () => {
    try {
      await runBackupCycle(undefined, true, "os_background");
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
