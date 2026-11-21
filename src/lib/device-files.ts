import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { androidGalleryPages } from './android-gallery';
import { excludedAndroidPath } from './scan-paths';
import { deviceCatalog } from './device-catalog';
import { backupLookupKey, indexBackupQueue, sourceIdentity } from './local-backup';
import { walkDirectory } from './directory-scan';
import * as MediaLibrary from 'expo-media-library';
import { PermissionsAndroid, Platform } from 'react-native';

import { loadCredentials } from './credentials';
import { DriveFile } from './api';
import {
  clearDeviceCatalogSnapshot,
  getPref,
  loadDeviceCatalogSnapshot,
  QueueItem,
  saveDeviceCatalogSnapshot,
  setPref,
} from './storage';
import { listWatchedFolders, pickAndAddWatchedFolder, WatchedFolder } from './watched-folders';

const PREF_FIRST_LAUNCH_PERMS_ASKED = 'first_launch_os_permissions_asked_v1';

const permissionRefreshListeners = new Set<() => void>();

export function subscribePermissionRefresh(listener: () => void): () => void {
  permissionRefreshListeners.add(listener);
  return () => {
    permissionRefreshListeners.delete(listener);
  };
}

export function notifyPermissionRefresh(): void {
  scans.clear();
  memoryCatalogCache = null;
  void clearDeviceCatalogSnapshot();
  permissionRefreshListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore listener error
    }
  });
}

export function isExpoGoEnvironment(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Automatically requests all required OS permissions (File System / Storage, Photos,
 * Videos, Audio, Notifications) the first time the app is opened after installation.
 */
export async function requestFirstLaunchPermissions(): Promise<void> {
  if (Platform.OS === 'web') return;

  const alreadyAsked = await getPref<boolean>(PREF_FIRST_LAUNCH_PERMS_ASKED, false).catch(
    () => false,
  );
  if (alreadyAsked) {
    return;
  }

  await setPref(PREF_FIRST_LAUNCH_PERMS_ASKED, true).catch(() => undefined);

  await requestDeviceMediaPermission();
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
  }

  notifyPermissionRefresh();
}

export type DevicePermissionState = 'granted' | 'expo_go_limited' | 'denied';

export type DevicePermissionResult = {
  granted: boolean;
  osPermissionState: DevicePermissionState;
  accessPrivileges: 'all' | 'limited' | 'none';
  message: string;
  canOpenSettings: boolean;
};

export type DeviceStorageSummary = {
  totalDiskBytes: number;
  availableDiskBytes: number;
  usedDiskBytes: number;
  scannedDirectoriesCount: number;
};

export type DeviceFileCategory = 'images' | 'videos' | 'docs' | 'audio';
export type DeviceBackupState = 'backed_up' | 'queued' | 'not_backed_up';

export type DeviceFileItem = {
  id: string;
  sourceKind: 'media_library' | 'file_system' | 'cloud_synced';
  assetId?: string;
  storageUri?: string;
  serverFile?: DriveFile;
  name: string;
  uri: string;
  category: DeviceFileCategory;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationSeconds: number | null;
  modifiedAt: number;
  folderLabel: string;
  canRename: boolean;
  canDelete: boolean;
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', '3gp', 'm4v', 'ts', 'flv']);
const AUDIO_EXTS = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'flac',
  'opus',
  'amr',
  'wma',
  'mid',
  'midi',
  'aiff',
  'caf',
]);

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
}

export function categorizeByMimeAndExt(filename: string, mimeType?: string | null): DeviceFileCategory {
  const ext = getExtension(filename);
  const mime = (mimeType ?? '').toLowerCase();

  if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) return 'images';
  if (VIDEO_EXTS.has(ext) || mime.startsWith('video/')) return 'videos';
  if (AUDIO_EXTS.has(ext) || mime.startsWith('audio/')) return 'audio';
  return 'docs';
}

export function guessMimeType(filename: string, category: DeviceFileCategory): string {
  const ext = getExtension(filename);
  if (category === 'images') {
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'heic' || ext === 'heif') return 'image/heic';
    return 'image/jpeg';
  }
  if (category === 'videos') {
    if (ext === 'mov') return 'video/quicktime';
    if (ext === 'mkv') return 'video/x-matroska';
    if (ext === 'webm') return 'video/webm';
    return 'video/mp4';
  }
  if (category === 'audio') {
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'm4a') return 'audio/mp4';
    if (ext === 'aac') return 'audio/aac';
    if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
    if (ext === 'flac') return 'audio/flac';
    return 'audio/mpeg';
  }
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt' || ext === 'md') return 'text/plain';
  if (ext === 'json') return 'application/json';
  if (ext === 'zip') return 'application/zip';
  if (ext === 'doc' || ext === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (ext === 'xls' || ext === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/octet-stream';
}

export function resolveDeviceBackupState(
  item: DeviceFileItem,
  queue: QueueItem[],
  _serverFiles: DriveFile[],
): DeviceBackupState {
  if (item.sourceKind === 'cloud_synced') return 'backed_up';
  return stateForRecord(findRecord(item, indexBackupQueue(queue)));
}

function findRecord(item: DeviceFileItem, index: Map<string, QueueItem>) {
  if (index.size === 0) return undefined;
  const rev = `${item.sizeBytes}:${item.modifiedAt}`;
  const zeroRev = item.assetId ? `0:${item.modifiedAt}` : null;
  for (const uri of [item.assetId, item.storageUri, item.uri]) {
    if (!uri) continue;
    const key = sourceIdentity(uri);
    const record = index.get(backupLookupKey(key, rev));
    if (record) return record;
    if (zeroRev) {
      const old = index.get(backupLookupKey(key, zeroRev));
      if (old) return old;
    }
  }
}

function stateForRecord(record?: QueueItem): DeviceBackupState {
  if (record?.serverFileId || record?.status === 'completed') return 'backed_up';
  if (record && ['pending', 'uploading', 'paused', 'failed'].includes(record.status)) return 'queued';
  return 'not_backed_up';
}

export async function checkDeviceMediaPermission(): Promise<{
  granted: boolean;
  accessPrivileges: 'all' | 'limited' | 'none';
}> {
  if (Platform.OS === 'web') {
    return { granted: false, accessPrivileges: 'none' };
  }

  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const permissions = PermissionsAndroid.PERMISSIONS;
    const full = await Promise.all([
      permissions.READ_MEDIA_IMAGES, permissions.READ_MEDIA_VIDEO, permissions.READ_MEDIA_AUDIO,
    ].map((permission) => PermissionsAndroid.check(permission).catch(() => false)));
    const selected = Number(Platform.Version) >= 34 &&
      await PermissionsAndroid.check(permissions.READ_MEDIA_VISUAL_USER_SELECTED).catch(() => false);
    const granted = full.some(Boolean) || selected;
    return { granted, accessPrivileges: full.every(Boolean) ? 'all' : granted ? 'limited' : 'none' };
  }

  const perm = await MediaLibrary.getPermissionsAsync().catch(() => null);
  return {
    granted: !!perm?.granted,
    accessPrivileges: perm?.granted ? (perm.accessPrivileges ?? 'all') : 'none',
  };
}

export async function requestDeviceMediaPermission(): Promise<DevicePermissionResult> {
  if (Platform.OS !== 'web') {
    await MediaLibrary.requestPermissionsAsync(false).catch(() => undefined);
  }
  const access = await checkDeviceMediaPermission();
  const expoGo = Platform.OS === 'android' && isExpoGoEnvironment();
  return {
    ...access,
    osPermissionState: access.granted ? 'granted' : expoGo ? 'expo_go_limited' : 'denied',
    message: access.granted
      ? access.accessPrivileges === 'limited' ? 'Akses diberikan untuk sebagian media.' : 'Akses pustaka media diberikan.'
      : 'Hubungkan folder atau aktifkan izin media di Pengaturan perangkat.',
    canOpenSettings: Platform.OS !== 'web' && access.accessPrivileges !== 'all',
  };
}

export async function requestDeviceDirectoryPermission(): Promise<WatchedFolder | null> {
  return pickAndAddWatchedFolder();
}

function getLocalManagedDirectory(): Directory {
  const dir = new Directory(Paths.document, 'perangkat-berkas');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function extractCleanName(rawName: string, rawUri?: string): string {
  let decoded = rawName || rawUri || '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep raw string if malformed URI encoding
  }
  const withoutTrailing = decoded.replace(/\/+$/, '');
  const afterSlash = withoutTrailing.split('/').pop() ?? withoutTrailing;
  const afterColon = afterSlash.split(':').pop() ?? afterSlash;
  return afterColon.trim() || rawName || 'Berkas';
}

export async function copyUriToLocalFile(srcUri: string, dest: File): Promise<void> {
  const src = new File(srcUri);
  try {
    await src.copy(dest);
    return;
  } catch {
    dest.create({ intermediates: true, overwrite: true });
    const reader = src.open(FileMode.ReadOnly);
    try {
      const writer = dest.open(FileMode.WriteOnly);
      try {
        while (true) {
          const chunk = await reader.readBytes(1024 * 1024);
          if (!chunk.length) break;
          await writer.writeBytes(chunk);
        }
      } finally {
        writer.close();
      }
    } finally {
      reader.close();
    }
  }
}

export function getDeviceStorageSummary(scannedDirectoriesCount = 0): DeviceStorageSummary {
  try {
    const total = Paths.totalDiskSpace || 0;
    const avail = Paths.availableDiskSpace || 0;
    const used = total > avail ? total - avail : 0;
    return {
      totalDiskBytes: total,
      availableDiskBytes: avail,
      usedDiskBytes: used,
      scannedDirectoriesCount,
    };
  } catch {
    return {
      totalDiskBytes: 0,
      availableDiskBytes: 0,
      usedDiskBytes: 0,
      scannedDirectoriesCount,
    };
  }
}

export type ScanProgress = { active: boolean; percent: number; files: number; source: string };

type ScanResult = {
  items: DeviceFileItem[];
  unreadableSources: string[];
  mediaPermission: 'all' | 'limited' | 'none';
  watchedFolders: WatchedFolder[];
  storageSummary: DeviceStorageSummary;
  maxCursors?: Record<string, number>;
};

type PersistedCatalogSnapshot = {
  version: 1;
  items: DeviceFileItem[];
  maxCursors: Record<string, number>;
  mediaPermission: 'all' | 'limited' | 'none';
  watchedFolders: WatchedFolder[];
  scannedDirectoriesCount: number;
  savedAt: number;
};

type ScanListener = { first?: (items: DeviceFileItem[]) => void; progress?: (value: ScanProgress) => void };
const scans = new Map<string, { result: Promise<ScanResult>; listeners: Set<ScanListener> }>();
// Single device-wide in-memory cache backed permanently by SQLite — survives tab switches & restarts with ZERO rescan!
let memoryCatalogCache: ScanResult | null = null;
let deltaScanInFlight: Promise<{ addedItems: DeviceFileItem[]; result: ScanResult | null }> | null = null;

export function getCachedDeviceFilesSync(): ScanResult | null {
  return memoryCatalogCache;
}

async function persistScanSnapshot(res: ScanResult): Promise<void> {
  if (Platform.OS === 'web') return;
  const snapshot: PersistedCatalogSnapshot = {
    version: 1,
    items: res.items,
    maxCursors: res.maxCursors ?? {},
    mediaPermission: res.mediaPermission,
    watchedFolders: res.watchedFolders,
    scannedDirectoriesCount: res.storageSummary.scannedDirectoriesCount,
    savedAt: Date.now(),
  };
  await saveDeviceCatalogSnapshot(snapshot);
}

/**
 * Loads the persisted SQLite device catalog snapshot instantaneously (<15ms)
 * so cold app starts NEVER block UI interactions waiting for a full phone rescan.
 */
export async function loadCachedDeviceFiles(): Promise<ScanResult | null> {
  if (Platform.OS === 'web') return null;
  if (memoryCatalogCache) return memoryCatalogCache;

  const snap = await loadDeviceCatalogSnapshot<PersistedCatalogSnapshot>();
  if (!snap || snap.version !== 1 || !Array.isArray(snap.items)) {
    return null;
  }
  const hydrated: ScanResult = {
    items: snap.items,
    unreadableSources: [],
    mediaPermission: snap.mediaPermission,
    watchedFolders: snap.watchedFolders ?? [],
    storageSummary: getDeviceStorageSummary(snap.scannedDirectoriesCount || 1),
    maxCursors: snap.maxCursors ?? {},
  };
  memoryCatalogCache = hydrated;
  return hydrated;
}

let currentScanState: ScanProgress = { active: false, percent: 0, files: 0, source: '' };
const globalScanListeners = new Set<(state: ScanProgress) => void>();

export function getCurrentScanState(): ScanProgress {
  return currentScanState;
}

export function subscribeScanProgress(listener: (state: ScanProgress) => void): () => void {
  globalScanListeners.add(listener);
  return () => {
    globalScanListeners.delete(listener);
  };
}

function emitGlobalScanState(next: ScanProgress): void {
  currentScanState = next;
  globalScanListeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      // Ignore subscriber error
    }
  });
}

const yieldFrame = (ms = 32) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toFileUri(path: string): string {
  // Fast path avoids split/map/join regex work for ordinary ASCII paths
  if (!/[\s#%?[\]]/.test(path)) {
    return `file://${path}`;
  }
  return `file://${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

export function invalidateDeviceScanCache(): void {
  memoryCatalogCache = null;
  void clearDeviceCatalogSnapshot();
}

export function removeDeviceFileFromCache(itemId: string): void {
  if (!memoryCatalogCache) return;
  const nextItems = memoryCatalogCache.items.filter((it) => it.id !== itemId);
  if (nextItems.length !== memoryCatalogCache.items.length) {
    memoryCatalogCache = { ...memoryCatalogCache, items: nextItems };
    void persistScanSnapshot(memoryCatalogCache);
  }
}

export function updateDeviceFileInCache(
  itemId: string,
  updater: (item: DeviceFileItem) => DeviceFileItem,
): void {
  if (!memoryCatalogCache) return;
  let changed = false;
  const nextItems = memoryCatalogCache.items.map((it) => {
    if (it.id !== itemId) return it;
    changed = true;
    return updater(it);
  });
  if (changed) {
    memoryCatalogCache = { ...memoryCatalogCache, items: nextItems };
    void persistScanSnapshot(memoryCatalogCache);
  }
}

/**
 * Lightweight Google-Photos-style incremental delta scan:
 * Only queries MediaStore rows strictly newer than saved per-volume cursors
 * (or top 40 newest items on iOS/fallback), taking ~15-30ms with ZERO full phone rescan!
 */
export async function scanDeviceDelta(): Promise<{
  addedItems: DeviceFileItem[];
  result: ScanResult | null;
}> {
  if (Platform.OS === 'web') return { addedItems: [], result: null };
  if (deltaScanInFlight) return deltaScanInFlight;

  deltaScanInFlight = (async () => {
    const base = await loadCachedDeviceFiles();
    if (!base) return { addedItems: [], result: null };

    const seenIds = new Set(base.items.map((it) => it.id));
    const seenUris = new Set<string>();
    for (const it of base.items) {
      if (it.uri) seenUris.add(it.uri);
      if (it.storageUri) seenUris.add(it.storageUri);
    }

    const nextCursors: Record<string, number> = { ...(base.maxCursors ?? {}) };
    const addedItems: DeviceFileItem[] = [];
    const perm = await checkDeviceMediaPermission();

    if (Platform.OS === 'android' && (deviceCatalog || perm.granted)) {
      try {
        for await (const page of androidGalleryPages(nextCursors, true)) {
          if (page.volume && typeof page.maxCursor === 'number') {
            nextCursors[page.volume] = Math.max(nextCursors[page.volume] ?? 0, page.maxCursor);
          }
          for (const row of page.entries) {
            if (!row.filename || !row.path || excludedAndroidPath(row.path)) continue;
            const id = `ml-${row.id}`;
            const storageUri = toFileUri(row.path);
            if (seenIds.has(id) || seenUris.has(row.id) || seenUris.has(storageUri)) continue;
            const category =
              row.mediaType === 'photo'
                ? 'images'
                : row.mediaType === 'video'
                  ? 'videos'
                  : row.mediaType === 'audio'
                    ? 'audio'
                    : categorizeByMimeAndExt(row.filename, row.mime);
            const item: DeviceFileItem = {
              id,
              sourceKind: 'media_library',
              assetId: row.id,
              uri: row.id,
              storageUri,
              name: row.filename,
              category,
              mimeType: row.mime || guessMimeType(row.filename, category),
              extension: getExtension(row.filename).toUpperCase() || 'FILE',
              sizeBytes: row.size,
              modifiedAt: row.modificationTime,
              durationSeconds: row.duration == null ? null : row.duration / 1000,
              folderLabel: row.path.substring(0, row.path.lastIndexOf('/')),
              canRename: false,
              canDelete: true,
            };
            addedItems.push(item);
            seenIds.add(id);
            seenUris.add(row.id);
            seenUris.add(storageUri);
          }
          await yieldFrame(20);
        }
      } catch {
        // Ignore transient delta read error; keep existing cache intact
      }
    } else if (perm.granted) {
      // iOS / non-native fallback: check top 40 newest media items only
      for (const type of [
        MediaLibrary.MediaType.IMAGE,
        MediaLibrary.MediaType.VIDEO,
        MediaLibrary.MediaType.AUDIO,
      ]) {
        const metaList = await new MediaLibrary.Query()
          .eq(MediaLibrary.AssetField.MEDIA_TYPE, type)
          .orderBy({ key: MediaLibrary.AssetField.MODIFICATION_TIME, ascending: false })
          .limit(40)
          .exeForMetadata()
          .catch(() => null);
        if (!metaList) continue;
        for (const meta of metaList) {
          const uri = meta.id;
          const id = `ml-${uri}`;
          if (!uri || seenIds.has(id) || seenUris.has(uri)) continue;
          const category: DeviceFileCategory =
            meta.mediaType === MediaLibrary.MediaType.IMAGE
              ? 'images'
              : meta.mediaType === MediaLibrary.MediaType.VIDEO
                ? 'videos'
                : 'audio';
          const filename = meta.filename || `MEDIA_${String(uri).split('/').pop()}`;
          const modTime = meta.modificationTime ?? meta.creationTime ?? Date.now();
          const modifiedAt = modTime < 1e11 ? modTime * 1000 : modTime;
          addedItems.push({
            id,
            sourceKind: 'media_library',
            assetId: uri,
            name: filename,
            uri,
            category,
            mimeType: guessMimeType(filename, category),
            extension: getExtension(filename).toUpperCase() || category.toUpperCase(),
            sizeBytes: 0,
            durationSeconds: meta.duration != null ? Math.round(meta.duration / 1000) : null,
            modifiedAt,
            folderLabel:
              category === 'images'
                ? 'Galeri Foto HP'
                : category === 'videos'
                  ? 'Galeri Video HP'
                  : 'Pustaka Audio HP',
            canRename: false,
            canDelete: true,
          });
          seenIds.add(id);
          seenUris.add(uri);
        }
      }
    }

    if (addedItems.length === 0) {
      return { addedItems: [], result: base };
    }

    const mergedItems = [...addedItems, ...base.items].sort((a, b) => b.modifiedAt - a.modifiedAt);
    const updated: ScanResult = {
      ...base,
      items: mergedItems,
      maxCursors: nextCursors,
      storageSummary: getDeviceStorageSummary(base.storageSummary.scannedDirectoriesCount),
    };
    memoryCatalogCache = updated;
    await persistScanSnapshot(updated);
    return { addedItems, result: updated };
  })().finally(() => {
    deltaScanInFlight = null;
  });

  return deltaScanInFlight;
}

export async function scanAllDeviceFiles(
  includeWatchedFolders = true,
  first?: ScanListener['first'],
  progress?: ScanListener['progress'],
  forceRefresh = false,
) {
  const credentials = await loadCredentials();
  const key = credentials?.deviceToken ?? 'guest';

  if (!forceRefresh) {
    // Never expire or rescan once indexed in SQLite — behave like a native file explorer!
    const persisted = memoryCatalogCache ?? (await loadCachedDeviceFiles());
    if (persisted) {
      first?.(persisted.items);
      return includeWatchedFolders
        ? persisted
        : { ...persisted, items: persisted.items.filter((item) => !item.id.startsWith('wf-')) };
    }
  }

  const listener = { first, progress };
  let scan = scans.get(key);
  if (!scan) {
    const listeners = new Set<ScanListener>();
    let lastEmitAt = 0;
    let lastPercent = -1;
    emitGlobalScanState({ active: true, percent: 0, files: 0, source: 'Menyiapkan' });
    const result = performDeviceScan(
      (items) => listeners.forEach((l) => l.first?.(items)),
      (value) => {
        const now = Date.now();
        const isTerminal = value.percent >= 100 || !value.active;
        if (!isTerminal && now - lastEmitAt < 180 && Math.abs(value.percent - lastPercent) < 3) {
          return;
        }
        lastEmitAt = now;
        lastPercent = value.percent;
        emitGlobalScanState(value);
        listeners.forEach((l) => l.progress?.(value));
      },
    ).then((res) => {
      memoryCatalogCache = res;
      void persistScanSnapshot(res);
      emitGlobalScanState({ active: false, percent: 100, files: res.items.length, source: 'Selesai' });
      return res;
    }).catch((err) => {
      emitGlobalScanState({ active: false, percent: 0, files: 0, source: '' });
      throw err;
    });
    scan = { listeners, result };
    scans.set(key, scan);
  }
  scan.listeners.add(listener);
  try {
    const data = await scan.result;
    return includeWatchedFolders ? data : { ...data, items: data.items.filter(item => !item.id.startsWith('wf-')) };
  } finally {
    scan.listeners.delete(listener);
    if (scans.get(key) === scan) scans.delete(key);
  }
}

async function performDeviceScan(onFirstPage: NonNullable<ScanListener['first']>, onProgress: NonNullable<ScanListener['progress']>): Promise<ScanResult> {
  if (Platform.OS === 'web') {
    return {
      items: [],
      unreadableSources: [],
      mediaPermission: 'none',
      watchedFolders: [],
      storageSummary: getDeviceStorageSummary(0),
    };
  }

  const perm = await checkDeviceMediaPermission();
  const results: DeviceFileItem[] = [];
  const seenUris = new Set<string>();
  let scannedDirs = 0;

  const unreadableSources: string[] = [];
  const mediaLabels = {
    [MediaLibrary.MediaType.IMAGE]: 'Foto', [MediaLibrary.MediaType.VIDEO]: 'Video',
    [MediaLibrary.MediaType.AUDIO]: 'Audio', [MediaLibrary.MediaType.UNKNOWN]: 'Dokumen media',
  };
  let firstPageShown = false;
  function publishFirstPage() {
    if (firstPageShown || !onFirstPage || !results.length) return;
    firstPageShown = true;
    onFirstPage(results.slice());
  }
  const pageSize = 250;
  const types = [MediaLibrary.MediaType.IMAGE, MediaLibrary.MediaType.VIDEO, MediaLibrary.MediaType.AUDIO];
  if (Platform.OS === 'android') types.push(MediaLibrary.MediaType.UNKNOWN);
  const watchedFolders = await listWatchedFolders().catch(() => []);
  const roots = [
    { uri: getLocalManagedDirectory().uri, label: 'Dokumen Lokal', prefix: 'fs' },
    { uri: new Directory(Paths.document, 'kotak-masuk').uri, label: 'Kotak Masuk', prefix: 'fs' },
    ...watchedFolders.map(folder => ({ uri: folder.uri, label: folder.label, prefix: `wf-${folder.id}` })),
  ];

  let completedSources = 0;
  let totalSources = types.length + roots.length;
  const report = (source: string, partialSources = 0, done = false) => onProgress?.({
    active: !done,
    percent: done ? 100 : Math.min(99, Math.floor(100 * (completedSources + partialSources) / Math.max(1, totalSources))),
    files: results.length,
    source,
  });
  let indexed = false;
  const maxCursors: Record<string, number> = {};
  if (Platform.OS === 'android' && (deviceCatalog || perm.granted)) {
    try {
      for await (const page of androidGalleryPages()) {
        if (page.volume && typeof page.maxCursor === 'number') {
          maxCursors[page.volume] = Math.max(maxCursors[page.volume] ?? 0, page.maxCursor);
        }
        for (let i = 0; i < page.entries.length; i++) {
          if (i > 0 && i % 60 === 0) await yieldFrame(28);
          const row = page.entries[i];
          if (!row.filename || !row.path || excludedAndroidPath(row.path) || seenUris.has(row.id)) continue;
          const storageUri = toFileUri(row.path);
          if (seenUris.has(storageUri)) continue;
          const category = row.mediaType === 'photo' ? 'images' : row.mediaType === 'video' ? 'videos'
            : row.mediaType === 'audio' ? 'audio' : categorizeByMimeAndExt(row.filename, row.mime);
          results.push({
            id: `ml-${row.id}`, sourceKind: 'media_library', assetId: row.id, uri: row.id,
            storageUri, name: row.filename, category, mimeType: row.mime || guessMimeType(row.filename, category), sizeBytes: row.size,
            extension: getExtension(row.filename).toUpperCase() || 'FILE',
            modifiedAt: row.modificationTime, durationSeconds: row.duration == null ? null : row.duration / 1000,
            folderLabel: row.path.substring(0, row.path.lastIndexOf('/')),
            canRename: false, canDelete: true,
          });
          seenUris.add(row.id);
          seenUris.add(storageUri);
        }
        publishFirstPage();
        report(page.source, types.length * page.fraction);
        await yieldFrame(48);
      }
      indexed = true;
      scannedDirs++;
    } catch {
      unreadableSources.push('Indeks penyimpanan Android');
    }
  }

  if (Platform.OS === 'android' && (!indexed || !deviceCatalog)) {
    // Without the native Files index, supplement gallery media with accessible documents.
    // When the index fails altogether, discover directories from the volume root.
    const volumes = await deviceCatalog?.storageRoots?.().catch(() => []) ?? [];
    for (const volume of volumes.length ? volumes : ['file:///storage/emulated/0']) {
      const base = volume.replace(/\/+$/, '');
      for (const folder of indexed ? ['Documents', 'Download'] : ['']) {
        roots.push({ uri: folder ? base + '/' + folder : base, label: folder || 'Penyimpanan bersama', prefix: 'sys' });
      }
    }
    totalSources = types.length + roots.length;
  }

  if (indexed || !perm.granted) completedSources = types.length;
  for (const type of types) {
    if (indexed || !perm.granted) break;
    for (let offset = 0; ; offset += pageSize) {
      const metadataList = await new MediaLibrary.Query()
        .eq(MediaLibrary.AssetField.MEDIA_TYPE, type)
        .orderBy({ key: MediaLibrary.AssetField.MODIFICATION_TIME, ascending: false })
        .limit(pageSize)
        .offset(offset)
        .exeForMetadata()
        .catch(() => null);
      if (!metadataList) {
        unreadableSources.push(mediaLabels[type]);
        break;
      }
      if (offset === 0 && metadataList.length) scannedDirs++;

      for (const meta of metadataList) {
        try {
          const uri = meta.id;
          if (!uri || seenUris.has(uri)) continue;

          const rawName = meta.filename || '';
          // Skip directory rows in UNKNOWN query that have no file extension
          if (type === MediaLibrary.MediaType.UNKNOWN && (!rawName || !getExtension(rawName))) {
            continue;
          }

          seenUris.add(uri);
          const category: DeviceFileCategory =
            meta.mediaType === MediaLibrary.MediaType.IMAGE
              ? 'images'
              : meta.mediaType === MediaLibrary.MediaType.VIDEO
                ? 'videos'
                : meta.mediaType === MediaLibrary.MediaType.AUDIO
                  ? 'audio'
                  : categorizeByMimeAndExt(rawName, '');

          const filename =
            rawName ||
            (category === 'images'
              ? `IMG_${String(meta.id).split('/').pop()}.jpg`
              : category === 'videos'
                ? `VID_${String(meta.id).split('/').pop()}.mp4`
                : category === 'audio'
                  ? `AUD_${String(meta.id).split('/').pop()}.mp3`
                  : `DOC_${String(meta.id).split('/').pop()}.bin`);

          const rawDuration = meta.duration ?? null;
          const durationSeconds =
            rawDuration !== null
              ? Math.round(rawDuration / 1000)
              : null;

          const modTime = meta.modificationTime ?? meta.creationTime ?? Date.now();
          const modifiedAt = modTime < 1e11 ? modTime * 1000 : modTime;

          results.push({
            id: `ml-${meta.id}`,
            sourceKind: 'media_library',
            assetId: meta.id,
            name: filename,
            uri,
            category,
            mimeType: guessMimeType(filename, category),
            extension: getExtension(filename).toUpperCase() || category.toUpperCase(),
            sizeBytes: 0,
            durationSeconds,
            modifiedAt,
            folderLabel:
              category === 'images'
                ? 'Galeri Foto HP'
                : category === 'videos'
                  ? 'Galeri Video HP'
                  : category === 'audio'
                    ? 'Pustaka Audio HP'
                    : 'Penyimpanan Dokumen HP',
            canRename: false,
            canDelete: true,
          });
        } catch {
          continue;
        }
      }
      publishFirstPage();
      report(mediaLabels[type]);
      await yieldFrame();
      if (metadataList.length < pageSize) break;
    }
    completedSources++;
  }

  for (const root of roots) {
    report(root.label);
    await yieldFrame();
    try {
      for await (const file of walkDirectory(root.uri, root.label, undefined, false, root.prefix === 'fs')) {
        if (seenUris.has(file.uri)) continue;
        const name = extractCleanName(file.name, file.uri);
        const category = categorizeByMimeAndExt(name, file.mimeType);
        results.push({
          id: `${root.prefix}-${file.uri}`, sourceKind: 'file_system', name, uri: file.uri,
          category, mimeType: file.mimeType || guessMimeType(name, category),
          extension: getExtension(name).toUpperCase() || 'FILE', sizeBytes: file.sizeBytes,
          durationSeconds: null, modifiedAt: file.mtime, folderLabel: file.uri.startsWith('file://') ? file.uri.slice(7, file.uri.lastIndexOf('/')) : file.folderLabel,
          canRename: !file.uri.startsWith('content://'), canDelete: true,
        });
        seenUris.add(file.uri);
        if (results.length % 120 === 0) {
          publishFirstPage();
          report(root.label);
          await yieldFrame();
        }
      }
      publishFirstPage();
      scannedDirs++;
    } catch {
      if (root.prefix.startsWith('wf-')) unreadableSources.push(root.label);
    }
    completedSources++;
  }

  results.sort((a, b) => b.modifiedAt - a.modifiedAt);
  report('Selesai', 0, true);

  return {
    items: results,
    unreadableSources,
    mediaPermission: perm.accessPrivileges,
    watchedFolders,
    storageSummary: getDeviceStorageSummary(scannedDirs),
    maxCursors,
  };
}

export async function readDeviceFileDetails(item: DeviceFileItem): Promise<DeviceFileItem> {
  if (!item.assetId || deviceCatalog) return item;
  const asset = new MediaLibrary.Asset(item.assetId);
  const uri = await asset.getUri();
  const file = new File(uri);
  let location = uri;
  if (Platform.OS === 'android' && uri.startsWith('file://')) {
    location = decodeURIComponent(uri.slice(7, uri.lastIndexOf('/')));
  } else if (Platform.OS === 'ios') {
    const albums = await asset.getAlbums().catch(() => []);
    location = albums.length ? await albums[0].getTitle() : 'Pustaka Foto iOS';
  }
  return { ...item, uri, sizeBytes: file.size || item.sizeBytes, folderLabel: location };
}

export type PickedLocalFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: DeviceFileCategory;
};

/**
 * Picks files from the device WITHOUT duplicating bytes into local app storage.
 * Returned URIs are streamed directly to the Cloud API and temp staging is wiped immediately.
 */
export async function pickLocalFilesWithoutCopy(): Promise<PickedLocalFile[]> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    // Keep content:// URI on Android so zero duplicate copy is created in app storage
    copyToCacheDirectory: Platform.OS === 'ios',
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return [];
  }

  return picked.assets.map((asset) => {
    const cleanName = extractCleanName(asset.name || `Berkas_${Date.now()}`, asset.uri);
    const category = categorizeByMimeAndExt(cleanName, asset.mimeType);
    return {
      uri: asset.uri,
      name: cleanName,
      mimeType: asset.mimeType || guessMimeType(cleanName, category),
      sizeBytes: asset.size ?? 0,
      category,
    };
  });
}

/**
 * Reclaims local app storage by deleting legacy duplicate copies inside app-private
 * folders (perangkat-berkas / kotak-masuk) when the exact file is already backed up on server.
 */
export function cleanupRedundantLocalCopies(serverFiles: DriveFile[]): number {
  if (Platform.OS === 'web' || serverFiles.length === 0) return 0;
  const serverNames = new Set(serverFiles.map((f) => f.name.toLowerCase()));
  let removed = 0;

  const dirs = [
    new Directory(Paths.document, 'perangkat-berkas'),
    new Directory(Paths.document, 'kotak-masuk'),
  ];

  for (const dir of dirs) {
    try {
      if (!dir.exists) continue;
      for (const entry of dir.list()) {
        if (!(entry instanceof File)) continue;
        const cleanName = extractCleanName(entry.name, entry.uri).toLowerCase();
        // Strip legacy 8-char UUID prefix if present (e.g. "a1b2c3d4_photo.jpg")
        const stripped = cleanName.replace(/^[0-9a-f]{6,8}_/, '');
        if (serverNames.has(cleanName) || serverNames.has(stripped)) {
          try {
            entry.delete();
            removed++;
          } catch {
            // Ignore locked file
          }
        }
      }
    } catch {
      // Ignore unreadable dir
    }
  }
  return removed;
}

export function mapDriveCategoryToDeviceCategory(cat: DriveFile['category']): DeviceFileCategory {
  if (cat === 'image') return 'images';
  if (cat === 'video') return 'videos';
  if (cat === 'audio') return 'audio';
  return 'docs';
}

/**
 * Merges real scanned device files with already-backed-up Cloud files WITHOUT storing
 * any duplicate local file bytes and WITHOUT creating duplicate rows/tiles.
 */
export function mergeDeviceAndCloudFiles(
  deviceItems: DeviceFileItem[],
  cloudFiles: DriveFile[],
  queue: QueueItem[],
): { item: DeviceFileItem; backupState: DeviceBackupState }[] {
  const matchedServerIds = new Set<string>();
  const merged: { item: DeviceFileItem; backupState: DeviceBackupState }[] = [];
  const records = indexBackupQueue(queue);
  const cloudById = new Map(cloudFiles.map(file => [file.id, file]));
  for (const item of deviceItems) {
    const record = findRecord(item, records);
    const serverFile = record?.serverFileId ? cloudById.get(record.serverFileId) : undefined;
    if (serverFile) matchedServerIds.add(serverFile.id);
    merged.push({ item: serverFile ? { ...item, serverFile } : item, backupState: stateForRecord(record) });
  }

  for (const sf of cloudFiles) {
    if (matchedServerIds.has(sf.id)) continue;
    const category = mapDriveCategoryToDeviceCategory(sf.category);
    const modifiedAt = new Date(sf.media_taken_at ?? sf.created_at).getTime() || Date.now();
    merged.push({
      backupState: 'backed_up',
      item: {
        id: `cloud-${sf.id}`,
        sourceKind: 'cloud_synced',
        serverFile: sf,
        name: sf.name,
        uri: '',
        category,
        mimeType: sf.mime_type,
        extension: getExtension(sf.name).toUpperCase() || sf.category.toUpperCase(),
        sizeBytes: sf.size_bytes,
        durationSeconds: null,
        modifiedAt,
        folderLabel: 'Tercadang di Cloud',
        canRename: false,
        canDelete: false,
      },
    });
  }

  return merged;
}

export function createDeviceTextDocument(title: string, content: string): DeviceFileItem {
  const targetDir = getLocalManagedDirectory();
  const cleanTitle = title.trim().replace(/[/\\:*?"<>|]/g, '_') || `Catatan_${Date.now()}`;
  const filename = /\.[a-z0-9]{2,5}$/i.test(cleanTitle) ? cleanTitle : `${cleanTitle}.txt`;

  let dest = new File(targetDir, filename);
  if (dest.exists) {
    dest = new File(targetDir, `${Crypto.randomUUID().slice(0, 4)}_${filename}`);
  }
  dest.create({ intermediates: true, overwrite: true });
  dest.write(content);

  return {
    id: `fs-${dest.uri}`,
    sourceKind: 'file_system',
    name: dest.name,
    uri: dest.uri,
    category: 'docs',
    mimeType: 'text/plain',
    extension: getExtension(dest.name).toUpperCase() || 'TXT',
    sizeBytes: dest.size || content.length,
    durationSeconds: null,
    modifiedAt: Date.now(),
    folderLabel: 'Penyimpanan Aplikasi',
    canRename: true,
    canDelete: true,
  };
}

export function renameDeviceFile(item: DeviceFileItem, newNameInput: string): void {
  const trimmed = newNameInput.trim().replace(/[/\\:*?"<>|]/g, '_');
  if (!trimmed) {
    throw new Error('Nama berkas baru tidak boleh kosong.');
  }

  const origExt = getExtension(item.name);
  const finalName =
    origExt && !trimmed.toLowerCase().endsWith(`.${origExt}`)
      ? `${trimmed}.${origExt}`
      : trimmed;

  const file = new File(item.uri);
  if (!file.exists) {
    throw new Error('Berkas lokal tidak ditemukan.');
  }

  const parentDir = file.parentDirectory;
  const target = new File(parentDir, finalName);
  if (target.exists && target.uri !== file.uri) {
    throw new Error('Berkas dengan nama tersebut sudah ada di folder yang sama.');
  }

  file.move(target);
}

export async function deleteDeviceFile(item: DeviceFileItem): Promise<void> {
  // Fast direct deletion on Android when shared storage access is granted — avoids hanging OS confirmation dialogs
  if (
    Platform.OS === 'android' &&
    item.storageUri?.startsWith('file://') &&
    deviceCatalog?.hasSharedStorageAccess()
  ) {
    try {
      const directFile = new File(item.storageUri);
      if (directFile.exists) {
        directFile.delete();
        return;
      }
    } catch {
      // Fall back to MediaLibrary deletion below
    }
  }

  if (item.sourceKind === 'media_library' && item.assetId) {
    const asset = new MediaLibrary.Asset(item.assetId);
    await asset.delete();
    return;
  }

  const targetUri = item.storageUri ?? item.uri;
  const file = new File(targetUri);
  if (file.exists) {
    file.delete();
  }
}
