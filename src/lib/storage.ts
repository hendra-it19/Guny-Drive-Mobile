import * as SQLite from 'expo-sqlite';

import {
  QueueItem,
  QueueSourceType,
  QueueStatus,
  WorkerRunLog,
  WorkerTriggerType,
} from './storage.types';

export type {
  QueueItem,
  QueueSourceType,
  QueueStatus,
  WorkerRunLog,
  WorkerTriggerType,
} from './storage.types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('gunydrive.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backup_queue (
          id TEXT PRIMARY KEY NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          source_type TEXT NOT NULL,
          source_asset_id TEXT,
          source_revision TEXT,
          local_uri TEXT NOT NULL,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT,
          space TEXT NOT NULL DEFAULT 'regular',
          folder_id TEXT,
          upload_session_id TEXT,
          uploaded_offset INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          error_code TEXT,
          error_message TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER,
          server_file_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS worker_runs (
          id TEXT PRIMARY KEY NOT NULL,
          trigger TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER NOT NULL,
          network_type TEXT NOT NULL,
          battery_state TEXT NOT NULL,
          permission_status TEXT NOT NULL,
          uploaded_count INTEGER NOT NULL DEFAULT 0,
          pending_count INTEGER NOT NULL DEFAULT 0,
          last_checkpoint_offset INTEGER NOT NULL DEFAULT 0,
          delay_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_queue_status ON backup_queue(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_queue_source ON backup_queue(source_asset_id, source_revision);
        CREATE INDEX IF NOT EXISTS idx_worker_runs_time ON worker_runs(started_at DESC);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM preferences WHERE key = ?',
      [key],
    );
    return row ? (JSON.parse(row.value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

type QueueRow = {
  id: string;
  idempotency_key: string;
  source_type: QueueSourceType;
  source_asset_id: string | null;
  source_revision: string | null;
  local_uri: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  space: 'regular' | 'private';
  folder_id: string | null;
  upload_session_id: string | null;
  uploaded_offset: number;
  status: QueueStatus;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  next_retry_at: number | null;
  server_file_id: string | null;
  created_at: number;
  updated_at: number;
};

function rowToItem(r: QueueRow): QueueItem {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    sourceType: r.source_type,
    sourceAssetId: r.source_asset_id,
    sourceRevision: r.source_revision,
    localUri: r.local_uri,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    space: r.space,
    folderId: r.folder_id,
    uploadSessionId: r.upload_session_id,
    uploadedOffset: r.uploaded_offset,
    status: r.status,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    attempts: r.attempts,
    nextRetryAt: r.next_retry_at,
    serverFileId: r.server_file_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listQueueItems(): Promise<QueueItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<QueueRow>('SELECT * FROM backup_queue ORDER BY created_at DESC');
  return rows.map(rowToItem);
}

export async function hasSourceInQueue(
  sourceAssetId: string,
  sourceRevision: string,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM backup_queue WHERE source_asset_id = ? AND source_revision = ? LIMIT 1',
    [sourceAssetId, sourceRevision],
  );
  return row !== null;
}

export async function upsertQueueItem(item: QueueItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO backup_queue (
      id, idempotency_key, source_type, source_asset_id, source_revision,
      local_uri, filename, mime_type, size_bytes, sha256, space, folder_id,
      upload_session_id, uploaded_offset, status, error_code, error_message,
      attempts, next_retry_at, server_file_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sha256 = excluded.sha256,
      upload_session_id = excluded.upload_session_id,
      uploaded_offset = excluded.uploaded_offset,
      status = excluded.status,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      attempts = excluded.attempts,
      next_retry_at = excluded.next_retry_at,
      server_file_id = excluded.server_file_id,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.idempotencyKey,
      item.sourceType,
      item.sourceAssetId,
      item.sourceRevision,
      item.localUri,
      item.filename,
      item.mimeType,
      item.sizeBytes,
      item.sha256,
      item.space,
      item.folderId,
      item.uploadSessionId,
      item.uploadedOffset,
      item.status,
      item.errorCode,
      item.errorMessage,
      item.attempts,
      item.nextRetryAt,
      item.serverFileId,
      item.createdAt,
      item.updatedAt,
    ],
  );
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM backup_queue WHERE id = ?', [id]);
}

type WorkerRunRow = {
  id: string;
  trigger: WorkerTriggerType;
  started_at: number;
  finished_at: number;
  network_type: string;
  battery_state: string;
  permission_status: string;
  uploaded_count: number;
  pending_count: number;
  last_checkpoint_offset: number;
  delay_reason: string | null;
};

export async function recordWorkerRun(log: WorkerRunLog): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO worker_runs (
      id, trigger, started_at, finished_at, network_type, battery_state,
      permission_status, uploaded_count, pending_count, last_checkpoint_offset, delay_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.trigger,
      log.startedAt,
      log.finishedAt,
      log.networkType,
      log.batteryState,
      log.permissionStatus,
      log.uploadedCount,
      log.pendingCount,
      log.lastCheckpointOffset,
      log.delayReason,
    ],
  );
}

export async function listWorkerRuns(limit = 30): Promise<WorkerRunLog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<WorkerRunRow>(
    'SELECT * FROM worker_runs ORDER BY started_at DESC LIMIT ?',
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    networkType: r.network_type,
    batteryState: r.battery_state,
    permissionStatus: r.permission_status,
    uploadedCount: r.uploaded_count,
    pendingCount: r.pending_count,
    lastCheckpointOffset: r.last_checkpoint_offset,
    delayReason: r.delay_reason,
  }));
}
