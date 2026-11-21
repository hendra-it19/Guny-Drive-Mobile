export type QueueStatus = 'pending' | 'uploading' | 'completed' | 'paused' | 'failed' | 'skipped';
export type QueueSourceType = 'gallery' | 'inbox' | 'manual' | 'watched_folder';

export type QueueItem = {
  id: string;
  idempotencyKey: string;
  sourceType: QueueSourceType;
  sourceAssetId: string | null;
  sourceRevision: string | null;
  localUri: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  space: 'regular' | 'private';
  folderId: string | null;
  uploadSessionId: string | null;
  uploadedOffset: number;
  status: QueueStatus;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  nextRetryAt: number | null;
  serverFileId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkerTriggerType = 'os_background' | 'app_open' | 'debug' | 'manual';

export type WorkerRunLog = {
  id: string;
  trigger: WorkerTriggerType;
  startedAt: number;
  finishedAt: number;
  networkType: string;
  batteryState: string;
  permissionStatus: string;
  uploadedCount: number;
  pendingCount: number;
  lastCheckpointOffset: number;
  delayReason: string | null;
};
