import * as LegacyMedia from 'expo-media-library/legacy';

import { deviceCatalog, type CatalogEntry } from './device-catalog';

type GalleryPage = {
  entries: CatalogEntry[];
  fraction: number;
  source: string;
  volume?: string;
  maxCursor?: number;
};

export async function* androidGalleryPages(
  afterByVolume?: Record<string, number>,
  deltaOnly = false,
): AsyncGenerator<GalleryPage> {
  const pageSize = 250;
  if (deviceCatalog) {
    const volumes = await deviceCatalog.indexedVolumes?.() ?? ['external'];
    for (const [index, volume] of volumes.entries()) {
      const startAfter = afterByVolume?.[volume] ?? 0;
      // In delta-only mode, NEVER fall back to scanning from cursor 0!
      if (deltaOnly && startAfter <= 0) continue;
      const total = startAfter > 0
        ? 0
        : await (deviceCatalog.countForVolume?.(volume) ?? deviceCatalog.indexedCount?.())?.catch(() => 0);
      const source = volume === 'external_primary' || volume === 'external' ? 'Penyimpanan bersama' : 'Volume ' + volume;
      let after = startAfter;
      let visited = 0;
      let pagesRead = 0;
      const maxPages = deltaOnly ? 2 : Infinity;
      while (pagesRead < maxPages) {
        const entries = await (deviceCatalog.pageForVolume?.(volume, after) ?? deviceCatalog.page(after));
        pagesRead++;
        visited += entries.length;
        const done = entries.length < pageSize;
        const fraction = done ? 1 : total ? Math.min(visited / total, 1) : 0;
        const maxCursor = entries.length > 0 ? entries[entries.length - 1].cursor : after;
        yield { entries, source, volume, maxCursor, fraction: (index + fraction) / volumes.length };
        if (done) break;
        if (maxCursor <= after) throw new Error('Kursor indeks Android tidak bergerak.');
        after = maxCursor;
      }
    }
    return;
  }

  // Expo Go exposes file paths in the paged Android MediaLibrary response.
  let after: string | undefined;
  let visited = 0;
  const maxDeltaPages = deltaOnly || afterByVolume ? 1 : Infinity;
  let pagesRead = 0;
  while (pagesRead < maxDeltaPages) {
    const page = await LegacyMedia.getAssetsAsync({
      first: deltaOnly || afterByVolume ? 40 : pageSize,
      after,
      mediaType: [],
      sortBy: [['modificationTime', false]],
      resolveWithFullInfo: false,
    });
    pagesRead++;
    const entries = page.assets.flatMap(asset => {
      if (!asset.uri.startsWith('file://')) return [];
      const path = asset.uri.slice(7);
      const collection = asset.mediaType === 'photo' ? 'images/media' : asset.mediaType === 'video'
        ? 'video/media' : asset.mediaType === 'audio' ? 'audio/media' : 'file';
      return [{
        cursor: Number(asset.id), id: `content://media/external/${collection}/${asset.id}`,
        path, filename: asset.filename, mime: '', size: 0, duration: asset.duration * 1000,
        modificationTime: asset.modificationTime, mediaType: asset.mediaType,
      }];
    });
    visited += page.assets.length;
    yield { entries, source: 'Galeri Android', fraction: page.totalCount ? Math.min(1, visited / page.totalCount) : 1 };
    if (!page.hasNextPage || !page.assets.length) break;
    if (after === page.endCursor) throw new Error('Kursor galeri Android tidak bergerak.');
    after = page.endCursor;
  }
}
