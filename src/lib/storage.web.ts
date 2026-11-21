import { QueueItem, WorkerRunLog } from './storage.types';

export type {
  QueueItem,
  QueueSourceType,
  QueueStatus,
  WorkerRunLog,
  WorkerTriggerType,
} from './storage.types';

const WEB_PREFIX = 'gunydrive_pref:';
const WEB_QUEUE_KEY = 'gunydrive_backup_queue';
const WEB_RUNS_KEY = 'gunydrive_worker_runs';

export async function loadDeviceCatalogSnapshot<T>(cacheKey = 'device_v1'): Promise<T | null> {
  return getPref<T | null>(`device_catalog_cache:${cacheKey}`, null);
}

export async function saveDeviceCatalogSnapshot<T>(value: T, cacheKey = 'device_v1'): Promise<void> {
  await setPref(`device_catalog_cache:${cacheKey}`, value);
}

export async function clearDeviceCatalogSnapshot(cacheKey = 'device_v1'): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`${WEB_PREFIX}device_catalog_cache:${cacheKey}`);
  }
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WEB_PREFIX + key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(WEB_PREFIX + key, JSON.stringify(value));
  }
}

function readWebQueue(): QueueItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WEB_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeWebQueue(items: QueueItem[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(WEB_QUEUE_KEY, JSON.stringify(items));
  }
}

export async function listQueueItems(): Promise<QueueItem[]> {
  return readWebQueue().sort((a, b) => b.createdAt - a.createdAt);
}

export async function hasSourceInQueue(
  sourceAssetId: string,
  sourceRevision: string,
): Promise<boolean> {
  return readWebQueue().some(
    (i) => i.sourceAssetId === sourceAssetId && i.sourceRevision === sourceRevision,
  );
}

export async function upsertQueueItem(item: QueueItem): Promise<void> {
  const items = readWebQueue().filter((i) => i.id !== item.id);
  items.unshift(item);
  writeWebQueue(items);
}

export async function createQueueWriter() {
  const insert = async (item: QueueItem) => {
    const rows = readWebQueue();
    if (rows.some(row => row.idempotencyKey === item.idempotencyKey || row.id === item.id)) return false;
    writeWebQueue([item, ...rows]);
    return true;
  };
  return { insert, complete: async (id: string, serverId: string, sha: string, size: number) => {
    const rows = readWebQueue();
    const row = rows.find(item => item.id === id);
    if (row) {
      Object.assign(row, { status: 'completed', serverFileId: serverId, sha256: sha, uploadedOffset: size, updatedAt: Date.now() });
      writeWebQueue(rows);
    }
  }, requestManual: async (id: string) => {
    const rows = readWebQueue();
    const item = rows.find(row => row.id === id);
    if (item && item.status !== 'completed') {
      item.sourceType = 'manual';
      if (['failed', 'paused', 'skipped'].includes(item.status)) item.status = 'pending';
      item.nextRetryAt = null;
      writeWebQueue(rows);
    }
  } };
}

export async function removeQueueItem(id: string): Promise<void> {
  writeWebQueue(readWebQueue().filter((i) => i.id !== id));
}

export async function recordWorkerRun(log: WorkerRunLog): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const existing = await listWorkerRuns(50);
  existing.unshift(log);
  localStorage.setItem(WEB_RUNS_KEY, JSON.stringify(existing.slice(0, 50)));
}

export async function listWorkerRuns(limit = 30): Promise<WorkerRunLog[]> {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WEB_RUNS_KEY);
    const parsed = raw ? (JSON.parse(raw) as WorkerRunLog[]) : [];
    return parsed.slice(0, limit);
  } catch {
    return [];
  }
}
