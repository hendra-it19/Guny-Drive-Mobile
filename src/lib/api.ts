import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { StoredCredentials } from './credentials';

export type DriveFolder = {
  id: string;
  parent_id: string | null;
  space: 'regular' | 'private';
  name: string;
  files_count: number;
  created_at: string;
  updated_at: string;
};

export type DriveFile = {
  id: string;
  folder_id: string | null;
  space: 'regular' | 'private';
  name: string;
  size_bytes: number;
  sha256: string;
  mime_type: string;
  category: 'image' | 'video' | 'document' | 'audio' | 'archive' | 'other';
  has_preview: boolean;
  has_thumbnail: boolean;
  media_taken_at: string | null;
  status: string;
  deleted_at: string | null;
  purge_after_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UsageSummary = {
  quota_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
  available_bytes: number;
  max_file_bytes: number;
  total_files: number;
  trash_bytes: number;
  private_bytes: number;
  over_quota: boolean;
  updated_at: string;
};

export type MeResponse = {
  server: { name: string; api_version: string; time_utc: string };
  owner: { id: number; name: string; email: string };
  device: { id: string; name: string; platform: string | null; last_backup_at: string | null } | null;
  vault_configured: boolean;
  usage: UsageSummary;
};

export type DirectoryResponse = {
  folders: DriveFolder[];
  files: DriveFile[];
  breadcrumbs: { id: string; name: string }[];
  next_cursor: string | null;
};

export type UploadSessionResponse = {
  id: string;
  space: 'regular' | 'private';
  folder_id: string | null;
  filename: string;
  total_size_bytes: number;
  received_offset: number;
  status: string;
  completed_file_id: string | null;
  expires_at: string;
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class GunyDriveApi {
  constructor(
    private readonly creds: StoredCredentials,
    private readonly onAuthRevoked?: () => void,
  ) {}

  get serverUrl(): string {
    return this.creds.serverUrl;
  }

  authHeaders(vaultToken?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.deviceToken}`,
      Accept: 'application/json',
    };
    if (vaultToken) {
      headers['X-Vault-Token'] = vaultToken;
    }
    return headers;
  }

  thumbnailUrl(fileId: string): string {
    return `${this.creds.serverUrl}/api/v1/files/${fileId}/thumbnail`;
  }

  contentUrl(fileId: string, inline = false): string {
    return `${this.creds.serverUrl}/api/v1/files/${fileId}/content${inline ? '?inline=1' : ''}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    vaultToken?: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.authHeaders(vaultToken),
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetch(`${this.creds.serverUrl}/api/v1${path}`, {
      ...init,
      headers,
    });

    const requestId = res.headers.get('X-Request-Id') ?? undefined;
    const retryHeader = res.headers.get('Retry-After');
    const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;

    if (!res.ok) {
      let body: { code?: string; message?: string; details?: Record<string, unknown> } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // Non-JSON error body
      }
      const code = body.code ?? `http_${res.status}`;
      const message = body.message ?? `Permintaan gagal (${res.status}).`;

      if (res.status === 401 && (code === 'token_revoked' || code === 'token_expired')) {
        this.onAuthRevoked?.();
      }

      throw new ApiError(code, message, res.status, requestId, retryAfter, body.details);
    }

    return (await res.json()) as T;
  }

  getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('/me');
  }

  getUsage(): Promise<UsageSummary> {
    return this.request<UsageSummary>('/usage');
  }

  listFiles(params: {
    folderId?: string | null;
    q?: string;
    category?: string;
    sort?: 'date' | 'name' | 'size';
    cursor?: string | null;
  }): Promise<DirectoryResponse> {
    const qs = new URLSearchParams();
    if (params.folderId) qs.set('folder_id', params.folderId);
    if (params.q) qs.set('q', params.q);
    if (params.category && params.category !== 'all') qs.set('category', params.category);
    if (params.sort) qs.set('sort', params.sort);
    if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<DirectoryResponse>(`/files${suffix}`);
  }

  createFolder(name: string, parentId?: string | null): Promise<{ folder: DriveFolder }> {
    return this.request('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: parentId ?? null }),
    });
  }

  updateFile(fileId: string, patch: { name?: string; folder_id?: string | null }): Promise<{ file: DriveFile }> {
    return this.request(`/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  trashFile(fileId: string): Promise<{ file: DriveFile }> {
    return this.request(`/files/${fileId}`, { method: 'DELETE' });
  }

  listMedia(type: 'all' | 'image' | 'video' = 'all', cursor?: string | null): Promise<{
    items: DriveFile[];
    total_count: number;
    next_cursor: string | null;
  }> {
    const qs = new URLSearchParams({ type });
    if (cursor) qs.set('cursor', cursor);
    return this.request(`/media?${qs.toString()}`);
  }

  listTrash(): Promise<{ files: DriveFile[] }> {
    return this.request('/trash');
  }

  restoreTrash(fileId: string): Promise<{ file: DriveFile }> {
    return this.request(`/trash/${fileId}/restore`, { method: 'POST' });
  }

  purgeTrash(fileId: string): Promise<{ purged: boolean }> {
    return this.request(`/trash/${fileId}`, { method: 'DELETE' });
  }

  createUploadSession(
    payload: {
      idempotency_key: string;
      filename: string;
      total_size_bytes: number;
      expected_sha256: string;
      space?: 'regular' | 'private';
      folder_id?: string | null;
      mime_type?: string | null;
      media_taken_at?: string | null;
      source_asset_id?: string | null;
      source_revision?: string | null;
      auto_backup?: boolean;
    },
    vaultToken?: string | null,
  ): Promise<{ upload?: UploadSessionResponse; file?: DriveFile; skipped?: boolean; reason?: string }> {
    return this.request(
      '/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      vaultToken,
    );
  }

  getUploadSession(uploadId: string, vaultToken?: string | null): Promise<{ upload: UploadSessionResponse }> {
    return this.request(`/uploads/${uploadId}`, {}, vaultToken);
  }

  uploadChunk(
    uploadId: string,
    offset: number,
    chunk: Uint8Array,
    chunkSha256: string,
    vaultToken?: string | null,
  ): Promise<{ upload: UploadSessionResponse }> {
    const body = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    return this.request(
      `/uploads/${uploadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Upload-Offset': String(offset),
          'Upload-Checksum': chunkSha256,
        },
        body,
      },
      vaultToken,
    );
  }

  completeUpload(uploadId: string, vaultToken?: string | null): Promise<{ file: DriveFile }> {
    return this.request(`/uploads/${uploadId}/complete`, { method: 'POST' }, vaultToken);
  }

  abortUpload(uploadId: string, vaultToken?: string | null): Promise<{ aborted: boolean }> {
    return this.request(`/uploads/${uploadId}`, { method: 'DELETE' }, vaultToken);
  }

  unlockVault(passphrase: string): Promise<{
    vault_token: string;
    expires_at: string;
    idle_timeout_seconds: number;
  }> {
    return this.request('/vault/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
  }

  lockVault(vaultToken: string): Promise<{ locked: boolean }> {
    return this.request('/vault/session', { method: 'DELETE' }, vaultToken);
  }

  listVaultFiles(
    vaultToken: string,
    params: { folderId?: string | null; q?: string } = {},
  ): Promise<DirectoryResponse> {
    const qs = new URLSearchParams();
    if (params.folderId) qs.set('folder_id', params.folderId);
    if (params.q) qs.set('q', params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/vault/files${suffix}`, {}, vaultToken);
  }

  createVaultFolder(vaultToken: string, name: string, parentId?: string | null): Promise<{ folder: DriveFolder }> {
    return this.request(
      '/vault/folders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: parentId ?? null }),
      },
      vaultToken,
    );
  }

  moveFileIntoVault(vaultToken: string, fileId: string, folderId?: string | null): Promise<{ file: DriveFile }> {
    return this.request(
      `/vault/files/${fileId}/move-in`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId ?? null }),
      },
      vaultToken,
    );
  }

  trashVaultFile(vaultToken: string, fileId: string): Promise<{ file: DriveFile }> {
    return this.request(`/vault/files/${fileId}`, { method: 'DELETE' }, vaultToken);
  }

  async downloadAndVerify(
    file: DriveFile,
    vaultToken?: string | null,
  ): Promise<{ localUri: string; verified: boolean }> {
    if (Platform.OS === 'web') {
      throw new ApiError('unsupported_web', 'Unduhan file lokal penuh tersedia di Android dan iOS.', 400);
    }

    const downloadsDir = new Directory(Paths.cache, 'downloads');
    if (!downloadsDir.exists) {
      downloadsDir.create({ intermediates: true, idempotent: true });
    }
    const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
    const target = new File(downloadsDir, `${file.id.slice(0, 8)}_${safeName}`);

    const downloaded = await File.downloadFileAsync(this.contentUrl(file.id), target, {
      headers: this.authHeaders(vaultToken),
      idempotent: true,
    });

    const actualSha = (await downloaded.digest('SHA-256')).toLowerCase();
    const verified = actualSha === file.sha256.toLowerCase();
    if (!verified) {
      downloaded.delete();
      throw new ApiError('download_checksum_mismatch', 'Checksum berkas hasil unduhan tidak cocok dengan server.', 422);
    }

    return { localUri: downloaded.uri, verified };
  }
}
