import { FileSkeleton } from '@/components/ui/FileSkeleton';
import { ActionPressable } from '@/components/ui/ActionPressable';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  Edit3,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Lock,
  Scissors,
  Trash2,
  Upload,
  X,
} from 'lucide-react-native';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSectionSlideAnimation } from '@/components/ui/AnimatedTabContainer';
import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Chip } from '@/components/ui/Chip';
import { DeviceFileManager } from '@/components/ui/DeviceFileManager';
import {
  DriveFileGridTile,
  getDriveFileThumbnailSource,
} from '@/components/ui/DriveFileGridTile';
import { FabButton } from '@/components/ui/FabButton';
import { FileRow, FileRowKind } from '@/components/ui/FileRow';
import {
  FileViewToolbar,
  getGridMetrics,
  sortFileEntries,
  useFileViewPreferences,
} from '@/components/ui/FileViewToolbar';
import { OnlineFileViewerModal } from '@/components/ui/OnlineFileViewerModal';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SearchField } from '@/components/ui/SearchField';
import { Segmented } from '@/components/ui/Segmented';
import { Surface } from '@/components/ui/Surface';
import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile, DriveFolder } from '@/lib/api';
import { uploadLocalFileDirect } from '@/lib/backup-engine';
import {
  notifyPermissionRefresh,
  type scanAllDeviceFiles,
  subscribePermissionRefresh,
  pickLocalFilesWithoutCopy,
  requestDeviceDirectoryPermission,
} from '@/lib/device-files';
import { formatBytes, formatShortTime } from '@/lib/format';

type FilterCategory = 'all' | 'document' | 'media' | 'archive';

type ListEntry =
  | { kind: 'folder'; folder: DriveFolder }
  | { kind: 'file'; file: DriveFile }
  | { kind: 'private-shortcut' };

type CloudVirtualRow =
  | { kind: 'list-entry'; key: string; entry: ListEntry; index: number; total: number }
  | { kind: 'grid-row'; key: string; entries: ListEntry[] };

type CloudClipboardItem =
  | { kind: 'file'; file: DriveFile }
  | { kind: 'folder'; folder: DriveFolder };

type CloudClipboard = {
  mode: 'copy' | 'cut';
  sourceFolderId: string | null;
  items: CloudClipboardItem[];
};

const PAGE_SIZE = 24;

export default function BerkasScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { api, usage, vaultToken, refreshServerInfo, refreshQueue } = useApp();
  const { width: windowWidth } = useWindowDimensions();

  const {
    layout: cloudLayout,
    sort: cloudSort,
    setLayout: setCloudLayout,
    setSort: setCloudSort,
  } = useFileViewPreferences('file_view_pref_cloud_v1', 'list', 'newest');
  const { columns: cloudColumns, gap: cloudGridGap, tileSize: cloudTileSize } = getGridMetrics(
    windowWidth,
    cloudLayout,
  );

  const scanCacheRef = useMemo(() => ({ account: api, current: null as Awaited<ReturnType<typeof scanAllDeviceFiles>> | null }), [api]);
  useEffect(() => {
    const clear = () => { scanCacheRef.current = null; };
    const unsubscribe = subscribePermissionRefresh(clear);
    return () => { unsubscribe(); };
  }, [scanCacheRef]);
  const [sourceScope, setSourceScope] = useState<'device' | 'cloud'>('device');
  const {
    translateX: scopeTranslateX,
    opacity: scopeOpacity,
    animateSectionSwitch,
  } = useSectionSlideAnimation();

  // Cloud directory state (with cursor-based infinite scroll)
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FilterCategory>('all');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [cloudNextCursor, setCloudNextCursor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMoreCloud, setLoadingMoreCloud] = useState(false);
  const loadingMoreCloudRef = useRef(false);

  // Unified all-folders cloud catalog so Sistem HP always shows backed-up files (even those uploaded inside folders!)
  const [allCloudFiles, setAllCloudFiles] = useState<DriveFile[]>([]);
  const [allCloudNextCursor, setAllCloudNextCursor] = useState<string | null>(null);
  const [loadingMoreAllCloud, setLoadingMoreAllCloud] = useState(false);
  const loadingMoreAllRef = useRef(false);
  const [deviceLoadMoreSignal, setDeviceLoadMoreSignal] = useState(0);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Cloud Server Explorer: Multi-select, Copy/Cut/Paste Clipboard, Rename, Folder Controls
  const [cloudSelectMode, setCloudSelectMode] = useState(false);
  const [cloudSelectedKeys, setCloudSelectedKeys] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<CloudClipboard | null>(null);
  const [renameTarget, setRenameTarget] = useState<CloudClipboardItem | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const apiSortKey: 'date' | 'name' | 'size' =
    cloudSort === 'name_asc' || cloudSort === 'name_desc'
      ? 'name'
      : cloudSort === 'size_desc' || cloudSort === 'size_asc'
        ? 'size'
        : 'date';

  const fetchDirectory = useCallback(async () => {
    if (!api) {
      setFolders([]);
      setFiles([]);
      setBreadcrumbs([]);
      setCloudNextCursor(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.listFiles({
        folderId,
        q: query.trim() || undefined,
        category,
        sort: apiSortKey,
        perPage: PAGE_SIZE,
      });
      setFolders(res.folders);
      setFiles(res.files);
      setBreadcrumbs(res.breadcrumbs);
      setCloudNextCursor(res.next_cursor ?? null);
    } catch {
      // Offline — preserve last rendered items.
    } finally {
      setLoading(false);
    }
  }, [api, apiSortKey, category, folderId, query]);

  const loadMoreCloudDirectory = useCallback(async () => {
    if (!api || !cloudNextCursor || loading || loadingMoreCloudRef.current) return;
    loadingMoreCloudRef.current = true;
    setLoadingMoreCloud(true);
    try {
      const res = await api.listFiles({
        folderId,
        q: query.trim() || undefined,
        category,
        sort: apiSortKey,
        cursor: cloudNextCursor,
        perPage: PAGE_SIZE,
      });
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...res.files.filter((f) => !seen.has(f.id))];
      });
      setCloudNextCursor(res.next_cursor ?? null);
    } catch {
      // Keep current loaded list
    } finally {
      loadingMoreCloudRef.current = false;
      setLoadingMoreCloud(false);
    }
  }, [api, apiSortKey, category, cloudNextCursor, folderId, loading, query]);

  const fetchAllCloudFiles = useCallback(async () => {
    if (!api) {
      setAllCloudFiles([]);
      setAllCloudNextCursor(null);
      return;
    }
    try {
      const res = await api.listMedia('everything', null, 48);
      setAllCloudFiles(res.items);
      setAllCloudNextCursor(res.next_cursor ?? null);
    } catch {
      // Keep last synced list
    }
  }, [api]);

  const loadMoreAllCloudFiles = useCallback(async () => {
    if (!api || !allCloudNextCursor || loadingMoreAllRef.current) return;
    loadingMoreAllRef.current = true;
    setLoadingMoreAllCloud(true);
    try {
      const res = await api.listMedia('everything', allCloudNextCursor, 48);
      setAllCloudFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...res.items.filter((f) => !seen.has(f.id))];
      });
      setAllCloudNextCursor(res.next_cursor ?? null);
    } catch {
      // Keep existing
    } finally {
      loadingMoreAllRef.current = false;
      setLoadingMoreAllCloud(false);
    }
  }, [allCloudNextCursor, api]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchDirectory(), fetchAllCloudFiles()]);
  }, [fetchAllCloudFiles, fetchDirectory]);

  useEffect(() => {
    // Only fetch cloud directory immediately when Cloud tab is active; otherwise defer so UI opens smoothly
    const delay = sourceScope === 'cloud' ? 80 : 900;
    const t = setTimeout(() => {
      void fetchDirectory();
    }, delay);
    return () => clearTimeout(t);
  }, [fetchDirectory, sourceScope, usage?.total_files]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .listMedia('everything', null, 48)
      .then((res) => {
        if (!active) return;
        setAllCloudFiles(res.items);
        setAllCloudNextCursor(res.next_cursor ?? null);
      })
      .catch(() => {
        // Keep last synced list
      });
    return () => {
      active = false;
    };
  }, [api, usage?.total_files]);

  // Unified Upload WITHOUT copying to local app storage -> appears immediately in BOTH Cloud & Sistem HP!
  const handleUploadDirect = async () => {
    setAddSheetOpen(false);
    if (!api) {
      router.push('/settings/connect');
      return;
    }
    const pickedFiles = await pickLocalFilesWithoutCopy();
    if (pickedFiles.length === 0) return;

    let uploadedCount = 0;
    try {
      for (const asset of pickedFiles) {
        setBusyAction(
          pickedFiles.length > 1
            ? `Mengunggah ${asset.name} (${uploadedCount + 1}/${pickedFiles.length})…`
            : `Mengunggah ${asset.name}…`,
        );
        await uploadLocalFileDirect({
          api,
          localUri: asset.uri,
          filename: asset.name,
          mimeType: asset.mimeType,
          space: 'regular',
          folderId: sourceScope === 'cloud' ? folderId : null,
          existingServerFiles: allCloudFiles,
        });
        uploadedCount++;
      }
      await Promise.all([refreshAll(), refreshServerInfo(), refreshQueue()]);
    } catch (err) {
      Alert.alert(
        'Unggah gagal',
        err instanceof Error ? err.message : 'Gagal mengunggah berkas.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectFolder = async () => {
    setAddSheetOpen(false);
    try {
      const folder = await requestDeviceDirectoryPermission();
      if (folder) {
        notifyPermissionRefresh();
      }
    } catch (err) {
      Alert.alert(
        'Gagal memilih folder',
        err instanceof Error ? err.message : 'Pemilihan folder dibatalkan.',
      );
    }
  };

  const handleCreateFolder = async () => {
    if (!api) {
      router.push('/settings/connect');
      return;
    }
    const clean = newFolderName.trim();
    if (!clean) return;
    setNewFolderModal(false);
    setNewFolderName('');
    try {
      await api.createFolder(clean, folderId);
      await fetchDirectory();
    } catch (err) {
      Alert.alert('Gagal membuat folder', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const handleDownloadFile = async (file: DriveFile) => {
    if (!api) return;
    setBusyAction(`Mengunduh ${file.name}…`);
    try {
      const { localUri } = await api.downloadAndVerify(file);
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(localUri, { dialogTitle: `Simpan ${file.name}` });
      } else {
        Alert.alert('Unduhan terverifikasi', `SHA-256 cocok. Berkas disimpan sementara di ${localUri}`);
      }
    } catch (err) {
      Alert.alert('Gagal mengunduh', err instanceof Error ? err.message : 'Checksum atau jaringan bermasalah.');
    } finally {
      setBusyAction(null);
      setSelectedFile(null);
    }
  };

  const handleTrashFile = async (file: DriveFile) => {
    if (!api) return;
    Alert.alert(
      'Pindahkan ke Sampah?',
      `Salinan "${file.name}" di server akan masuk Sampah selama 30 hari. Salinan lokal di ponsel tidak terpengaruh.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Pindahkan ke Sampah',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.trashFile(file.id);
              setSelectedFile(null);
              await Promise.all([refreshAll(), refreshServerInfo(), refreshQueue()]);
            } catch (err) {
              Alert.alert('Gagal', err instanceof Error ? err.message : 'Tidak dapat membuang berkas.');
            }
          },
        },
      ],
    );
  };

  const handleMoveToPrivate = async (file: DriveFile) => {
    if (!api) return;
    if (!vaultToken) {
      Alert.alert('Folder Privat terkunci', 'Buka tab Privat terlebih dahulu untuk memindahkan berkas ke ruang Privat.');
      return;
    }
    try {
      await api.moveFileIntoVault(vaultToken, file.id);
      setSelectedFile(null);
      await Promise.all([refreshAll(), refreshServerInfo()]);
      Alert.alert('Dipindahkan ke Privat', `"${file.name}" sekarang aman di Folder Privat.`);
    } catch (err) {
      Alert.alert('Gagal memindahkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const entryKey = (item: CloudClipboardItem): string =>
    item.kind === 'folder' ? `folder:${item.folder.id}` : `file:${item.file.id}`;

  const exitCloudSelectMode = useCallback(() => {
    setCloudSelectMode(false);
    setCloudSelectedKeys(new Set());
  }, []);

  const toggleCloudSelect = useCallback((item: CloudClipboardItem) => {
    const key = item.kind === 'folder' ? `folder:${item.folder.id}` : `file:${item.file.id}`;
    setCloudSelectMode(true);
    setCloudSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedCloudItems = useMemo<CloudClipboardItem[]>(() => {
    if (cloudSelectedKeys.size === 0) return [];
    const list: CloudClipboardItem[] = [];
    for (const folder of folders) {
      if (cloudSelectedKeys.has(`folder:${folder.id}`)) {
        list.push({ kind: 'folder', folder });
      }
    }
    for (const file of files) {
      if (cloudSelectedKeys.has(`file:${file.id}`)) {
        list.push({ kind: 'file', file });
      }
    }
    return list;
  }, [cloudSelectedKeys, files, folders]);

  const handleToggleSelectAllCloud = () => {
    const allKeys = [
      ...folders.map((f) => `folder:${f.id}`),
      ...files.map((f) => `file:${f.id}`),
    ];
    if (allKeys.length > 0 && allKeys.every((k) => cloudSelectedKeys.has(k))) {
      setCloudSelectedKeys(new Set());
    } else {
      setCloudSelectedKeys(new Set(allKeys));
    }
  };

  const handleStartClipboard = (mode: 'copy' | 'cut', items: CloudClipboardItem[]) => {
    if (items.length === 0) return;
    setClipboard({ mode, sourceFolderId: folderId, items });
    exitCloudSelectMode();
  };

  const handlePasteClipboard = async () => {
    if (!api || !clipboard || clipboard.items.length === 0) return;
    const { mode, items } = clipboard;
    setBusyAction(
      mode === 'copy'
        ? `Menyalin ${items.length} item ke folder ini…`
        : `Memindahkan ${items.length} item ke folder ini…`,
    );
    let okCount = 0;
    let errMessage: string | null = null;
    try {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        try {
          if (entry.kind === 'file') {
            if (mode === 'copy') {
              await api.copyFile(entry.file.id, folderId);
            } else {
              await api.updateFile(entry.file.id, { folder_id: folderId });
            }
          } else {
            if (mode === 'copy') {
              await api.copyFolder(entry.folder.id, folderId);
            } else {
              await api.updateFolder(entry.folder.id, { parent_id: folderId });
            }
          }
          okCount++;
        } catch (err) {
          errMessage = err instanceof Error ? err.message : 'Sebagian item gagal diproses.';
        }
      }
      setClipboard(null);
      await Promise.all([refreshAll(), refreshServerInfo()]);
      if (errMessage) {
        Alert.alert(
          okCount > 0 ? 'Sebagian Berhasil' : 'Gagal Menempel',
          okCount > 0 ? `${okCount} berhasil. ${errMessage}` : errMessage,
        );
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenRename = (target: CloudClipboardItem) => {
    setRenameTarget(target);
    setRenameInput(target.kind === 'folder' ? target.folder.name : target.file.name);
  };

  const handleConfirmRename = async () => {
    if (!api || !renameTarget) return;
    const clean = renameInput.trim();
    if (!clean) return;
    const target = renameTarget;
    setRenameTarget(null);
    setBusyAction('Mengubah nama…');
    try {
      if (target.kind === 'folder') {
        await api.updateFolder(target.folder.id, { name: clean });
      } else {
        await api.updateFile(target.file.id, { name: clean });
      }
      exitCloudSelectMode();
      await refreshAll();
    } catch (err) {
      Alert.alert('Gagal Mengubah Nama', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchMoveToPrivate = async () => {
    if (!api) return;
    const targetFiles = selectedCloudItems
      .filter((it): it is { kind: 'file'; file: DriveFile } => it.kind === 'file')
      .map((it) => it.file);
    if (targetFiles.length === 0) return;
    if (!vaultToken) {
      Alert.alert(
        'Folder Privat Terkunci',
        'Buka tab Privat dan masukkan PIN terlebih dahulu untuk memindahkan berkas ke ruang Privat.',
      );
      return;
    }
    setBusyAction(`Memindahkan ${targetFiles.length} berkas ke Privat…`);
    try {
      for (const f of targetFiles) {
        await api.moveFileIntoVault(vaultToken, f.id);
      }
      exitCloudSelectMode();
      await Promise.all([refreshAll(), refreshServerInfo()]);
      Alert.alert('Dipindahkan ke Privat', `${targetFiles.length} berkas kini aman di Folder Privat.`);
    } catch (err) {
      Alert.alert('Gagal Memindahkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchDeleteCloud = () => {
    if (!api || selectedCloudItems.length === 0) return;
    const folderCount = selectedCloudItems.filter((i) => i.kind === 'folder').length;
    const fileCount = selectedCloudItems.filter((i) => i.kind === 'file').length;
    const summaryParts = [
      folderCount > 0 ? `${folderCount} folder (beserta isinya ke Sampah)` : '',
      fileCount > 0 ? `${fileCount} berkas (ke Sampah 30 hari)` : '',
    ].filter(Boolean);

    Alert.alert(
      `Hapus ${selectedCloudItems.length} item?`,
      `${summaryParts.join(' dan ')} akan dihapus dari Cloud Server.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            const batch = [...selectedCloudItems];
            exitCloudSelectMode();
            setBusyAction(`Menghapus ${batch.length} item…`);
            try {
              for (const entry of batch) {
                if (entry.kind === 'folder') {
                  await api.deleteFolder(entry.folder.id);
                } else {
                  await api.trashFile(entry.file.id);
                }
              }
              await Promise.all([refreshAll(), refreshServerInfo(), refreshQueue()]);
            } catch (err) {
              Alert.alert('Gagal Menghapus', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  };

  const usedBytes = usage?.used_bytes ?? 0;
  const quotaBytes = usage?.quota_bytes ?? 107_374_182_400;

  const sortedFolders = useMemo(
    () =>
      sortFileEntries(folders, cloudSort, (f) => ({
        name: f.name,
        dateMs: new Date(f.updated_at || f.created_at).getTime() || 0,
        sizeBytes: f.files_count,
      })),
    [cloudSort, folders],
  );

  const sortedCloudFiles = useMemo(
    () =>
      sortFileEntries(files, cloudSort, (f) => ({
        name: f.name,
        dateMs: new Date(f.media_taken_at ?? f.created_at).getTime() || 0,
        sizeBytes: f.size_bytes,
      })),
    [cloudSort, files],
  );

  const cloudEntries = useMemo<ListEntry[]>(() => {
    if (sourceScope !== 'cloud') return [];
    return [
      ...sortedFolders.map((folder): ListEntry => ({ kind: 'folder', folder })),
      ...sortedCloudFiles.map((file): ListEntry => ({ kind: 'file', file })),
      ...(!folderId && !query.trim() ? [{ kind: 'private-shortcut' as const }] : []),
    ];
  }, [folderId, query, sortedCloudFiles, sortedFolders, sourceScope]);

  const cloudVirtualRows = useMemo<CloudVirtualRow[]>(() => {
    if (sourceScope !== 'cloud' || cloudEntries.length === 0) return [];
    if (cloudLayout === 'list') {
      return cloudEntries.map((entry, index) => ({
        kind: 'list-entry',
        key:
          entry.kind === 'folder'
            ? `fl-${entry.folder.id}`
            : entry.kind === 'file'
              ? `dl-${entry.file.id}`
              : `pl-${index}`,
        entry,
        index,
        total: cloudEntries.length,
      }));
    }

    const rows: CloudVirtualRow[] = [];
    for (let i = 0; i < cloudEntries.length; i += cloudColumns) {
      const chunk = cloudEntries.slice(i, i + cloudColumns);
      const first = chunk[0];
      const firstId =
        first.kind === 'folder'
          ? first.folder.id
          : first.kind === 'file'
            ? first.file.id
            : `priv-${i}`;
      rows.push({
        kind: 'grid-row',
        key: `cg-${firstId}-${i}`,
        entries: chunk,
      });
    }
    return rows;
  }, [cloudColumns, cloudEntries, cloudLayout, sourceScope]);

  const categoryToRowKind = (cat: DriveFile['category']): FileRowKind => {
    if (cat === 'image' || cat === 'video' || cat === 'audio' || cat === 'archive' || cat === 'document') {
      return cat;
    }
    return 'other';
  };

  const handleEndReached = () => {
    if (sourceScope === 'cloud') {
      void loadMoreCloudDirectory();
    } else {
      setDeviceLoadMoreSignal((n) => n + 1);
      void loadMoreAllCloudFiles();
    }
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={cloudVirtualRows}
          keyExtractor={(item) => item.key}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.45}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void refreshAll().finally(() => setRefreshing(false)); }}
              tintColor={palette.accent}
            />
          }
          contentContainerStyle={styles.listPad}
          ListHeaderComponent={
            <View>
              <ScreenHeader
                title="Berkas"
                subtitle={`${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`}
              />

              <View style={styles.section}>
                {!api ? (
                  <ActionPressable
                    onPress={() => router.push('/settings/connect')}
                    accessibilityRole="button"
                    style={{ marginBottom: 10 }}>
                    <Surface solid style={styles.connectBanner}>
                      <View style={{ flex: 1 }}>
                        <AppText weight="bold" size={14}>
                          Masuk ke GunyDrive
                        </AppText>
                        <AppText weight="medium" size={12} color="secondary">
                          Masuk atau daftar untuk mencadangkan berkas.
                        </AppText>
                      </View>
                      <AppText weight="bold" size={13} color="accent">
                        Masuk
                      </AppText>
                    </Surface>
                  </ActionPressable>
                ) : null}

                <SearchField value={query} onChangeText={setQuery} />

                <View style={{ marginTop: 10 }}>
                  <Segmented
                    value={sourceScope}
                    onChange={(next) => {
                      animateSectionSwitch(
                        sourceScope === 'device' ? 0 : 1,
                        next === 'device' ? 0 : 1,
                      );
                      startTransition(() => {
                        setSourceScope(next);
                      });
                    }}
                    options={[
                      { value: 'device', label: 'Sistem HP' },
                      { value: 'cloud', label: 'Cloud Server' },
                    ]}
                  />
                </View>

                <Animated.View
                  style={{
                    marginTop: 12,
                    opacity: scopeOpacity,
                    transform: [{ translateX: scopeTranslateX }],
                  }}>
                  {sourceScope === 'device' ? (
                    <DeviceFileManager
                      scanCacheRef={scanCacheRef}
                      allCloudFiles={allCloudFiles}
                      query={query}
                      loadMoreSignal={deviceLoadMoreSignal}
                      loadingMoreCloud={loadingMoreAllCloud}
                      onRefreshServerFiles={refreshAll}
                      onOpenCloudFile={(f) => setSelectedFile(f)}
                    />
                  ) : (
                    <View style={{ gap: 10 }}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipsRow}>
                        {(
                          [
                            ['all', 'Semua'],
                            ['document', 'Dokumen'],
                            ['media', 'Media'],
                            ['archive', 'Arsip'],
                          ] as const
                        ).map(([key, label], idx, arr) => (
                          <Chip
                            key={key}
                            label={label}
                            active={category === key}
                            onPress={() => {
                              const prevIdx = arr.findIndex(([k]) => k === category);
                              animateSectionSwitch(prevIdx, idx, 16);
                              startTransition(() => {
                                setCategory(key);
                              });
                            }}
                          />
                        ))}
                      </ScrollView>

                      {breadcrumbs.length > 0 ? (
                        <ActionPressable
                          onPress={() => {
                            const parent =
                              breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].id : null;
                            setFolderId(parent);
                          }}
                          style={styles.backFolder}
                          accessibilityRole="button">
                          <ChevronLeft size={18} color={palette.accent} strokeWidth={2.2} />
                          <AppText weight="semibold" size={13.5} color="accent">
                            {breadcrumbs.map((b) => b.name).join(' / ')}
                          </AppText>
                        </ActionPressable>
                      ) : null}

                      <View style={{ marginBottom: 4 }}>
                        <FileViewToolbar
                          layout={cloudLayout}
                          sort={cloudSort}
                          onChangeLayout={setCloudLayout}
                          onChangeSort={setCloudSort}
                          countLabel={`${sortedFolders.length + sortedCloudFiles.length} item`}
                        />
                      </View>

                      {/* Cloud Quick Management Strip (Multi-Select & New Folder) */}
                      <View style={styles.cloudActionStrip}>
                        <ActionPressable
                          onPress={() =>
                            cloudSelectMode ? exitCloudSelectMode() : setCloudSelectMode(true)
                          }
                          style={[
                            styles.cloudMiniPill,
                            {
                              backgroundColor: cloudSelectMode ? palette.accent : palette.activeBg,
                              borderColor: palette.accent,
                            },
                          ]}>
                          <CheckSquare
                            size={13.5}
                            color={cloudSelectMode ? palette.onAccent : palette.accent}
                          />
                          <AppText
                            weight="bold"
                            size={12}
                            color={cloudSelectMode ? 'onAccent' : 'accent'}>
                            {cloudSelectMode ? 'Selesai Pilih' : 'Pilih'}
                          </AppText>
                        </ActionPressable>

                        <ActionPressable
                          onPress={() => setNewFolderModal(true)}
                          style={[
                            styles.cloudMiniPill,
                            {
                              backgroundColor: palette.surface,
                              borderColor: palette.border,
                            },
                          ]}>
                          <FolderPlus size={13.5} color={palette.accent} />
                          <AppText weight="bold" size={12} color="primary">
                            + Folder
                          </AppText>
                        </ActionPressable>
                      </View>

                      {/* Persistent Clipboard Banner (Copy / Cut -> Navigate -> Paste) */}
                      {clipboard ? (
                        <Surface solid style={[styles.clipboardCard, { borderColor: palette.accent }]}>
                          <View style={{ flex: 1 }}>
                            <AppText weight="extrabold" size={13}>
                              {clipboard.mode === 'copy' ? 'Salin' : 'Pindahkan'}{' '}
                              {clipboard.items.length} item
                            </AppText>
                            <AppText size={11.5} color="secondary" numberOfLines={1}>
                              Buka folder tujuan lalu tekan Tempel di sini
                            </AppText>
                          </View>
                          <ActionPressable
                            onPress={() => void handlePasteClipboard()}
                            style={[styles.pasteBtn, { backgroundColor: palette.accent }]}>
                            <ClipboardPaste size={14} color={palette.onAccent} />
                            <AppText weight="bold" size={12} color="onAccent">
                              Tempel
                            </AppText>
                          </ActionPressable>
                          <ActionPressable
                            onPress={() => setClipboard(null)}
                            hitSlop={8}
                            style={[styles.miniCloseBtn, { backgroundColor: palette.background }]}>
                            <X size={15} color={palette.textSecondary} />
                          </ActionPressable>
                        </Surface>
                      ) : null}

                      {/* Cloud Multi-Select Action Bar */}
                      {cloudSelectMode ? (
                        <Surface solid style={[styles.cloudSelectCard, { borderColor: palette.accent }]}>
                          <View style={styles.cloudSelectTop}>
                            <AppText weight="extrabold" size={13} style={{ flex: 1 }}>
                              {selectedCloudItems.length} item dipilih
                            </AppText>
                            <ActionPressable
                              onPress={handleToggleSelectAllCloud}
                              style={[styles.smallSelectBtn, { backgroundColor: palette.activeBg }]}>
                              <Check size={12.5} color={palette.accent} />
                              <AppText weight="bold" size={11} color="accent">
                                Pilih Semua
                              </AppText>
                            </ActionPressable>
                            <ActionPressable
                              onPress={exitCloudSelectMode}
                              hitSlop={8}
                              style={[styles.miniCloseBtn, { backgroundColor: palette.background }]}>
                              <X size={15} color={palette.textSecondary} />
                            </ActionPressable>
                          </View>

                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.cloudSelectActions}>
                            <ActionPressable
                              disabled={selectedCloudItems.length === 0}
                              onPress={() => handleStartClipboard('copy', selectedCloudItems)}
                              style={[
                                styles.cloudOpBtn,
                                {
                                  backgroundColor:
                                    selectedCloudItems.length > 0 ? palette.activeBg : palette.background,
                                },
                              ]}>
                              <Copy size={14} color={palette.accent} />
                              <AppText weight="bold" size={12} color="accent">
                                Salin
                              </AppText>
                            </ActionPressable>

                            <ActionPressable
                              disabled={selectedCloudItems.length === 0}
                              onPress={() => handleStartClipboard('cut', selectedCloudItems)}
                              style={[
                                styles.cloudOpBtn,
                                {
                                  backgroundColor:
                                    selectedCloudItems.length > 0 ? palette.activeBg : palette.background,
                                },
                              ]}>
                              <Scissors size={14} color={palette.accent} />
                              <AppText weight="bold" size={12} color="accent">
                                Potong
                              </AppText>
                            </ActionPressable>

                            {selectedCloudItems.length === 1 ? (
                              <ActionPressable
                                onPress={() => handleOpenRename(selectedCloudItems[0])}
                                style={[styles.cloudOpBtn, { backgroundColor: palette.activeBg }]}>
                                <Edit3 size={14} color={palette.accent} />
                                <AppText weight="bold" size={12} color="accent">
                                  Ubah Nama
                                </AppText>
                              </ActionPressable>
                            ) : null}

                            {selectedCloudItems.some((it) => it.kind === 'file') ? (
                              <ActionPressable
                                onPress={() => void handleBatchMoveToPrivate()}
                                style={[styles.cloudOpBtn, { backgroundColor: palette.activeBg }]}>
                                <Lock size={14} color={palette.accent} />
                                <AppText weight="bold" size={12} color="accent">
                                  Ke Privat
                                </AppText>
                              </ActionPressable>
                            ) : null}

                            <ActionPressable
                              disabled={selectedCloudItems.length === 0}
                              onPress={handleBatchDeleteCloud}
                              style={[
                                styles.cloudOpBtn,
                                {
                                  backgroundColor:
                                    selectedCloudItems.length > 0
                                      ? `${palette.danger}1C`
                                      : palette.background,
                                },
                              ]}>
                              <Trash2 size={14} color={palette.danger} />
                              <AppText weight="bold" size={12} color="danger">
                                Hapus
                              </AppText>
                            </ActionPressable>
                          </ScrollView>
                        </Surface>
                      ) : null}
                    </View>
                  )}
                </Animated.View>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'list-entry') {
              const { entry, index, total } = item;
              return (
                <View style={styles.cardRowContainer}>
                  <Surface
                    style={[
                      index === 0 && total > 1 && styles.firstCard,
                      index === total - 1 && total > 1 && styles.lastCard,
                      index > 0 && index < total - 1 && styles.middleCard,
                    ]}>
                    {entry.kind === 'folder' ? (
                      <FileRow
                        kind="folder"
                        title={entry.folder.name}
                        subtitle={`Folder · ${entry.folder.files_count} berkas`}
                        showDivider={index > 0}
                        selectable={cloudSelectMode}
                        selected={cloudSelectedKeys.has(entryKey({ kind: 'folder', folder: entry.folder }))}
                        onPress={() => {
                          if (cloudSelectMode) {
                            toggleCloudSelect({ kind: 'folder', folder: entry.folder });
                            return;
                          }
                          startTransition(() => setFolderId(entry.folder.id));
                        }}
                        onLongPress={() => toggleCloudSelect({ kind: 'folder', folder: entry.folder })}
                      />
                    ) : entry.kind === 'file' ? (
                      <FileRow
                        kind={categoryToRowKind(entry.file.category)}
                        title={entry.file.name}
                        subtitle={`${entry.file.mime_type.split('/').pop()?.toUpperCase() || 'BERKAS'} · ${formatBytes(entry.file.size_bytes)} · ${formatShortTime(entry.file.created_at)}`}
                        mimeType={entry.file.mime_type}
                        thumbnailPreset={entry.file.thumbnail_preset}
                        thumbnailSource={getDriveFileThumbnailSource(api, entry.file)}
                        showDivider={index > 0}
                        selectable={cloudSelectMode}
                        selected={cloudSelectedKeys.has(entryKey({ kind: 'file', file: entry.file }))}
                        onPress={() => {
                          if (cloudSelectMode) {
                            toggleCloudSelect({ kind: 'file', file: entry.file });
                            return;
                          }
                          setSelectedFile(entry.file);
                        }}
                        onLongPress={() => toggleCloudSelect({ kind: 'file', file: entry.file })}
                      />
                    ) : (
                      <FileRow
                        kind="private"
                        title="Folder Privat"
                        subtitle={vaultToken ? 'Terbuka sementara' : 'Terkunci'}
                        showDivider={index > 0}
                        onPress={() => router.push('/(tabs)/privat')}
                      />
                    )}
                  </Surface>
                </View>
              );
            }

            return (
              <View style={[styles.cardRowContainer, { marginBottom: cloudGridGap }]}>
                <View style={[styles.cloudGridRow, { gap: cloudGridGap }]}>
                  {item.entries.map((entry, idx) => {
                    if (entry.kind === 'file') {
                      const fileItem: CloudClipboardItem = { kind: 'file', file: entry.file };
                      return (
                        <DriveFileGridTile
                          key={`cg-${entry.file.id}`}
                          file={entry.file}
                          api={api}
                          size={cloudTileSize}
                          layout={cloudLayout}
                          selectable={cloudSelectMode}
                          selected={cloudSelectedKeys.has(entryKey(fileItem))}
                          onPress={() => {
                            if (cloudSelectMode) {
                              toggleCloudSelect(fileItem);
                              return;
                            }
                            setSelectedFile(entry.file);
                          }}
                          onLongPress={() => toggleCloudSelect(fileItem)}
                        />
                      );
                    }
                    const isPrivate = entry.kind === 'private-shortcut';
                    const folderItem = !isPrivate ? ({ kind: 'folder', folder: entry.folder } as const) : null;
                    const isFolderSelected = folderItem
                      ? cloudSelectedKeys.has(entryKey(folderItem))
                      : false;
                    const title = isPrivate ? 'Folder Privat' : entry.folder.name;
                    const sub = isPrivate
                      ? vaultToken
                        ? 'Terbuka'
                        : 'Terkunci'
                      : `${entry.folder.files_count} berkas`;
                    const dense = cloudLayout === 'grid4';
                    return (
                      <ActionPressable
                        key={isPrivate ? `priv-${idx}` : `fg-${entry.folder.id}`}
                        onPress={() => {
                          if (isPrivate) {
                            router.push('/(tabs)/privat');
                            return;
                          }
                          if (cloudSelectMode && folderItem) {
                            toggleCloudSelect(folderItem);
                            return;
                          }
                          startTransition(() => setFolderId(entry.folder.id));
                        }}
                        onLongPress={() => {
                          if (folderItem) toggleCloudSelect(folderItem);
                        }}
                        style={[
                          styles.cloudFolderTile,
                          {
                            width: cloudTileSize,
                            height: cloudTileSize,
                            borderRadius: cloudLayout === 'grid2' ? 14 : dense ? 8 : 12,
                            backgroundColor: isFolderSelected ? palette.activeBg : palette.surface,
                            borderColor: isFolderSelected ? palette.accent : palette.border,
                            borderWidth: isFolderSelected ? 2 : 1,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={title}>
                        {cloudSelectMode && !isPrivate ? (
                          <View
                            style={[
                              styles.folderSelectDot,
                              {
                                backgroundColor: isFolderSelected ? palette.accent : 'rgba(8,11,26,0.35)',
                                borderColor: isFolderSelected ? palette.accent : palette.border,
                              },
                            ]}>
                            {isFolderSelected ? (
                              <Check size={11} color={palette.onAccent} strokeWidth={3} />
                            ) : null}
                          </View>
                        ) : null}
                        <View
                          style={[
                            styles.cloudFolderIconWrap,
                            {
                              backgroundColor: palette.activeBg,
                              width: dense ? 32 : 42,
                              height: dense ? 32 : 42,
                              borderRadius: dense ? 10 : 13,
                            },
                          ]}>
                          {isPrivate ? (
                            <Lock size={dense ? 16 : 20} color={palette.accent} strokeWidth={2} />
                          ) : (
                            <FolderIcon size={dense ? 16 : 20} color={palette.accent} strokeWidth={2} />
                          )}
                        </View>
                        <AppText
                          weight="bold"
                          size={dense ? 10 : 12}
                          numberOfLines={1}
                          style={{ textAlign: 'center', paddingHorizontal: 4 }}>
                          {title}
                        </AppText>
                        {!dense ? (
                          <AppText weight="medium" size={10.5} color="secondary" numberOfLines={1}>
                            {sub}
                          </AppText>
                        ) : null}
                      </ActionPressable>
                    );
                  })}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            sourceScope === 'device' ? undefined : loading ? <FileSkeleton layout={cloudLayout} /> : (
              <View style={styles.section}>
                <Surface style={styles.emptyBox}>
                  <AppText weight="semibold" size={14}>
                    Belum ada berkas di sini
                  </AppText>
                  <AppText weight="medium" size={12.5} color="secondary" style={{ marginTop: 4 }}>
                    Ketuk tombol + Tambah untuk mengunggah berkas atau membuat folder baru.
                  </AppText>
                </Surface>
              </View>
            )
          }
          ListFooterComponent={
            sourceScope === 'cloud' && loadingMoreCloud ? (
              <FileSkeleton compact layout={cloudLayout} />
            ) : undefined
          }
        />

        <FabButton label="Tambah" onPress={() => setAddSheetOpen(true)} />

        {/* Unified Add Sheet (Zero Double Storage!) */}
        <Modal
          visible={addSheetOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAddSheetOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setAddSheetOpen(false)}>
            <Surface solid style={styles.sheet}>
              <AppText weight="bold" size={17} style={{ marginBottom: 10 }}>
                Tambah ke {sourceScope === 'cloud' && folderId ? 'folder ini' : 'GunyDrive'}
              </AppText>
              <ActionPressable onPress={() => void handleUploadDirect()} style={styles.sheetItem}>
                <Upload size={20} color={palette.accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
                    Unggah &amp; Backup Berkas
                  </AppText>
                  <AppText size={12} color="secondary">
                    Langsung unggah ke Cloud tanpa menyalin ganda di penyimpanan HP
                  </AppText>
                </View>
              </ActionPressable>
              {sourceScope === 'cloud' ? (
                <ActionPressable
                  onPress={() => {
                    setAddSheetOpen(false);
                    setNewFolderModal(true);
                  }}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <FolderPlus size={20} color={palette.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={15}>
                      Buat Folder Baru
                    </AppText>
                    <AppText size={12} color="secondary">
                      Kelompokkan berkas pada Cloud Server
                    </AppText>
                  </View>
                </ActionPressable>
              ) : (
                <ActionPressable
                  onPress={() => void handleConnectFolder()}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <FolderOpen size={20} color={palette.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={15}>
                      Hubungkan Folder HP
                    </AppText>
                    <AppText size={12} color="secondary">
                      Pindai DCIM, Pictures, Download, Documents, atau Music untuk backup otomatis
                    </AppText>
                  </View>
                </ActionPressable>
              )}
            </Surface>
          </Pressable>
        </Modal>

        {/* Create Folder modal */}
        <Modal
          visible={newFolderModal}
          transparent
          animationType="fade"
          onRequestClose={() => setNewFolderModal(false)}>
          <Pressable style={styles.backdrop} onPress={() => setNewFolderModal(false)}>
            <Surface solid style={styles.sheet}>
              <AppText weight="bold" size={17}>
                Buat Folder Baru
              </AppText>
              <TextInput
                value={newFolderName}
                onChangeText={setNewFolderName}
                placeholder="Nama folder, mis. Dokumen"
                placeholderTextColor={palette.textSecondary}
                autoFocus
                style={[
                  styles.modalInput,
                  {
                    borderColor: palette.border,
                    color: palette.text,
                    fontFamily: FontFamily.medium,
                  },
                ]}
              />
              <View style={styles.modalActions}>
                <ActionPressable onPress={() => setNewFolderModal(false)} style={styles.btnGhost}>
                  <AppText weight="semibold" color="secondary">
                    Batal
                  </AppText>
                </ActionPressable>
                <ActionPressable
                  onPress={() => void handleCreateFolder()}
                  style={[styles.btnPrimary, { backgroundColor: palette.accent }]}>
                  <AppText weight="bold" color="onAccent">
                    Buat
                  </AppText>
                </ActionPressable>
              </View>
            </Surface>
          </Pressable>
        </Modal>

        {/* Rename File / Folder Modal */}
        <Modal
          visible={renameTarget !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setRenameTarget(null)}>
          <Pressable style={styles.backdrop} onPress={() => setRenameTarget(null)}>
            <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
              <Surface solid style={styles.sheet}>
                <AppText weight="bold" size={17}>
                  Ubah Nama {renameTarget?.kind === 'folder' ? 'Folder' : 'Berkas'}
                </AppText>
                <TextInput
                  value={renameInput}
                  onChangeText={setRenameInput}
                  placeholder="Masukkan nama baru"
                  placeholderTextColor={palette.textSecondary}
                  autoFocus
                  style={[
                    styles.modalInput,
                    {
                      borderColor: palette.border,
                      color: palette.text,
                      fontFamily: FontFamily.medium,
                    },
                  ]}
                />
                <View style={styles.modalActions}>
                  <ActionPressable onPress={() => setRenameTarget(null)} style={styles.btnGhost}>
                    <AppText weight="semibold" color="secondary">
                      Batal
                    </AppText>
                  </ActionPressable>
                  <ActionPressable
                    onPress={() => void handleConfirmRename()}
                    style={[styles.btnPrimary, { backgroundColor: palette.accent }]}>
                    <AppText weight="bold" color="onAccent">
                      Simpan
                    </AppText>
                  </ActionPressable>
                </View>
              </Surface>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Online File Viewer & Reader Modal */}
        <OnlineFileViewerModal
          file={selectedFile}
          api={api}
          onClose={() => setSelectedFile(null)}
          onDownload={(f) => handleDownloadFile(f)}
          onMoveToPrivate={(f) => handleMoveToPrivate(f)}
          onTrash={(f) => handleTrashFile(f)}
        />

        {busyAction ? (
          <View style={styles.busyOverlay}>
            <Surface solid style={styles.busyCard}>
              <ActivityIndicator color={palette.accent} />
              <AppText weight="semibold" size={14} style={{ marginTop: 10, textAlign: 'center' }}>
                {busyAction}
              </AppText>
            </Surface>
          </View>
        ) : null}
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  section: { paddingHorizontal: Spacing.screen },
  listPad: { paddingBottom: 170 },
  connectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  chipsRow: {
    gap: 7,
  },
  backFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
  },
  cardRowContainer: {
    paddingHorizontal: Spacing.screen,
  },
  cloudGridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cloudFolderTile: {
    position: 'relative',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 8,
  },
  folderSelectDot: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudActionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cloudMiniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  clipboardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.2,
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  miniCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudSelectCard: {
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.2,
    gap: 10,
  },
  cloudSelectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  cloudSelectActions: {
    gap: 7,
  },
  cloudOpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  cloudFolderIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  middleCard: {
    borderRadius: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  lastCard: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
  },
  loadMoreFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    padding: 18,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    minHeight: 50,
  },
  modalInput: {
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  btnGhost: {
    height: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  btnPrimary: {
    height: 44,
    paddingHorizontal: 22,
    borderRadius: 999,
    justifyContent: 'center',
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(8, 11, 26, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  busyCard: {
    padding: 22,
    alignItems: 'center',
    minWidth: 220,
  },
});
