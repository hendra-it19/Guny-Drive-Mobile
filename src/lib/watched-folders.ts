import * as Crypto from 'expo-crypto';
import { Directory } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { walkDirectory } from './directory-scan';
import { createLocalEnqueuer } from './local-backup';
import { getPref, setPref } from './storage';

const PREF_WATCHED_FOLDERS = 'watched_folders_p1_v1';

export type WatchedFolderStatus = 'active' | 'needs_reauth' | 'unavailable';

export type WatchedFolder = {
  id: string;
  label: string;
  uri: string;
  platform: string;
  status: WatchedFolderStatus;
  lastScannedAt: number | null;
  lastError: string | null;
};

export async function listWatchedFolders(): Promise<WatchedFolder[]> {
  return getPref<WatchedFolder[]>(PREF_WATCHED_FOLDERS, []);
}

export async function saveWatchedFolders(folders: WatchedFolder[]): Promise<void> {
  await setPref(PREF_WATCHED_FOLDERS, folders);
}

function cleanSafFolderName(rawName: string, rawUri: string): string {
  let decoded = rawName || rawUri;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Ignore decode error
  }
  const clean = decoded.replace(/\/+$/, '');
  const afterSlash = clean.split('/').pop() ?? clean;
  const afterColon = afterSlash.split(':').pop() ?? afterSlash;
  return afterColon.trim() || 'Folder Perangkat';
}

export async function pickAndAddWatchedFolder(): Promise<WatchedFolder | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  let normalizedUri = '';
  let rawName = '';

  if (Platform.OS === 'android') {
    // Use StorageAccessFramework directly so Android returns the raw, unmangled SAF tree URI
    const perm = await FileSystemLegacy.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted || !perm.directoryUri) {
      return null;
    }
    normalizedUri = perm.directoryUri;
    rawName = perm.directoryUri;
  } else {
    const picked = await Directory.pickDirectoryAsync();
    normalizedUri = picked.uri;
    rawName = picked.name;
  }

  const label = cleanSafFolderName(rawName, normalizedUri);
  const folders = await listWatchedFolders();
  const existing = folders.find((f) => f.uri === normalizedUri);

  if (existing) {
    existing.label = label;
    existing.status = 'active';
    existing.lastError = null;
    await saveWatchedFolders(folders);
    return existing;
  }

  const created: WatchedFolder = {
    id: Crypto.randomUUID(),
    label,
    uri: normalizedUri,
    platform: Platform.OS,
    status: 'active',
    lastScannedAt: null,
    lastError: null,
  };

  folders.unshift(created);
  await saveWatchedFolders(folders);
  return created;
}

export async function reauthorizeWatchedFolder(folderId: string): Promise<WatchedFolder | null> {
  if (Platform.OS === 'web') return null;

  let nextUri = '';
  let rawName = '';
  if (Platform.OS === 'android') {
    const perm = await FileSystemLegacy.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted || !perm.directoryUri) return null;
    nextUri = perm.directoryUri;
    rawName = perm.directoryUri;
  } else {
    const picked = await Directory.pickDirectoryAsync();
    nextUri = picked.uri;
    rawName = picked.name;
  }

  const folders = await listWatchedFolders();
  const target = folders.find((f) => f.id === folderId);
  if (!target) return null;

  target.uri = nextUri;
  target.label = cleanSafFolderName(rawName, nextUri) || target.label;
  target.status = 'active';
  target.lastError = null;

  await saveWatchedFolders(folders);
  return target;
}

export async function removeWatchedFolder(folderId: string): Promise<void> {
  const folders = await listWatchedFolders();
  await saveWatchedFolders(folders.filter((f) => f.id !== folderId));
}

export type WatchedScanFilter = {
  includePhotos?: boolean;
  includeVideos?: boolean;
  includeDocuments?: boolean;
  includeAudio?: boolean;
};

const WF_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'avif']);
const WF_VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', '3gp', 'm4v', 'ts']);
const WF_AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'amr', 'wma', 'aiff']);

function classifyWatchedFile(filename: string, mime?: string): {
  kind: 'photo' | 'video' | 'audio' | 'document';
  mimeType: string;
} {
  const parts = filename.toLowerCase().split('.');
  const ext = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const m = (mime ?? '').toLowerCase();

  if (WF_IMAGE_EXTS.has(ext) || m.startsWith('image/')) {
    return { kind: 'photo', mimeType: m.startsWith('image/') ? m : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  }
  if (WF_VIDEO_EXTS.has(ext) || m.startsWith('video/')) {
    return { kind: 'video', mimeType: m.startsWith('video/') ? m : 'video/mp4' };
  }
  if (WF_AUDIO_EXTS.has(ext) || m.startsWith('audio/')) {
    return { kind: 'audio', mimeType: m.startsWith('audio/') ? m : ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg' };
  }
  const docMime =
    ext === 'pdf'
      ? 'application/pdf'
      : ext === 'txt' || ext === 'md'
        ? 'text/plain'
        : ext === 'json'
          ? 'application/json'
          : ext === 'zip'
            ? 'application/zip'
            : ext === 'docx' || ext === 'doc'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : ext === 'xlsx' || ext === 'xls'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : m || 'application/octet-stream';
  return { kind: 'document', mimeType: docMime };
}

/**
 * Scans all watched document folders (T18 P1 prototype).
 * Preserves existing SQLite queue items even if OS revokes SAF/Files access.
 */
export async function scanWatchedFolders(filter?: WatchedScanFilter): Promise<{
  enqueued: number;
  needsReauthCount: number;
  activeFolderCount: number;
}> {
  if (Platform.OS === 'web') {
    return { enqueued: 0, needsReauthCount: 0, activeFolderCount: 0 };
  }

  const folders = await listWatchedFolders();
  let enqueued = 0;
  let needsReauthCount = 0;
  let activeFolderCount = 0;

  const enqueue = await createLocalEnqueuer();
  for (const folder of folders) {
    try {
      for await (const entry of walkDirectory(folder.uri, folder.label)) {
        const cleanFilename = cleanSafFolderName(entry.name, entry.uri);
        const classified = classifyWatchedFile(cleanFilename, entry.mimeType);
        if (filter) {
          if (classified.kind === 'photo' && filter.includePhotos === false) continue;
          if (classified.kind === 'video' && filter.includeVideos === false) continue;
          if (classified.kind === 'audio' && filter.includeAudio === false) continue;
          if (classified.kind === 'document' && filter.includeDocuments === false) continue;
        }
        if (await enqueue({ ...entry, name: cleanFilename, mimeType: classified.mimeType }, 'watched_folder')) enqueued++;
      }

      folder.status = 'active';
      folder.lastError = null;
      folder.lastScannedAt = Date.now();
      activeFolderCount++;
    } catch {
      folder.status = 'needs_reauth';
      folder.lastError =
        Platform.OS === 'ios'
          ? 'Sesi akses Files iOS berakhir. Pilih ulang folder untuk memulihkan akses.'
          : 'Izin SAF Android dicabut atau folder tidak terjangkau. Pilih ulang folder.';
      needsReauthCount++;
    }
  }

  await saveWatchedFolders(folders);
  return { enqueued, needsReauthCount, activeFolderCount };
}
