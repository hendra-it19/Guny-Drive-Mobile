import * as BackgroundTask from "expo-background-task";
import * as Battery from "expo-battery";
import Constants from "expo-constants";
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
import { scanWatchedFolders } from "./watched-folders";

export const BACKGROUND_BACKUP_TASK = "GUNYDRIVE_AUTO_BACKUP";
const CHUNK_SIZE = 512 * 1024;
const PREF_RULES = "backup_rules_v1";

export type BackupFrequency = "on_open" | "every_6h" | "daily";

export type BackupRules = {
  enabled: boolean;
  paused: boolean;
  frequency: BackupFrequency;
  wifiOnly: boolean;
  chargingOnly: boolean;
  galleryKind: "all" | "photo" | "video";
  includeGallery: boolean;
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
  frequency: "daily",
  wifiOnly: true,
  chargingOnly: false,
  galleryKind: "all",
  includeGallery: true,
  includeInbox: true,
  lastRunAt: null,
  lastSuccessAt: null,
  lastSuccessCount: 0,
  lastDelayReason: null,
  lastDelayAction: null,
};

let activeRunLock = false;
let shouldYieldCheckpoint = false;

export async function loadBackupRules(): Promise<BackupRules> {
  const stored = await getPref<Partial<BackupRules>>(PREF_RULES, {});
  return { ...DEFAULT_BACKUP_RULES, ...stored };
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

    if (!rules.enabled || rules.paused || rules.frequency === "on_open") {
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_BACKUP_TASK);
      if (registered) {
        await BackgroundTask.unregisterTaskAsync(BACKGROUND_BACKUP_TASK);
      }
      return;
    }

    const minimumInterval = rules.frequency === "every_6h" ? 360 : 1440;
    await BackgroundTask.registerTaskAsync(BACKGROUND_BACKUP_TASK, {
      minimumInterval,
    });
  } catch {
    // Graceful no-op in restricted environments.
  }
}

export async function importDocumentToInbox(): Promise<QueueItem | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
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
    const src = new File(asset.uri);

    try {
      await src.copy(dest);
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

  const perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) {
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
      const info = await asset.getInfo();
      const revision = String(info.modificationTime ?? info.creationTime ?? 0);
      const exists = await hasSourceInQueue(info.id, revision);
      if (exists) continue;

      const uri = await asset.getUri({ version: MediaLibrary.AssetUriVersion.ORIGINAL });
      if (!uri) continue;

      let sizeBytes = 0;
      try {
        const f = new File(uri);
        sizeBytes = f.size;
      } catch {
        continue;
      }

      const id = Crypto.randomUUID();
      const now = Date.now();
      const mime = info.mediaType === MediaLibrary.MediaType.VIDEO ? "video/mp4" : "image/jpeg";

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

function acceptsGalleryType(item: QueueItem, rules: BackupRules): boolean {
  return rules.galleryKind === "all" || item.mimeType.startsWith(rules.galleryKind === "photo" ? "image/" : "video/");
}

export async function uploadLocalFileDirect(params: {
  api: GunyDriveApi;
  localUri: string;
  filename: string;
  mimeType: string;
  space: "regular" | "private";
  folderId?: string | null;
  vaultToken?: string | null;
  onProgress?: (offset: number, total: number) => void;
}): Promise<DriveFile> {
  const file = new File(params.localUri);
  const totalSize = file.size;
  const fullSha = (await file.digest("SHA-256")).toLowerCase();
  const idempotencyKey = Crypto.randomUUID();

  const started = await params.api.createUploadSession(
    {
      idempotency_key: idempotencyKey,
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
    return started.file;
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
  return completed.file;
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
  if (activeRunLock) {
    return { uploaded: 0, delayReason: null };
  }

  activeRunLock = true;
  try {
    return await processBackupCycle(onUpdate, respectRules, trigger);
  } finally {
    activeRunLock = false;
  }
}

async function processBackupCycle(
  onUpdate: (() => void) | undefined,
  respectRules: boolean,
  trigger: WorkerTriggerType,
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
      (!rules.enabled || (trigger === "os_background" && rules.frequency === "on_open"))
    ) {
      delayReason = "Penjadwalan otomatis tidak aktif";
      return { uploaded, delayReason };
    }
    const interval =
      rules.frequency === "daily" ? 86400000 : rules.frequency === "every_6h" ? 21600000 : 0;
    if (
      automatic &&
      rules.lastRunAt &&
      !rules.lastDelayReason &&
      Date.now() - rules.lastRunAt < interval
    ) {
      delayReason = "Belum waktunya backup berikutnya";
      return { uploaded, delayReason };
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

    let galleryAllowed = false;
    if (rules.includeGallery) {
      const scan = await scanGalleryIntoQueue(rules.galleryKind);
      galleryAllowed = scan.permissionStatus !== "denied";
      if (!galleryAllowed) {
        delayReason = "Akses foto perlu diperbarui";
        delayAction = "permissions";
        await setPref(PREF_RULES, {
          ...rules,
          lastDelayReason: delayReason,
          lastDelayAction: delayAction,
        });
        onUpdate?.();
      }
    }

    // Also scan experimental watched folders (T18 P1) if any are configured
    await scanWatchedFolders();

    const api = new GunyDriveApi(creds);
    const items = (await listQueueItems()).filter(
      (i) =>
        (i.sourceType !== "inbox" || rules.includeInbox) &&
        (i.sourceType !== "gallery" || (galleryAllowed && acceptsGalleryType(i, rules))) &&
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

      try {
        const file = new File(item.localUri);
        if (!file.exists) {
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
            idempotency_key: working.idempotencyKey,
            filename: working.filename,
            total_size_bytes: totalSize,
            expected_sha256: sha256,
            space: "regular",
            folder_id: working.folderId,
            mime_type: working.mimeType,
            source_asset_id: working.sourceAssetId,
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
              if (current.paused || (automatic && !current.enabled)) interruption = "Backup dijeda";
              else if (
                item.sourceType === "gallery" &&
                (!current.includeGallery || !acceptsGalleryType(item, current) || state.permissionStatus === "denied")
              )
                interruption = "Sumber galeri tidak tersedia";
              else if (item.sourceType === "inbox" && !current.includeInbox)
                interruption = "Kotak Masuk dinonaktifkan";
              else if (current.wifiOnly && state.networkType !== "wifi")
                interruption = "Menunggu Wi-Fi";
              else if (current.chargingOnly && !["full", "charging"].includes(state.batteryState))
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
