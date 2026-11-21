import * as Crypto from 'expo-crypto';
import { createQueueWriter, listQueueItems, type QueueItem } from './storage';

export type LocalSource = { uri: string; name: string; sizeBytes: number; mtime: number; mimeType: string };
export const sourceRevision = (source: LocalSource) => `${source.sizeBytes}:${source.mtime}`;

export function sourceIdentity(uri: string) {
  if (!uri.startsWith('file://')) return uri;
  try { return decodeURIComponent(uri).replace(/^file:\/*/, '/'); }
  catch { return uri; }
}

export function backupLookupKey(identity: string, revision: string): string {
  return `${identity}\0${revision}`;
}

export function indexBackupQueue(queue: QueueItem[]) {
  const index = new Map<string, QueueItem>();
  for (const item of queue) {
    if (item.space !== 'regular' || item.folderId || !item.sourceRevision) continue;
    for (const uri of [item.localUri, item.sourceAssetId]) {
      if (!uri) continue;
      const key = backupLookupKey(sourceIdentity(uri), item.sourceRevision);
      if (!index.has(key) || item.status === 'completed') index.set(key, item);
    }
  }
  return index;
}

export async function createLocalEnqueuer() {
  const [writer, rows] = await Promise.all([createQueueWriter(), listQueueItems()]);
  const known = indexBackupQueue(rows);
  return async (source: LocalSource, sourceType: QueueItem['sourceType'], assetId = source.uri, completed?: { id: string; sha256: string }) => {
    const revision = sourceRevision(source);
    const idKey = sourceIdentity(source.uri);
    const lookupKey = backupLookupKey(idKey, revision);
    const existing = known.get(lookupKey) ?? known.get(backupLookupKey(sourceIdentity(assetId), revision));
    if (existing) {
      if (completed) await writer.complete(existing.id, completed.id, completed.sha256, source.sizeBytes);
      else if (sourceType === 'manual' && existing.status !== 'completed') await writer.requestManual(existing.id);
      return false;
    }
    const key = JSON.stringify([idKey, revision]);
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
    const now = Date.now();
    const item: QueueItem = {
      id: Crypto.randomUUID(), idempotencyKey: `source-${hash}`, sourceType, sourceAssetId: assetId,
      sourceRevision: revision, localUri: source.uri, filename: source.name, mimeType: source.mimeType,
      sizeBytes: source.sizeBytes, sha256: completed?.sha256 ?? null, space: 'regular', folderId: null,
      uploadSessionId: null, uploadedOffset: completed ? source.sizeBytes : 0, status: completed ? 'completed' : 'pending', errorCode: null, errorMessage: null,
      attempts: 0, nextRetryAt: null, serverFileId: completed?.id ?? null, createdAt: now, updatedAt: now,
    };
    const added = await writer.insert(item);
    known.set(lookupKey, item);
    if (assetId !== source.uri) {
      known.set(backupLookupKey(sourceIdentity(assetId), revision), item);
    }
    return added;
  };
}
