const ignoredDirectories = new Set(['android', 'cache', 'caches', 'code_cache', 'thumbcache', 'thumbnails', 'tmp', 'temp']);

export function ignoredScanSegment(segment: string): boolean {
  return segment.startsWith('.') || ignoredDirectories.has(segment.toLowerCase());
}

// ExternalStorageProvider returns document IDs such as primary:Android/data/…
export function excludedAndroidPath(value: string): boolean {
  let path = value;
  if (/^(file|content):\/\//.test(value)) {
    try { path = decodeURIComponent(value); } catch { /* Preserve literal percent characters. */ }
  }
  return path.split(/[/:]/).some(ignoredScanSegment);
}
