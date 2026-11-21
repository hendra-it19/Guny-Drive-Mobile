import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import { getPref, hasSourceInQueue, setPref, upsertQueueItem } from './storage';

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

export async function pickAndAddWatchedFolder(): Promise<WatchedFolder | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  const picked = await Directory.pickDirectoryAsync();
  const folders = await listWatchedFolders();
  const existing = folders.find((f) => f.uri === picked.uri);

  if (existing) {
    existing.status = 'active';
    existing.lastError = null;
    await saveWatchedFolders(folders);
    return existing;
  }

  const created: WatchedFolder = {
    id: Crypto.randomUUID(),
    label: picked.name || 'Folder Dokumen',
    uri: picked.uri,
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

  const picked = await Directory.pickDirectoryAsync();
  const folders = await listWatchedFolders();
  const target = folders.find((f) => f.id === folderId);
  if (!target) return null;

  target.uri = picked.uri;
  target.label = picked.name || target.label;
  target.status = 'active';
  target.lastError = null;

  await saveWatchedFolders(folders);
  return target;
}

export async function removeWatchedFolder(folderId: string): Promise<void> {
  const folders = await listWatchedFolders();
  await saveWatchedFolders(folders.filter((f) => f.id !== folderId));
}

/**
 * Scans all watched document folders (T18 P1 prototype).
 * Preserves existing SQLite queue items even if OS revokes SAF/Files access.
 */
export async function scanWatchedFolders(): Promise<{
  enqueued: number;
  needsReauthCount: number;
}> {
  if (Platform.OS === 'web') {
    return { enqueued: 0, needsReauthCount: 0 };
  }

  const folders = await listWatchedFolders();
  let enqueued = 0;
  let needsReauthCount = 0;

  for (const folder of folders) {
    try {
      const dir = new Directory(folder.uri);
      if (!dir.exists) {
        folder.status = 'needs_reauth';
        folder.lastError = 'Folder dipindah atau izin dicabut. Pilih ulang folder untuk melanjutkan antrean.';
        needsReauthCount++;
        continue;
      }

      const entries = dir.list();
      for (const entry of entries) {
        if (!(entry instanceof File)) {
          continue;
        }
        const sizeBytes = entry.size;
        const mtime = entry.lastModified ?? 0;
        const sourceAssetId = `wf:${folder.id}:${entry.name}`;
        const sourceRevision = `${sizeBytes}:${mtime}`;

        if (await hasSourceInQueue(sourceAssetId, sourceRevision)) {
          continue;
        }

        const id = Crypto.randomUUID();
        const now = Date.now();
        await upsertQueueItem({
          id,
          idempotencyKey: `wf-${folder.id.slice(0, 8)}-${entry.name}-${sourceRevision}`,
          sourceType: 'watched_folder',
          sourceAssetId,
          sourceRevision,
          localUri: entry.uri,
          filename: entry.name,
          mimeType: entry.type || 'application/octet-stream',
          sizeBytes,
          sha256: null,
          space: 'regular',
          folderId: null,
          uploadSessionId: null,
          uploadedOffset: 0,
          status: 'pending',
          errorCode: null,
          errorMessage: null,
          attempts: 0,
          nextRetryAt: null,
          serverFileId: null,
          createdAt: now,
          updatedAt: now,
        });
        enqueued++;
      }

      folder.status = 'active';
      folder.lastError = null;
      folder.lastScannedAt = Date.now();
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
  return { enqueued, needsReauthCount };
}
