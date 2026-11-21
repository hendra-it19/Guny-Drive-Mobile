import { FileSkeleton } from '@/components/ui/FileSkeleton';
import { useSectionSlideAnimation } from '@/components/ui/AnimatedTabContainer';
import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import {
  DriveFileGridTile,
  getDriveFileThumbnailSource,
  getFileExtensionBadge,
} from '@/components/ui/DriveFileGridTile';
import { FileRow, FileRowKind } from '@/components/ui/FileRow';
import {
  FileViewToolbar,
  getGridMetrics,
  getSortLabel,
  sortFileEntries,
  useFileViewPreferences,
} from '@/components/ui/FileViewToolbar';
import { OnlineFileViewerModal } from '@/components/ui/OnlineFileViewerModal';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile } from '@/lib/api';
import { formatBytes, formatDateGroup, formatShortTime } from '@/lib/format';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import {
  Check,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type GalleryTab = 'everything' | 'image' | 'video' | 'document';

const TAB_ORDER: readonly GalleryTab[] = ['everything', 'image', 'video', 'document'];
const PAGE_SIZE = 24;

type VirtualRow =
  | { kind: 'group-header'; key: string; label: string; count: number }
  | { kind: 'list-item'; key: string; file: DriveFile; isFirst: boolean; isLast: boolean }
  | { kind: 'grid-row'; key: string; files: DriveFile[] };

function categoryToRowKind(cat: DriveFile['category']): FileRowKind {
  if (
    cat === 'image' ||
    cat === 'video' ||
    cat === 'audio' ||
    cat === 'archive' ||
    cat === 'document'
  ) {
    return cat;
  }
  return 'other';
}

export default function FileScreen() {
  const { palette } = useAppTheme();
  const { api, usage, queue, vaultToken, refreshServerInfo } = useApp();
  const { width: windowWidth } = useWindowDimensions();

  const { layout, sort, setLayout, setSort } = useFileViewPreferences(
    'file_view_pref_backup_v1',
    'grid3',
    'newest',
  );
  const { columns, gap: gridGap, tileSize } = getGridMetrics(windowWidth, layout);

  const [tab, setTab] = useState<GalleryTab>('everything');
  const {
    translateX: gridTranslateX,
    opacity: gridOpacity,
    animateSectionSwitch,
  } = useSectionSlideAnimation();

  const [items, setItems] = useState<DriveFile[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    everything: 0,
    image: 0,
    video: 0,
    document: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const loadingMoreRef = useRef(false);

  const requestVersion = useRef<symbol | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadMedia = useCallback(async () => {
    if (!api) return;
    const version = Symbol();
    requestVersion.current = version;
    setLoading(true);
    try {
      const res = await api.listMedia(tab, null, PAGE_SIZE);
      if (version !== requestVersion.current) return;
      setItems(res.items);
      setNextCursor(res.next_cursor ?? null);
      if (res.counts) {
        setCounts(res.counts);
      } else {
        setCounts((prev) => ({
          ...prev,
          [tab]: res.total_count,
        }));
      }
    } catch {
      // Preserve last rendered items when offline
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [api, tab]);

  const loadMoreMedia = useCallback(async () => {
    if (!api || !nextCursor || loading || loadingMoreRef.current) return;
    const version = requestVersion.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.listMedia(tab, nextCursor, PAGE_SIZE);
      if (version !== requestVersion.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        const appended = res.items.filter((f) => !seen.has(f.id));
        return [...prev, ...appended];
      });
      setNextCursor(res.next_cursor ?? null);
      if (res.counts) {
        setCounts(res.counts);
      }
    } catch {
      // Keep existing loaded batch
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [api, loading, nextCursor, tab]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadMedia());
    return () => { cancelAnimationFrame(frame); requestVersion.current = null; };
  }, [loadMedia, usage?.total_files]);

  const sortedItems = useMemo(() => {
    return sortFileEntries(items, sort, (item) => ({
      name: item.name,
      dateMs: new Date(item.media_taken_at ?? item.created_at).getTime() || 0,
      sizeBytes: item.size_bytes,
    }));
  }, [items, sort]);

  const virtualRows = useMemo<VirtualRow[]>(() => {
    if (sortedItems.length === 0) return [];

    let groups: [string, DriveFile[]][];
    if (sort === 'newest' || sort === 'oldest') {
      const map = new Map<string, DriveFile[]>();
      for (const item of sortedItems) {
        const key = formatDateGroup(item.media_taken_at ?? item.created_at);
        const list = map.get(key) ?? [];
        list.push(item);
        map.set(key, list);
      }
      groups = Array.from(map.entries());
    } else {
      groups = [[`Urutan: ${getSortLabel(sort)}`, sortedItems]];
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
  }, [columns, layout, sort, sortedItems]);

  const pendingCount = queue.filter(
    (q) => q.status === 'pending' || q.status === 'uploading',
  ).length;

  const handleDownloadAndSave = async (file: DriveFile) => {
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
  };

  const handleMoveToPrivate = async (file: DriveFile) => {
    if (!api) return;
    if (!vaultToken) {
      Alert.alert(
        'Folder Privat terkunci',
        'Buka tab Privat terlebih dahulu untuk memindahkan berkas ke Folder Privat.',
      );
      return;
    }
    try {
      await api.moveFileIntoVault(vaultToken, file.id);
      setSelected(null);
      await Promise.all([loadMedia(), refreshServerInfo()]);
      Alert.alert('Dipindahkan ke Privat', `"${file.name}" kini aman di Folder Privat.`);
    } catch (err) {
      Alert.alert(
        'Gagal memindahkan',
        err instanceof Error ? err.message : 'Terjadi kesalahan.',
      );
    }
  };

  const handleTrashFile = (file: DriveFile) => {
    if (!api) return;
    Alert.alert(
      'Pindahkan ke Sampah?',
      `Salinan "${file.name}" di server akan masuk Sampah selama 30 hari.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Pindahkan ke Sampah',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.trashFile(file.id);
              setSelected(null);
              await Promise.all([loadMedia(), refreshServerInfo()]);
            } catch (err) {
              Alert.alert(
                'Gagal',
                err instanceof Error ? err.message : 'Tidak dapat menghapus berkas.',
              );
            }
          },
        },
      ],
    );
  };

  const renderVirtualRow = useCallback(
    ({ item }: { item: VirtualRow }) => {
      if (item.kind === 'group-header') {
        return (
          <View style={styles.sectionPad}>
            <View style={styles.groupHead}>
              <AppText weight="bold" size={14.5}>
                {item.label}
              </AppText>
              <View style={styles.okRow}>
                <Check size={13.5} color={palette.success} strokeWidth={2.5} />
                <AppText weight="semibold" size={12} color="success">
                  {pendingCount > 0 ? `${pendingCount} antre · ` : ''}
                  {item.count} item
                </AppText>
              </View>
            </View>
          </View>
        );
      }

      if (item.kind === 'list-item') {
        return (
          <View style={styles.sectionPad}>
            <Surface
              style={[
                item.isFirst && !item.isLast && styles.firstCard,
                item.isLast && !item.isFirst && styles.lastCard,
                !item.isFirst && !item.isLast && styles.middleCard,
              ]}>
              <FileRow
                kind={categoryToRowKind(item.file.category)}
                title={item.file.name}
                subtitle={`${getFileExtensionBadge(item.file.name)} · ${formatBytes(item.file.size_bytes)} · ${formatShortTime(item.file.media_taken_at ?? item.file.created_at)}`}
                mimeType={item.file.mime_type}
                thumbnailPreset={item.file.thumbnail_preset}
                thumbnailSource={getDriveFileThumbnailSource(api, item.file)}
                showDivider={!item.isFirst}
                onPress={() => setSelected(item.file)}
              />
            </Surface>
          </View>
        );
      }

      return (
        <View style={[styles.sectionPad, { marginBottom: gridGap }]}>
          <View style={[styles.gridRow, { gap: gridGap }]}>
            {item.files.map((file) => (
              <DriveFileGridTile
                key={file.id}
                file={file}
                api={api}
                size={tileSize}
                layout={layout}
                onPress={() => setSelected(file)}
              />
            ))}
          </View>
        </View>
      );
    },
    [api, gridGap, layout, palette.success, pendingCount, tileSize],
  );

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={virtualRows}
          keyExtractor={(row) => row.key}
          renderItem={renderVirtualRow}
          contentContainerStyle={styles.scrollPad}
          onEndReached={() => void loadMoreMedia()}
          onEndReachedThreshold={0.45}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadMedia().finally(() => setRefreshing(false)); }}
              tintColor={palette.accent}
            />
          }
          ListHeaderComponent={
            <View>
              <ScreenHeader
                title="File"
                subtitle={`${counts.everything.toLocaleString('id-ID')} berkas backup`}
              />

              <View style={styles.sectionPad}>
                <Segmented
                  value={tab}
                  onChange={(next) => {
                    animateSectionSwitch(TAB_ORDER.indexOf(tab), TAB_ORDER.indexOf(next));
                    setTab(next);
                  }}
                  options={[
                    {
                      value: 'everything',
                      label: `Semua (${counts.everything})`,
                      icon: (
                        <Layers
                          size={12}
                          color={tab === 'everything' ? palette.segActiveFg : palette.textSecondary}
                        />
                      ),
                    },
                    {
                      value: 'image',
                      label: `Foto (${counts.image})`,
                      icon: (
                        <ImageIcon
                          size={12}
                          color={tab === 'image' ? palette.segActiveFg : palette.textSecondary}
                        />
                      ),
                    },
                    {
                      value: 'video',
                      label: `Video (${counts.video})`,
                      icon: (
                        <Film
                          size={12}
                          color={tab === 'video' ? palette.segActiveFg : palette.textSecondary}
                        />
                      ),
                    },
                    {
                      value: 'document',
                      label: `Dok (${counts.document})`,
                      icon: (
                        <FileText
                          size={12}
                          color={tab === 'document' ? palette.segActiveFg : palette.textSecondary}
                        />
                      ),
                    },
                  ]}
                />

                <Animated.View
                  style={{
                    marginTop: 12,
                    opacity: gridOpacity,
                    transform: [{ translateX: gridTranslateX }],
                  }}>
                  <FileViewToolbar
                    layout={layout}
                    sort={sort}
                    onChangeLayout={setLayout}
                    onChangeSort={setSort}
                  />
                </Animated.View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.sectionPad}>
              {loading ? (
                <FileSkeleton layout={layout} />
              ) : (
                <Surface style={styles.emptyBox}>
                  <AppText weight="bold" size={14.5}>
                    {tab === 'everything'
                      ? 'Belum ada hasil backup di server'
                      : tab === 'image'
                        ? 'Belum ada foto tercadang'
                        : tab === 'video'
                          ? 'Belum ada video tercadang'
                          : 'Belum ada dokumen tercadang'}
                  </AppText>
                  <AppText
                    size={12.5}
                    color="secondary"
                    style={{ marginTop: 5, textAlign: 'center', lineHeight: 18 }}>
                    Seluruh berkas yang di-backup (baik di dalam folder maupun di luar folder)
                    akan tampil otomatis tergabung di menu File ini.
                  </AppText>
                </Surface>
              )}
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <FileSkeleton compact layout={layout} />
            ) : undefined
          }
        />

        <OnlineFileViewerModal
          file={selected}
          api={api}
          onClose={() => setSelected(null)}
          onDownload={(f) => handleDownloadAndSave(f)}
          onMoveToPrivate={(f) => handleMoveToPrivate(f)}
          onTrash={(f) => handleTrashFile(f)}
        />
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingBottom: 140 },
  sectionPad: { paddingHorizontal: Spacing.screen },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  okRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    marginTop: 16,
    padding: 26,
    alignItems: 'center',
  },
  loadMoreFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
});
