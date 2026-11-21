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
