import { Directory, File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { ArrowLeft, CloudUpload, Folder } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, FlatList, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import {
  DefaultFileThumbnail,
  resolveClientThumbnailPreset,
} from '@/components/ui/DefaultFileThumbnail';
import { FileSkeleton } from '@/components/ui/FileSkeleton';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { transferQueuedFiles } from '@/lib/backup-engine';
import { deviceCatalog, type DirectoryEntry } from '@/lib/device-catalog';
import { readFolder, walkDirectory } from '@/lib/directory-scan';
import { formatBytes } from '@/lib/format';
import { backupLookupKey, createLocalEnqueuer, indexBackupQueue, sourceIdentity, sourceRevision } from '@/lib/local-backup';
import { listWatchedFolders, pickAndAddWatchedFolder } from '@/lib/watched-folders';

type Location = { uri: string; name: string };

export default function ExplorerScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { queue, refreshQueue, refreshServerInfo } = useApp();
  const [path, setPath] = useState<Location[]>([]);
  const [rows, setRows] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  const current = path.at(-1);
  const backed = useMemo(() => indexBackupQueue(queue), [queue]);
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setRefresh(value => value + 1);
    });
    return () => { mounted.current = false; sub.remove(); };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      let entries: DirectoryEntry[];
      if (current) {
        entries = await readFolder(current.uri);
      } else {
        const locations: Location[] = [];
        if (deviceCatalog?.storageRoots) {
          for (const uri of await deviceCatalog.storageRoots()) {
            locations.push({ uri, name: 'Penyimpanan ' + sourceIdentity(uri) });
          }
        }
        for (const folder of await listWatchedFolders()) locations.push({ uri: folder.uri, name: folder.label });
        const local = new Directory(Paths.document, 'perangkat-berkas');
        if (local.exists) locations.push({ uri: local.uri, name: 'Dokumen GunyDrive' });
        entries = locations.map(loc => ({ ...loc, directory: true, sizeBytes: 0, mtime: 0, mimeType: '' }));
      }
      if (active) {
        setError('');
        setRows(entries.sort((a,b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)));
      }
    }
    void load().catch(() => { if (active) setError('Folder tidak dapat dibaca. Periksa izin penyimpanan.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [current, refresh]);

  const navigate = (next: Location[]) => {
    setRows([]); setLoading(true); setError(''); setPath(next);
  };

  useEffect(() => {
    if (!path.length || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      navigate(path.slice(0, -1));
      return true;
    });
    return () => subscription.remove();
  }, [path]);

  const backup = useCallback(async (target: Location, folder: boolean, file?: DirectoryEntry) => {
    if (busy.current) return;
    busy.current = true;
    let added = 0, checked = 0, unreadable = 0;
    let lastRefresh = 0;
    const throttledRefresh = () => {
      if (Date.now() - lastRefresh > 1500) {
        lastRefresh = Date.now();
        void refreshQueue().catch(() => undefined);
      }
    };
    const update = (message: string) => { if (mounted.current) setNotice(message); };
    try {
      update('Menyiapkan antrean ' + target.name);
      const enqueue = await createLocalEnqueuer();
      const entries = folder ? walkDirectory(target.uri, target.name, () => { unreadable++; }, true) : file ? [file] : [];
      for await (const entry of entries) {
        if (await enqueue(entry, 'manual')) added++;
        checked++;
        if (checked % 25 === 0) update(`${checked} berkas diperiksa · ${added} masuk antrean`);
      }
      update(`${checked} diperiksa · ${added} baru · ${checked - added} sudah tercatat` +
        (unreadable ? ` · ${unreadable} folder tidak dapat dibaca` : ''));
      await refreshQueue();
      const result = await transferQueuedFiles(throttledRefresh);
      if (result.delayReason) update(result.delayReason);
      await Promise.all([refreshQueue(), refreshServerInfo()]);
    } catch (e) {
      update(e instanceof Error ? e.message : 'Backup gagal. Berkas yang sudah masuk antrean tetap tersimpan.');
      await refreshQueue();
    } finally { busy.current = false; }
  }, [refreshQueue, refreshServerInfo]);

  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background, padding: 16, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityLabel="Kembali" hitSlop={10} onPress={() => path.length ? navigate(path.slice(0,-1)) : router.back()}>
        <ArrowLeft color={palette.text} />
      </Pressable>
      <AppText weight="bold" size={22}>Jelajah penyimpanan</AppText>
    </View>
    <AppText numberOfLines={2} color="secondary">{path.map(p => p.name).join(' / ') || 'Lokasi penyimpanan'}</AppText>
    {current ? <Pressable onPress={() => void backup(current, true)} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
      <CloudUpload color={palette.accent}/><AppText color="accent" weight="bold">Backup folder ini dan subfolder</AppText>
    </Pressable> : Platform.OS !== 'web' && <Pressable onPress={async () => {
      try {
        if (deviceCatalog && Number(Platform.Version) >= 30 && !deviceCatalog.hasSharedStorageAccess()) {
          await deviceCatalog.requestSharedStorageAccess(); return;
        }
        const picked = await pickAndAddWatchedFolder();
        if (picked) navigate([{ uri: picked.uri, name: picked.label }]);
      } catch { setError('Akses folder belum diberikan.'); }
    }}><AppText color="accent" weight="bold">{deviceCatalog && Number(Platform.Version) >= 30 && !deviceCatalog.hasSharedStorageAccess() ? 'Izinkan akses penyimpanan bersama' : 'Buka lokasi lain…'}</AppText></Pressable>}
    {!!notice && <AppText accessibilityLiveRegion="polite" size={12}>{notice}</AppText>}
    {!!error && <AppText color="warning">{error}</AppText>}
    <FlatList data={rows} keyExtractor={row => row.uri} initialNumToRender={18} windowSize={7}
      ListEmptyComponent={loading ? <FileSkeleton layout="list"/> : <AppText color="secondary">{current ? 'Tidak ada berkas yang terlihat.' : 'Pilih lokasi penyimpanan untuk mulai menjelajah.'}</AppText>}
      renderItem={({item}) => {
        const record = backed.get(backupLookupKey(sourceIdentity(item.uri), sourceRevision(item)));
        const status = record?.status === 'completed' || record?.serverFileId ? 'Sudah dibackup'
          : record?.status === 'failed' ? 'Gagal' : record?.status === 'skipped' ? 'Dilewati' : record ? 'Dalam antrean' : 'Belum dibackup';
        return <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: palette.divider }}>
          <Pressable style={{ flex: 1, alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 12 }}
            onPress={() => {
              if (item.directory) navigate([...path, item]);
              else void new File(item.uri).preview().catch(() => Alert.alert(item.name, sourceIdentity(item.uri)));
            }}>
            {item.directory ? (
              <Folder color={palette.accent} />
            ) : (
              <DefaultFileThumbnail
                preset={resolveClientThumbnailPreset(item.name, item.mimeType)}
                size={36}
                compact
                borderRadius={9}
              />
            )}
            <View style={{ flex: 1 }}><AppText numberOfLines={1} weight="semibold">{item.name}</AppText>
              <AppText size={12} color="secondary">{item.directory ? 'Folder' : formatBytes(item.sizeBytes) + ' · ' + status}</AppText></View>
          </Pressable>
          {!item.directory && <Pressable accessibilityLabel={'Backup ' + item.name} hitSlop={8} onPress={() => void backup(item, false, item)}>
            <CloudUpload color={palette.accent} size={20}/></Pressable>}
        </View>;
      }}/>
  </SafeAreaView>;
}
