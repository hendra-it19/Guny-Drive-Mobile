import { ActionPressable } from '@/components/ui/ActionPressable';
import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Chip } from '@/components/ui/Chip';
import {
  DefaultFileThumbnail,
  resolveClientThumbnailPreset,
} from '@/components/ui/DefaultFileThumbnail';
import {
  DriveFileGridTile,
  getDriveFileThumbnailSource,
  getFileExtensionBadge,
} from '@/components/ui/DriveFileGridTile';
import { FileSkeleton } from '@/components/ui/FileSkeleton';
import {
  FileViewToolbar,
  getGridMetrics,
  getSortLabel,
  sortFileEntries,
  useFileViewPreferences,
} from '@/components/ui/FileViewToolbar';
import { OnlineFileViewerModal } from '@/components/ui/OnlineFileViewerModal';
import { SearchField } from '@/components/ui/SearchField';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile } from '@/lib/api';
import { formatBytes, formatDateGroup, formatShortTime } from '@/lib/format';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  Check,
  CheckSquare,
  ChevronLeft,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type CategoryFilter = 'all' | 'image' | 'video' | 'document' | 'audio' | 'archive' | 'other';

type VirtualRow =
  | { kind: 'group-header'; key: string; label: string; count: number }
  | { kind: 'list-item'; key: string; file: DriveFile; isFirst: boolean; isLast: boolean }
  | { kind: 'grid-row'; key: string; files: DriveFile[] };

function formatRemainingRetention(purgeAfterAt: string | null): string | null {
  if (!purgeAfterAt) return null;
  const diffMs = new Date(purgeAfterAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return 'Segera dihapus';
  const days = Math.ceil(diffMs / 86_400_000);
  return `Sisa ${days} hari`;
}

function TrashListThumb({
  file,
  thumbSource,
}: {
  file: DriveFile;
  thumbSource: { uri: string; headers: Record<string, string> } | null;
}) {
  const { palette } = useAppTheme();
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === file.id;
  const preset = resolveClientThumbnailPreset(
    file.name,
    file.mime_type,
    file.category,
    file.thumbnail_preset,
  );

  return (
    <View
      style={[
        styles.listThumb,
        {
          borderColor: palette.border,
        },
      ]}>
      {thumbSource && !failed ? (
        <Image
          source={thumbSource}
          style={{ width: 44, height: 44 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={file.id}
          allowDownscaling
          decodeFormat="rgb"
          onError={() => setFailedId(file.id)}
        />
      ) : (
        <DefaultFileThumbnail preset={preset} size={44} compact />
      )}
    </View>
  );
}

export default function TrashScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { api, refreshServerInfo } = useApp();
  const { width: windowWidth } = useWindowDimensions();

  const { layout, sort, setLayout, setSort } = useFileViewPreferences(
    'file_view_pref_trash_v1',
    'grid3',
    'newest',
  );
  const { columns, gap: gridGap, tileSize } = getGridMetrics(windowWidth, layout);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const loadTrash = useCallback(
    async (silent = false) => {
      if (!api) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.listTrash();
        setFiles(res.files);
        setSelectedIds((prev) => {
          if (prev.size === 0) return prev;
          const valid = new Set(res.files.map((f) => f.id));
          const next = new Set<string>();
          prev.forEach((id) => {
            if (valid.has(id)) next.add(id);
          });
          return next;
        });
      } catch {
        // Keep last loaded trash items when offline.
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadTrash());
    return () => cancelAnimationFrame(frame);
  }, [loadTrash]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: files.length,
      image: 0,
      video: 0,
      document: 0,
      audio: 0,
      archive: 0,
      other: 0,
    };
    for (const f of files) {
      counts[f.category] = (counts[f.category] ?? 0) + 1;
    }
    return counts;
  }, [files]);

  const totalBytes = useMemo(
    () => files.reduce((acc, f) => acc + f.size_bytes, 0),
    [files],
  );

  const filteredSortedFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = files.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortFileEntries(filtered, sort, (f) => ({
      name: f.name,
      dateMs: new Date(f.deleted_at ?? f.updated_at ?? f.created_at).getTime() || 0,
      sizeBytes: f.size_bytes,
    }));
  }, [category, files, search, sort]);

  const virtualRows = useMemo<VirtualRow[]>(() => {
    if (filteredSortedFiles.length === 0) return [];

    let groups: [string, DriveFile[]][];
    if (sort === 'newest' || sort === 'oldest') {
      const map = new Map<string, DriveFile[]>();
      for (const item of filteredSortedFiles) {
        const key = formatDateGroup(item.deleted_at ?? item.created_at);
        const list = map.get(key) ?? [];
        list.push(item);
        map.set(key, list);
      }
      groups = Array.from(map.entries());
    } else {
      groups = [[`Urutan: ${getSortLabel(sort)}`, filteredSortedFiles]];
    }

    const rows: VirtualRow[] = [];
    for (const [label, list] of groups) {
      rows.push({
        kind: 'group-header',
        key: `hdr-${label}`,
        label,
        count: list.length,
      });

      if (layout === 'list') {
        list.forEach((file, idx) => {
          rows.push({
            kind: 'list-item',
            key: `li-${file.id}`,
            file,
            isFirst: idx === 0,
            isLast: idx === list.length - 1,
          });
        });
      } else {
        for (let i = 0; i < list.length; i += columns) {
          const chunk = list.slice(i, i + columns);
          rows.push({
            kind: 'grid-row',
            key: `gr-${label}-${chunk[0].id}`,
            files: chunk,
          });
        }
      }
    }
    return rows;
  }, [columns, filteredSortedFiles, layout, sort]);

  const selectedBytes = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    return files
      .filter((f) => selectedIds.has(f.id))
      .reduce((sum, f) => sum + f.size_bytes, 0);
  }, [files, selectedIds]);

  const toggleSelectItem = useCallback((fileId: string) => {
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (
      filteredSortedFiles.length > 0 &&
      filteredSortedFiles.every((f) => selectedIds.has(f.id))
    ) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSortedFiles.map((f) => f.id)));
    }
  }, [filteredSortedFiles, selectedIds]);

  const handleRestore = useCallback(
    async (file: DriveFile) => {
      if (!api) return;
      setBusyAction(`Memulihkan ${file.name}…`);
      try {
        await api.restoreTrash(file.id);
        setPreviewFile((cur) => (cur?.id === file.id ? null : cur));
        await Promise.all([loadTrash(true), refreshServerInfo()]);
      } catch (err) {
        Alert.alert('Gagal memulihkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
      } finally {
        setBusyAction(null);
      }
    },
    [api, loadTrash, refreshServerInfo],
  );

  const handlePurge = useCallback(
    (file: DriveFile) => {
      if (!api) return;
      Alert.alert(
        'Hapus permanen?',
        `"${file.name}" (${formatBytes(file.size_bytes)}) akan dihapus permanen dari server dan kuota langsung dilepaskan.`,
        [
          { text: 'Batal', style: 'cancel' },
          {
            text: 'Hapus permanen',
            style: 'destructive',
            onPress: async () => {
              setBusyAction(`Menghapus permanen ${file.name}…`);
              try {
                await api.purgeTrash(file.id);
                setPreviewFile((cur) => (cur?.id === file.id ? null : cur));
                await Promise.all([loadTrash(true), refreshServerInfo()]);
              } catch (err) {
                Alert.alert('Gagal', err instanceof Error ? err.message : 'Terjadi kesalahan.');
              } finally {
                setBusyAction(null);
              }
            },
          },
        ],
      );
    },
    [api, loadTrash, refreshServerInfo],
  );

  const handleRestoreSelected = useCallback(async () => {
    if (!api || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBusyAction(`Memulihkan ${ids.length} berkas…`);
    try {
      for (const id of ids) {
        await api.restoreTrash(id);
      }
      exitSelectMode();
      await Promise.all([loadTrash(true), refreshServerInfo()]);
    } catch (err) {
      Alert.alert('Sebagian gagal dipulihkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
      await loadTrash(true);
    } finally {
      setBusyAction(null);
    }
  }, [api, exitSelectMode, loadTrash, refreshServerInfo, selectedIds]);

  const handlePurgeSelected = useCallback(() => {
    if (!api || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    Alert.alert(
      `Hapus permanen ${ids.length} berkas?`,
      `Ruang sebesar ${formatBytes(selectedBytes)} akan segera dibebaskan dan tidak dapat dipulihkan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus permanen',
          style: 'destructive',
          onPress: async () => {
            setBusyAction(`Menghapus ${ids.length} berkas…`);
            try {
              for (const id of ids) {
                await api.purgeTrash(id);
              }
              exitSelectMode();
              await Promise.all([loadTrash(true), refreshServerInfo()]);
            } catch (err) {
              Alert.alert('Gagal menghapus', err instanceof Error ? err.message : 'Terjadi kesalahan.');
              await loadTrash(true);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [api, exitSelectMode, loadTrash, refreshServerInfo, selectedBytes, selectedIds]);

  const handleRestoreAll = useCallback(() => {
    if (!api || files.length === 0) return;
    Alert.alert(
      'Pulihkan semua berkas?',
      `${files.length} berkas (${formatBytes(totalBytes)}) akan dikembalikan ke folder asalnya.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Pulihkan Semua',
          onPress: async () => {
            setBusyAction('Memulihkan seluruh Sampah…');
            try {
              await api.restoreAllTrash();
              exitSelectMode();
              await Promise.all([loadTrash(true), refreshServerInfo()]);
            } catch (err) {
              Alert.alert('Gagal', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [api, exitSelectMode, files.length, loadTrash, refreshServerInfo, totalBytes]);

  const handleEmptyTrash = useCallback(() => {
    if (!api || files.length === 0) return;
    Alert.alert(
      'Kosongkan seluruh Sampah?',
      `${files.length} berkas (${formatBytes(totalBytes)}) akan dihapus permanen dan tidak bisa dikembalikan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Kosongkan Sampah',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('Mengosongkan Sampah…');
            try {
              await api.emptyTrash();
              exitSelectMode();
              await Promise.all([loadTrash(true), refreshServerInfo()]);
            } catch (err) {
              Alert.alert('Gagal', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [api, exitSelectMode, files.length, loadTrash, refreshServerInfo, totalBytes]);

  const handleDownloadAndSave = useCallback(
    async (file: DriveFile) => {
      if (!api) return;
      try {
        const { localUri } = await api.downloadAndVerify(file);
        if (Platform.OS !== 'web') {
          if (file.category === 'image' || file.category === 'video') {
            const perm = await MediaLibrary.requestPermissionsAsync(true).catch(() => null);
            if (perm?.granted) {
              await MediaLibrary.Asset.create(localUri);
              Alert.alert(
                'Berhasil disimpan',
                `"${file.name}" diverifikasi SHA-256 dan disimpan ke galeri perangkat.`,
              );
              return;
            }
          }
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(localUri, { dialogTitle: `Simpan ${file.name}` });
            return;
          }
        }
        Alert.alert('Unduhan terverifikasi', `SHA-256 cocok. Berkas disimpan di ${localUri}`);
      } catch (err) {
        Alert.alert(
          'Gagal mengunduh',
          err instanceof Error ? err.message : 'Terjadi kesalahan saat mengunduh berkas.',
        );
      }
    },
    [api],
  );

  const handleItemPress = useCallback(
    (file: DriveFile) => {
      if (selectMode) {
        toggleSelectItem(file.id);
      } else {
        setPreviewFile(file);
      }
    },
    [selectMode, toggleSelectItem],
  );

  const visibleCategories = useMemo(() => {
    const defs: { value: CategoryFilter; label: string }[] = [
      { value: 'all', label: `Semua (${categoryCounts.all})` },
      { value: 'image', label: `Foto (${categoryCounts.image})` },
      { value: 'video', label: `Video (${categoryCounts.video})` },
      { value: 'document', label: `Dokumen (${categoryCounts.document})` },
      { value: 'audio', label: `Audio (${categoryCounts.audio})` },
      { value: 'archive', label: `Arsip (${categoryCounts.archive})` },
      { value: 'other', label: `Lainnya (${categoryCounts.other})` },
    ];
    return defs.filter(
      (d) =>
        d.value === 'all' ||
        d.value === 'image' ||
        d.value === 'video' ||
        d.value === 'document' ||
        categoryCounts[d.value] > 0 ||
        category === d.value,
    );
  }, [category, categoryCounts]);

  const renderRow = useCallback(
    ({ item }: { item: VirtualRow }) => {
      if (item.kind === 'group-header') {
        return (
          <View style={styles.groupHeader}>
            <AppText weight="bold" size={13.5} color="secondary">
              {item.label}
            </AppText>
            <AppText size={11.5} color="secondary" tabular>
              {item.count} item
            </AppText>
          </View>
        );
      }

      if (item.kind === 'list-item') {
        const { file, isFirst, isLast } = item;
        const isSelected = selectedIds.has(file.id);
        const remaining = formatRemainingRetention(file.purge_after_at);
        const thumbSource = getDriveFileThumbnailSource(api, file);
        const ext = getFileExtensionBadge(file.name);

        return (
          <View
            style={[
              styles.listRowCard,
              {
                backgroundColor: isSelected ? palette.activeBg : palette.surface,
                borderColor: isSelected ? palette.accent : palette.border,
                borderTopLeftRadius: isFirst ? 18 : 0,
                borderTopRightRadius: isFirst ? 18 : 0,
                borderBottomLeftRadius: isLast ? 18 : 0,
                borderBottomRightRadius: isLast ? 18 : 0,
                borderTopWidth: isFirst ? 1 : 0,
                borderBottomWidth: 1,
                borderLeftWidth: 1,
                borderRightWidth: 1,
              },
            ]}>
            <ActionPressable
              onPress={() => handleItemPress(file)}
              onLongPress={() => toggleSelectItem(file.id)}
              style={styles.listRowMain}
              accessibilityRole="button"
              accessibilityLabel={`Buka pratinjau ${file.name}`}>
              {selectMode ? (
                <View style={{ marginRight: 2 }}>
                  {isSelected ? (
                    <CheckSquare size={20} color={palette.accent} />
                  ) : (
                    <Square size={20} color={palette.textSecondary} />
                  )}
                </View>
              ) : null}

              <TrashListThumb file={file} thumbSource={thumbSource} />

              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="bold" size={14.5} numberOfLines={1}>
                  {file.name}
                </AppText>
                <AppText size={11.5} color="secondary" numberOfLines={1} tabular style={{ marginTop: 2 }}>
                  {ext} · {formatBytes(file.size_bytes)} · {formatShortTime(file.deleted_at)}
                  {remaining ? ` · ${remaining}` : ''}
                </AppText>
              </View>
            </ActionPressable>

            {!selectMode ? (
              <View style={styles.listActions}>
                <ActionPressable
                  onPress={() => void handleRestore(file)}
                  accessibilityLabel={`Pulihkan ${file.name}`}
                  style={[styles.iconBtn, { backgroundColor: palette.activeBg }]}>
                  <RotateCcw size={16} color={palette.activeFg} />
                </ActionPressable>
                <ActionPressable
                  onPress={() => handlePurge(file)}
                  accessibilityLabel={`Hapus permanen ${file.name}`}
                  style={[styles.iconBtn, { backgroundColor: `${palette.danger}1C` }]}>
                  <Trash2 size={16} color={palette.danger} />
                </ActionPressable>
              </View>
            ) : null}
          </View>
        );
      }

      return (
        <View style={[styles.gridRow, { gap: gridGap, marginBottom: gridGap }]}>
          {item.files.map((file) => (
            <DriveFileGridTile
              key={file.id}
              file={file}
              api={api}
              size={tileSize}
              layout={layout}
              selectable={selectMode}
              selected={selectedIds.has(file.id)}
              onPress={() => handleItemPress(file)}
              onLongPress={() => toggleSelectItem(file.id)}
            />
          ))}
        </View>
      );
    },
    [
      api,
      gridGap,
      handleItemPress,
      handlePurge,
      handleRestore,
      layout,
      palette.accent,
      palette.activeBg,
      palette.activeFg,
      palette.border,
      palette.danger,
      palette.surface,
      palette.textSecondary,
      selectMode,
      selectedIds,
      tileSize,
      toggleSelectItem,
    ],
  );

  const listHeader = (
    <View style={styles.headerWrap}>
      <ActionPressable
        onPress={() => router.back()}
        style={styles.backRow}
        accessibilityRole="button">
        <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
        <AppText weight="semibold" size={15} color="accent">
          Pengaturan
        </AppText>
      </ActionPressable>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" size={30} style={styles.title}>
            Sampah
          </AppText>
          <AppText size={12.5} color="secondary" tabular>
            {files.length} berkas · {formatBytes(totalBytes)} · Dihapus otomatis setelah 30 hari
          </AppText>
        </View>
      </View>

      {/* Summary & Bulk Explorer Action Pills */}
      {files.length > 0 ? (
        <Surface style={styles.bulkBar}>
          <ActionPressable
            onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            style={[
              styles.bulkBtn,
              {
                backgroundColor: selectMode ? palette.accent : palette.activeBg,
              },
            ]}>
            <CheckSquare
              size={14}
              color={selectMode ? palette.onAccent : palette.accent}
            />
            <AppText
              weight="bold"
              size={12}
              color={selectMode ? 'onAccent' : 'accent'}>
              {selectMode ? 'Selesai' : 'Pilih'}
            </AppText>
          </ActionPressable>

          <ActionPressable
            disabled={Boolean(busyAction)}
            onPress={handleRestoreAll}
            style={[styles.bulkBtn, { backgroundColor: palette.activeBg }]}>
            <RotateCcw size={14} color={palette.accent} />
            <AppText weight="bold" size={12} color="accent">
              Pulihkan Semua
            </AppText>
          </ActionPressable>

          <ActionPressable
            disabled={Boolean(busyAction)}
            onPress={handleEmptyTrash}
            style={[styles.bulkBtn, { backgroundColor: `${palette.danger}1C` }]}>
            <Trash2 size={14} color={palette.danger} />
            <AppText weight="bold" size={12} color="danger">
              Kosongkan
            </AppText>
          </ActionPressable>
        </Surface>
      ) : null}

      {/* Search Bar */}
      <View style={{ marginTop: 10 }}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Cari berkas di Sampah…"
        />
      </View>

      {/* Category Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}>
        {visibleCategories.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            active={category === c.value}
            onPress={() => setCategory(c.value)}
          />
        ))}
      </ScrollView>

      {/* Grid & Sorting Toolbar */}
      <View style={{ marginTop: 8 }}>
        <FileViewToolbar
          layout={layout}
          sort={sort}
          onChangeLayout={setLayout}
          onChangeSort={setSort}
          countLabel={`${filteredSortedFiles.length} item`}
        />
      </View>

      {busyAction ? (
        <View style={[styles.busyBanner, { backgroundColor: palette.activeBg }]}>
          <ActivityIndicator size="small" color={palette.accent} />
          <AppText weight="semibold" size={12.5} color="accent">
            {busyAction}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <FlatList
          data={loading ? [] : virtualRows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            loading ? (
              <View style={{ paddingTop: 12 }}>
                <FileSkeleton layout={layout} />
              </View>
            ) : (
              <Surface style={styles.emptyCard}>
                <Trash2 size={32} color={palette.textSecondary} strokeWidth={1.6} />
                <AppText weight="bold" size={15} style={{ marginTop: 10 }}>
                  {files.length === 0 ? 'Sampah kosong' : 'Tidak ada berkas yang cocok'}
                </AppText>
                <AppText
                  size={12.5}
                  color="secondary"
                  style={{ marginTop: 4, textAlign: 'center' }}>
                  {files.length === 0
                    ? 'Berkas yang Anda hapus akan disimpan sementara di sini selama 30 hari sebelum dihapus permanen.'
                    : 'Coba ubah kata kunci pencarian atau pilih kategori lain.'}
                </AppText>
              </Surface>
            )
          }
          contentContainerStyle={[
            styles.listPad,
            selectMode && { paddingBottom: 110 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={palette.accent}
              colors={[palette.accent]}
              onRefresh={async () => {
                setRefreshing(true);
                await loadTrash(true);
                setRefreshing(false);
              }}
            />
          }
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
        />

        {/* Floating Multi-Select Batch Action Bar */}
        {selectMode ? (
          <View style={styles.floatingBarWrap}>
            <Surface solid style={[styles.floatingBar, { borderColor: palette.border }]}>
              <View style={styles.floatingTopRow}>
                <View style={{ flex: 1 }}>
                  <AppText weight="extrabold" size={13.5}>
                    {selectedIds.size} berkas dipilih
                  </AppText>
                  <AppText size={11.5} color="secondary" tabular>
                    {formatBytes(selectedBytes)}
                  </AppText>
                </View>

                <ActionPressable
                  onPress={handleToggleSelectAll}
                  style={[styles.smallPill, { backgroundColor: palette.activeBg }]}>
                  <Check size={13} color={palette.accent} />
                  <AppText weight="bold" size={11.5} color="accent">
                    {filteredSortedFiles.length > 0 &&
                    filteredSortedFiles.every((f) => selectedIds.has(f.id))
                      ? 'Batal Semua'
                      : 'Pilih Semua'}
                  </AppText>
                </ActionPressable>

                <ActionPressable
                  onPress={exitSelectMode}
                  accessibilityLabel="Tutup mode pilih"
                  style={[styles.closeSmallBtn, { backgroundColor: palette.background }]}>
                  <X size={16} color={palette.textSecondary} />
                </ActionPressable>
              </View>

              <View style={styles.floatingActions}>
                <ActionPressable
                  disabled={selectedIds.size === 0 || Boolean(busyAction)}
                  onPress={() => void handleRestoreSelected()}
                  style={[
                    styles.batchBtn,
                    {
                      backgroundColor:
                        selectedIds.size > 0 ? palette.accent : palette.border,
                    },
                  ]}>
                  <RotateCcw size={15} color={palette.onAccent} />
                  <AppText weight="bold" size={13} color="onAccent">
                    Pulihkan ({selectedIds.size})
                  </AppText>
                </ActionPressable>

                <ActionPressable
                  disabled={selectedIds.size === 0 || Boolean(busyAction)}
                  onPress={handlePurgeSelected}
                  style={[
                    styles.batchBtn,
                    {
                      backgroundColor:
                        selectedIds.size > 0 ? palette.danger : palette.border,
                    },
                  ]}>
                  <Trash2 size={15} color="#FFFFFF" />
                  <AppText weight="bold" size={13} style={{ color: '#FFFFFF' }}>
                    Hapus ({selectedIds.size})
                  </AppText>
                </ActionPressable>
              </View>
            </Surface>
          </View>
        ) : null}

        {/* On-Demand Original File Preview Modal */}
        <OnlineFileViewerModal
          file={previewFile}
          api={api}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownloadAndSave}
          onRestore={handleRestore}
          onPurge={handlePurge}
        />
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listPad: { paddingHorizontal: Spacing.screen, paddingBottom: 40 },
  headerWrap: { paddingBottom: 6 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 44,
    marginLeft: -6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { letterSpacing: -1 },
  bulkBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: 10,
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipsRow: {
    gap: 8,
    paddingTop: 10,
    paddingBottom: 2,
  },
  busyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    marginTop: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  listRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listThumb: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  listActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    marginTop: 16,
    padding: 28,
    alignItems: 'center',
  },
  floatingBarWrap: {
    position: 'absolute',
    left: Spacing.screen,
    right: Spacing.screen,
    bottom: 14,
  },
  floatingBar: {
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
  },
  floatingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  closeSmallBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  batchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
