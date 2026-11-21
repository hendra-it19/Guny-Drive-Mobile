import { requireOptionalNativeModule } from 'expo';

export type DirectoryEntry = {
  uri: string; name: string; directory: boolean; sizeBytes: number; mtime: number; mimeType: string;
};

export type CatalogEntry = {
  mediaType?: string;
  cursor: number;
  id: string;
  filename: string | null;
  mime: string;
  size: number;
  path: string | null;
  modificationTime: number;
  duration: number | null;
};

export const deviceCatalog = requireOptionalNativeModule<{
  storageRoots(): Promise<string[]>;
  listDirectory(uri: string): Promise<DirectoryEntry[]>;
  indexedVolumes?(): Promise<string[]>;
  countForVolume?(volume: string): Promise<number>;
  pageForVolume?(volume: string, after: number): Promise<CatalogEntry[]>;
  indexedCount?(): Promise<number>;
  page(after: number): Promise<CatalogEntry[]>;
  hasSharedStorageAccess(): boolean;
  requestSharedStorageAccess(): Promise<void>;
  thumbnail(uri: string): Promise<string | null>;
  canInstallPackages?(): boolean;
  requestInstallPackagesPermission?(): Promise<void>;
  installApk?(uri: string): Promise<'installing' | 'permission_required'>;
}>('GunyDeviceCatalog');

const thumbnails = new Map<string, Promise<string | null>>();
const MAX_CONCURRENT_THUMBS = 2;
let activeThumbs = 0;
const thumbQueue: (() => void)[] = [];

function scheduleThumbTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeThumbs++;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeThumbs--;
          const next = thumbQueue.shift();
          if (next) setTimeout(next, 8);
        });
    };
    if (activeThumbs < MAX_CONCURRENT_THUMBS) {
      run();
    } else {
      thumbQueue.push(run);
    }
  });
}

export function getLocalThumbnail(uri: string, modifiedAt: number) {
  if (!deviceCatalog || !uri.startsWith('content://')) return Promise.resolve(null);
  const key = `${uri}:${modifiedAt}`;
  const cached = thumbnails.get(key);
  if (cached) return cached;
  const thumbnail = scheduleThumbTask(() => deviceCatalog!.thumbnail(uri).catch(() => null));
  thumbnails.set(key, thumbnail);
  if (thumbnails.size > 160) thumbnails.delete(thumbnails.keys().next().value!);
  return thumbnail;
}
