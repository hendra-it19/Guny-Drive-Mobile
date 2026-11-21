import { Platform } from 'react-native';
import { ignoredScanSegment, excludedAndroidPath } from './scan-paths';
import { Directory, File } from 'expo-file-system';
import { deviceCatalog, type DirectoryEntry } from './device-catalog';

const yieldFrame = (ms = 32) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readFolder(uri: string): Promise<DirectoryEntry[]> {
  if (deviceCatalog?.listDirectory && uri.startsWith('file://')) return deviceCatalog.listDirectory(uri);
  const dir = new Directory(uri);
  if (!dir.exists) throw new Error('Folder tidak dapat diakses.');
  const entries: DirectoryEntry[] = [];
  for (const item of dir.list()) {
    if (entries.length > 0 && entries.length % 16 === 0) await yieldFrame();
    const directory = item instanceof Directory;
    entries.push({
      directory, uri: directory ? item.uri.replace(/\/+$/, '') : item.uri, name: item.name,
      sizeBytes: item instanceof File ? item.size || 0 : 0,
      mtime: item instanceof File ? item.lastModified ?? 0 : 0,
      mimeType: item instanceof File ? item.type || '' : '',
    });
  }
  return entries;
}

export async function* walkDirectory(uri: string, label: string, onUnreadable?: (uri: string) => void, includeHidden = false, appOwned = false, maxDepth = 5) {
  const automaticAndroid = !includeHidden && Platform.OS === 'android';
  if (automaticAndroid && !appOwned && excludedAndroidPath(uri)) return;
  const pending = [{ uri, label, depth: 0 }];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current.uri)) continue;
    visited.add(current.uri);
    await yieldFrame();
    let entries: DirectoryEntry[];
    try {
      entries = await readFolder(current.uri);
    } catch (error) {
      if (current.uri === uri) throw error;
      onUnreadable?.(current.uri);
      continue;
    }
    if (automaticAndroid && entries.some(entry => entry.name.toLowerCase() === '.nomedia')) continue;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && i % 40 === 0) await yieldFrame();
      const entry = entries[i];
      if (automaticAndroid && (entry.directory ? ignoredScanSegment(entry.name) : entry.name.startsWith('.'))) continue;
      if (entry.directory) {
        if (current.depth < maxDepth && (includeHidden || !entry.name.startsWith('.'))) {
          pending.push({ uri: entry.uri, label: current.label + '/' + entry.name, depth: current.depth + 1 });
        }
      } else if (includeHidden || !entry.uri.startsWith('content://') || !entry.name.startsWith('.')) {
        yield { ...entry, folderLabel: current.label };
      }
    }
  }
}
