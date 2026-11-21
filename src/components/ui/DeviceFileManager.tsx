import { useRouter } from 'expo-router';
import { ActionPressable } from '@/components/ui/ActionPressable';
import { useSectionSlideAnimation } from '@/components/ui/AnimatedTabContainer';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  CloudOff,
  CloudUpload,
  Edit3,
  ExternalLink,
  FolderOpen,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react-native';
import React, {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile, GunyDriveApi } from '@/lib/api';
import { createLocalEnqueuer } from '@/lib/local-backup';
import { transferQueuedFiles, uploadLocalFileDirect } from '@/lib/backup-engine';
import {
  type ScanProgress,
  deleteDeviceFile,
  DeviceBackupState,
  DeviceFileCategory,
  DeviceFileItem,
  DeviceStorageSummary,
  getCachedDeviceFilesSync,
  getCurrentScanState,
  getDeviceStorageSummary,
  isExpoGoEnvironment,
  loadCachedDeviceFiles,
  mergeDeviceAndCloudFiles,
  removeDeviceFileFromCache,
  renameDeviceFile,
  readDeviceFileDetails,
  resolveDeviceBackupState,
  scanAllDeviceFiles,
  scanDeviceDelta,
  subscribePermissionRefresh,
  subscribeScanProgress,
  updateDeviceFileInCache,
} from '@/lib/device-files';
import { deviceCatalog, getLocalThumbnail } from '@/lib/device-catalog';
import { FileSkeleton } from './FileSkeleton';
import { formatBytes } from '@/lib/format';

import { AppText } from './AppText';
import { Chip } from './Chip';
import { DefaultFileThumbnail, resolveClientThumbnailPreset } from './DefaultFileThumbnail';
import { getDriveFileThumbnailSource } from './DriveFileGridTile';
import {
  FileGridLayout,
  FileViewToolbar,
  getGridMetrics,
  sortFileEntries,
  useFileViewPreferences,
} from './FileViewToolbar';
import { Surface } from './Surface';

type DeviceCategoryFilter = 'all' | DeviceFileCategory;

const CATEGORY_FILTER_ORDER: readonly DeviceCategoryFilter[] = [
  'all',
  'images',
  'videos',
  'docs',
  'audio',
];
const DEVICE_BATCH_SIZE = 24;

function MediaPreviewPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', height: 220, borderRadius: 14 }}
    />
  );
}

function SmallBackupStatusBadge({
  state,
  compact = false,
}: {
  state: DeviceBackupState;
  compact?: boolean;
}) {
  const bg =
    state === 'backed_up'
      ? '#15803D'
      : state === 'queued'
        ? '#4F46E5'
        : '#D97706';

  const label =
    state === 'backed_up'
      ? 'Tercadang'
      : state === 'queued'
        ? 'Antrean'
        : 'Belum backup';

  return (
    <View
      style={[
        compact ? styles.badgeCircle : styles.badgePill,
        { backgroundColor: bg },
      ]}
      accessibilityLabel={`Status backup: ${label}`}>
      {state === 'backed_up' ? (
        <CheckCircle2 size={11} color="#FFFFFF" strokeWidth={2.5} />
      ) : state === 'queued' ? (
        <Clock size={11} color="#FFFFFF" strokeWidth={2.5} />
      ) : (
        <CloudOff size={11} color="#FFFFFF" strokeWidth={2.4} />
      )}
      {!compact ? (
        <AppText weight="bold" size={10} style={{ color: '#FFFFFF' }}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

function useLocalThumbnail(item: DeviceFileItem) {
  const [source, setSource] = useState<{ uri: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!item.serverFile && (item.category === 'images' || item.category === 'videos')) {
      void getLocalThumbnail(item.uri, item.modifiedAt).then(uri => {
        if (active && uri) setSource({ uri, key: `${item.uri}:${item.modifiedAt}` });
      });
    }
    return () => { active = false; };
  }, [item.category, item.modifiedAt, item.serverFile, item.uri]);
  if (Platform.OS === 'ios' && item.assetId?.startsWith('ph://') &&
      (item.category === 'images' || item.category === 'videos')) {
    return { uri: item.assetId, width: 192, height: 192 };
  }
  return source?.key === `${item.uri}:${item.modifiedAt}` ? source : null;
}

function DeviceListThumbnail({ item, api }: {
  item: DeviceFileItem; api: GunyDriveApi | null;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const local = useLocalThumbnail(item);
  const source = failedId === item.id
    ? null
    : item.serverFile
      ? getDriveFileThumbnailSource(api, item.serverFile)
      : local;
  const preset = resolveClientThumbnailPreset(
    item.name,
    item.mimeType,
    item.category,
    item.serverFile?.thumbnail_preset,
  );

  return source ? (
    <Image
      source={source}
      style={{ width: 42, height: 42, borderRadius: 12 }}
      recyclingKey={item.id}
      allowDownscaling
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setFailedId(item.id)}
    />
  ) : (
    <DefaultFileThumbnail preset={preset} size={42} compact borderRadius={12} />
  );
}

/**
 * Isolated memoized progress banner for background device scanning.
 * Subscribing inside this leaf component ensures progress ticks NEVER re-render the heavy file grid!
 */
const BackgroundScanProgressBanner = memo(function BackgroundScanProgressBanner({
  scanning,
}: {
  scanning: boolean;
}) {
  const { palette } = useAppTheme();
  const [progress, setProgress] = useState<ScanProgress>(() => getCurrentScanState());

  useEffect(() => subscribeScanProgress(setProgress), []);

  if (!scanning && !progress.active) return null;

  const pct = Math.max(0, Math.min(100, progress.percent));
  return (
    <Surface
      style={styles.scanProgressCard}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={styles.scanProgressHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <ActivityIndicator size="small" color={palette.accent} />
          <View style={{ flex: 1 }}>
            <AppText weight="bold" size={12.5} numberOfLines={1}>
              Memindai file HP di latar belakang · {pct}%
            </AppText>
            <AppText size={11.5} color="secondary" numberOfLines={1}>
              {progress.source || 'Menyiapkan'} · {progress.files.toLocaleString('id-ID')} berkas ditemukan
            </AppText>
          </View>
        </View>
        <AppText weight="extrabold" size={13} color="accent" tabular>
          {pct}%
        </AppText>
      </View>
      <View style={[styles.scanProgressTrack, { backgroundColor: palette.track }]}>
        <View
          style={[
            styles.scanProgressFill,
            { width: `${Math.max(4, pct)}%`, backgroundColor: palette.accent },
          ]}
        />
      </View>
    </Surface>
  );
});

const DeviceGalleryTile = memo(function DeviceGalleryTile({
  item,
  backupState,
  api,
  size,
  layout,
  borderColor,
  accentColor,
  onAccentColor,
  selectable = false,
  selected = false,
  onPress,
  onLongPress,
}: {
  item: DeviceFileItem;
  backupState: DeviceBackupState;
  api: GunyDriveApi | null;
  size: number;
  layout: FileGridLayout;
  borderColor: string;
  accentColor: string;
  onAccentColor: string;
  selectable?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === item.id;
  const isMedia = item.category === 'images' || item.category === 'videos';
  const localThumb = useLocalThumbnail(item);
  const isDense = layout === 'grid4';
  const isLarge = layout === 'grid2';
  const radius = isLarge ? 14 : isDense ? 8 : 12;

  const preset = useMemo(
    () =>
      resolveClientThumbnailPreset(
        item.name,
        item.mimeType,
        item.category,
        item.serverFile?.thumbnail_preset,
      ),
    [item.category, item.mimeType, item.name, item.serverFile?.thumbnail_preset],
  );

  const cloudThumb =
    item.serverFile
      ? getDriveFileThumbnailSource(api, item.serverFile)
      : null;

  const imageSource = failed ? null : cloudThumb ?? localThumb;

  return (
    <ActionPressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.galleryCell,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: selected ? accentColor : borderColor,
          borderWidth: selected ? 2.5 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${backupState === 'backed_up' ? 'Sudah di-backup' : 'Belum di-backup'}`}>
      {imageSource ? (
        <Image
          source={imageSource}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={item.id}
          allowDownscaling
          decodeFormat="rgb"
          transition={80}
          onError={() => setFailedId(item.id)}
        />
      ) : (
        <DefaultFileThumbnail preset={preset} size={size} compact={isDense} />
      )}

      {selectable ? (
        <View
          style={[
            styles.selectTopLeft,
            {
              backgroundColor: selected ? accentColor : 'rgba(8,11,26,0.52)',
              borderColor: selected ? accentColor : 'rgba(255,255,255,0.85)',
            },
          ]}>
          {selected ? <Check size={12} color={onAccentColor} strokeWidth={3} /> : null}
        </View>
      ) : null}

      <View style={[styles.cellTopRight, isDense && { top: 4, right: 4 }]}>
        <SmallBackupStatusBadge state={backupState} compact />
      </View>

      {item.category === 'videos' ? (
        <View style={[styles.videoPill, { bottom: isDense ? 4 : isLarge ? 36 : 22 }]}>
          <Play size={isDense ? 8 : 10} color="#FFF" fill="#FFF" />
          {!isDense ? (
            <AppText weight="bold" size={10} style={{ color: '#FFF' }} tabular>
              {item.durationSeconds
                ? `${Math.floor(item.durationSeconds / 60)}:${String(
                    Math.round(item.durationSeconds % 60),
                  ).padStart(2, '0')}`
                : item.extension}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!isDense || !isMedia ? (
        <View
          style={[
            styles.cellBottomBar,
            isLarge && { paddingHorizontal: 8, paddingVertical: 5 },
          ]}>
          <AppText
            weight="semibold"
            size={isLarge ? 11.5 : isDense ? 9 : 10}
            style={{ color: '#FFFFFF' }}
            numberOfLines={1}>
            {item.name}
          </AppText>
          {isLarge ? (
            <AppText
              weight="medium"
              size={10}
              style={{ color: 'rgba(255,255,255,0.78)', marginTop: 1 }}
              numberOfLines={1}>
              {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : item.extension} · {item.folderLabel}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </ActionPressable>
  );
});

type Props = {
  scanCacheRef: React.RefObject<Awaited<ReturnType<typeof scanAllDeviceFiles>> | null>;
  allCloudFiles: DriveFile[];
  query: string;
  loadMoreSignal: number;
  loadingMoreCloud: boolean;
  onRefreshServerFiles: () => Promise<void>;
  onOpenCloudFile: (file: DriveFile) => void;
};

export function DeviceFileManager({
  scanCacheRef,
  allCloudFiles,
  query,
  loadMoreSignal,
  loadingMoreCloud,
  onRefreshServerFiles,
  onOpenCloudFile,
}: Props) {
  const { palette, theme } = useAppTheme();
  const router = useRouter();
  const { api, queue, vaultToken, refreshQueue, refreshServerInfo } = useApp();
  const { width: windowWidth } = useWindowDimensions();

  const { layout, sort, setLayout, setSort } = useFileViewPreferences(
    'file_view_pref_device_v1',
    'grid3',
    'newest',
  );
  const { gap: gridGap, tileSize } = getGridMetrics(windowWidth, layout, Spacing.screen);

  const [category, setCategory] = useState<DeviceCategoryFilter>('all');
  const [onlyUnbacked, setOnlyUnbacked] = useState(false);
  const [loadMoreBase, setLoadMoreBase] = useState(0);
  const visibleLimit = (1 + Math.max(0, loadMoreSignal - loadMoreBase)) * DEVICE_BATCH_SIZE;

  const {
    translateX: contentTranslateX,
    opacity: contentOpacity,
    animateSectionSwitch,
  } = useSectionSlideAnimation();

  // Synchronous hydration from module-level cache (ZERO flicker or rescan when switching tabs!)
  const [deviceItems, setDeviceItems] = useState<DeviceFileItem[]>(
    () => getCachedDeviceFilesSync()?.items ?? [],
  );
  const [watchedFoldersCount, setWatchedFoldersCount] = useState(
    () => getCachedDeviceFilesSync()?.watchedFolders.length ?? 0,
  );
  const [storageSummary, setStorageSummary] = useState<DeviceStorageSummary>(
    () => getCachedDeviceFilesSync()?.storageSummary ?? getDeviceStorageSummary(0),
  );
  const [scanNote, setScanNote] = useState('');
  const [mediaPermission, setMediaPermission] = useState<'all' | 'limited' | 'none' | undefined>(
    () => getCachedDeviceFilesSync()?.mediaPermission,
  );
  const [scanning, setScanning] = useState(() => !getCachedDeviceFilesSync());
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const runningInExpoGo = Platform.OS === 'android' && isExpoGoEnvironment();

  const [selectedItem, setSelectedItem] = useState<DeviceFileItem | null>(null);
  const [renameModal, setRenameModal] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const scanVersion = useRef<symbol | null>(null);
  const loadDeviceStorage = useCallback(
    async (cached = false, forceRefresh = false) => {
      if (cached && scanCacheRef.current && !forceRefresh) {
        const warm = scanCacheRef.current;
        setMediaPermission(warm.mediaPermission);
        setDeviceItems(warm.items);
        setWatchedFoldersCount(warm.watchedFolders.length);
        setStorageSummary(warm.storageSummary);
        setScanning(false);
        return;
      }

      const version = Symbol();
      scanVersion.current = version;
      setScanning(true);
      try {
        const res = await scanAllDeviceFiles(
          true,
          (items) => {
            if (version === scanVersion.current) {
              setDeviceItems((previous) => (previous.length ? previous : items));
            }
          },
          undefined,
          forceRefresh,
        );
        if (version !== scanVersion.current) return;
        scanCacheRef.current = res;
        setMediaPermission(res.mediaPermission);
        setScanNote(
          res.unreadableSources.length
            ? `Gagal membaca ${res.unreadableSources.join(', ')}. Periksa akses lalu pindai ulang.`
            : '',
        );
        setDeviceItems(res.items);
        setWatchedFoldersCount(res.watchedFolders.length);
        setStorageSummary(res.storageSummary);
      } catch {
        if (version === scanVersion.current) {
          setScanNote('Pemindaian gagal. Ketuk pindai ulang untuk mencoba lagi.');
        }
      } finally {
        if (version === scanVersion.current) setScanning(false);
      }
    },
    [scanCacheRef],
  );

  useEffect(() => {
    const unsubPerm = subscribePermissionRefresh(() => {
      void loadDeviceStorage(false, true);
    });

    return () => {
      scanVersion.current = null;
      unsubPerm();
    };
  }, [loadDeviceStorage]);

  // Instant SQLite hydration (<15ms) + gentle background delta check (ZERO full phone rescan on cold open!)
  useEffect(() => {
    let active = true;
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      if (scanCacheRef.current) {
        if (!active) return;
        const warm = scanCacheRef.current;
        setMediaPermission(warm.mediaPermission);
        setDeviceItems(warm.items);
        setWatchedFoldersCount(warm.watchedFolders.length);
        setStorageSummary(warm.storageSummary);
        setScanning(false);
        return;
      }

      const persisted = await loadCachedDeviceFiles();
      if (!active) return;

      if (persisted) {
        scanCacheRef.current = persisted;
        setMediaPermission(persisted.mediaPermission);
        setDeviceItems(persisted.items);
        setWatchedFoldersCount(persisted.watchedFolders.length);
        setStorageSummary(persisted.storageSummary);
        setScanning(false);

        // Run silent lightweight delta check after UI settles (~20ms) to pick up newly captured files
        deltaTimer = setTimeout(() => {
          if (!active) return;
          void scanDeviceDelta()
            .then((delta) => {
              if (!active || !delta.result || delta.addedItems.length === 0) return;
              scanCacheRef.current = delta.result;
              setDeviceItems(delta.result.items);
              setStorageSummary(delta.result.storageSummary);
            })
            .catch(() => undefined);
        }, 900);
        return;
      }

      // First-time install only (no SQLite cache yet): start gentle background scan after UI settles
      deltaTimer = setTimeout(() => {
        if (!active) return;
        void loadDeviceStorage(false, false);
      }, 750);
    })();

    return () => {
      active = false;
      if (deltaTimer) clearTimeout(deltaTimer);
    };
  }, [loadDeviceStorage, scanCacheRef]);

  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(category);
  const deferredOnlyUnbacked = useDeferredValue(onlyUnbacked);
  const deferredSort = useDeferredValue(sort);

  // Merge real scanned device files with backed-up Cloud files (zero duplicate rows, zero double local bytes)
  const itemsWithState = useMemo(
    () => mergeDeviceAndCloudFiles(deviceItems, allCloudFiles, queue),
    [allCloudFiles, deviceItems, queue],
  );

  const counts = useMemo(() => {
    const c = { all: itemsWithState.length, images: 0, videos: 0, docs: 0, audio: 0 };
    for (const entry of itemsWithState) {
      c[entry.item.category]++;
    }
    return c;
  }, [itemsWithState]);

  const filteredItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matched = itemsWithState.filter(({ item, backupState }) => {
      if (deferredCategory !== 'all' && item.category !== deferredCategory) return false;
      if (deferredOnlyUnbacked && backupState === 'backed_up') return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortFileEntries(matched, deferredSort, ({ item }) => ({
      name: item.name,
      dateMs: item.modifiedAt,
      sizeBytes: item.sizeBytes,
    }));
  }, [deferredCategory, deferredOnlyUnbacked, deferredQuery, deferredSort, itemsWithState]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit],
  );

  const unbackedInCurrentView = useMemo(
    () =>
      itemsWithState.filter(
        ({ item, backupState }) =>
          item.sourceKind !== 'cloud_synced' &&
          (deferredCategory === 'all' || item.category === deferredCategory) &&
          backupState === 'not_backed_up',
      ),
    [deferredCategory, itemsWithState],
  );

  const handleRenameItem = async () => {
    if (!selectedItem) return;
    const target = selectedItem;
    const desiredName = renameText.trim();
    if (!desiredName) return;
    try {
      renameDeviceFile(target, desiredName);
      setRenameModal(false);
      setSelectedItem(null);
      const ext = target.extension.toLowerCase();
      const finalName =
        ext && !desiredName.toLowerCase().endsWith(`.${ext}`) ? `${desiredName}.${ext}` : desiredName;
      const patcher = (it: DeviceFileItem): DeviceFileItem => ({ ...it, name: finalName });
      setDeviceItems((prev) => prev.map((it) => (it.id === target.id ? patcher(it) : it)));
      if (scanCacheRef.current) {
        scanCacheRef.current = {
          ...scanCacheRef.current,
          items: scanCacheRef.current.items.map((it) => (it.id === target.id ? patcher(it) : it)),
        };
      }
      updateDeviceFileInCache(target.id, patcher);
    } catch (e) {
      Alert.alert(
        'Gagal Mengubah Nama',
        e instanceof Error ? e.message : 'Tidak dapat mengubah nama berkas ini.',
      );
    }
  };

  const handleDeleteItem = (item: DeviceFileItem) => {
    Alert.alert(
      'Hapus dari Sistem HP?',
      `Berkas "${item.name}" akan dihapus dari penyimpanan perangkat HP Anda.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            // Close the detail modal FIRST before calling OS delete so Android never freezes on stacked Modal windows!
            setSelectedItem(null);
            setTimeout(() => {
              void (async () => {
                setBusyLabel(`Menghapus ${item.name}…`);
                try {
                  await deleteDeviceFile(item);
                  // Update scanned list & warm cache in-place — ZERO full phone rescan!
                  setDeviceItems((prev) => prev.filter((it) => it.id !== item.id));
                  if (scanCacheRef.current) {
                    scanCacheRef.current = {
                      ...scanCacheRef.current,
                      items: scanCacheRef.current.items.filter((it) => it.id !== item.id),
                    };
                  }
                  removeDeviceFileFromCache(item.id);
                  setScanNote(`"${item.name}" telah dihapus dari perangkat.`);
                } catch (e) {
                  Alert.alert(
                    'Gagal Menghapus',
                    e instanceof Error ? e.message : 'OS menolak penghapusan berkas ini.',
                  );
                } finally {
                  setBusyLabel(null);
                }
              })();
            }, 160);
          },
        },
      ],
    );
  };

  const queueRegularBackup = async (items: DeviceFileItem[]) => {
    setBusyLabel(`Menyiapkan ${items.length} berkas untuk diunggah…`);
    const enqueue = await createLocalEnqueuer();
    for (const item of items) {
      await enqueue(
        {
          uri: item.storageUri ?? item.uri,
          name: item.name,
          sizeBytes: item.sizeBytes,
          mtime: item.modifiedAt,
          mimeType: item.mimeType,
        },
        'manual',
        item.assetId ?? item.uri,
      );
    }
    await refreshQueue();
    setBusyLabel(`Mengunggah ${items.length} berkas ke Cloud…`);
    try {
      const result = await transferQueuedFiles(() => {
        void refreshQueue();
      }, false);
      await Promise.all([refreshQueue(), refreshServerInfo(), onRefreshServerFiles()]);
      if (result.delayReason) {
        setScanNote(result.delayReason);
      } else if (result.uploaded > 0) {
        setScanNote(`${result.uploaded} berkas berhasil diunggah ke Cloud.`);
      }
    } catch {
      setScanNote('Transfer tertunda. Periksa koneksi jaringan Anda.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleBackupSingleFile = async (
    item: DeviceFileItem,
    targetSpace: 'regular' | 'private' = 'regular',
  ) => {
    if (!api) {
      Alert.alert('Belum Login', 'Masuk ke akun GunyDrive terlebih dahulu.');
      return;
    }
    if (targetSpace === 'private' && !vaultToken) {
      Alert.alert(
        'Folder Privat Terkunci',
        'Buka tab Privat dan masukkan PIN terlebih dahulu untuk menyimpan ke Folder Privat.',
      );
      return;
    }

    // Close detail sheet immediately so user sees inline upload progress without blocking modal freeze
    setSelectedItem(null);
    setScanNote('');
    setBusyLabel(
      targetSpace === 'private'
        ? `Mengamankan ${item.name}…`
        : `Mengunggah ${item.name}…`,
    );
    try {
      const primaryUri = item.storageUri ?? item.uri;
      await uploadLocalFileDirect({
        api,
        localUri: primaryUri,
        fallbackUri: item.uri !== primaryUri ? item.uri : undefined,
        sourceAssetId: item.assetId ?? item.uri,
        sourceModifiedAt: item.modifiedAt,
        filename: item.name,
        mimeType: item.mimeType,
        space: targetSpace,
        vaultToken: targetSpace === 'private' ? vaultToken : undefined,
        existingServerFiles: allCloudFiles,
        onProgress: (offset, total) => {
          if (total > 0) {
            const pct = Math.min(99, Math.round((offset / total) * 100));
            setBusyLabel(`Mengunggah ${item.name} · ${pct}%`);
          }
        },
      });
      await Promise.all([onRefreshServerFiles(), refreshQueue(), refreshServerInfo()]);
      setScanNote(
        targetSpace === 'private'
          ? `"${item.name}" berhasil diamankan ke Folder Privat.`
          : `"${item.name}" berhasil diunggah ke Cloud.`,
      );
    } catch (e) {
      Alert.alert(
        'Backup Gagal',
        e instanceof Error ? e.message : 'Gagal mengunggah berkas ke server.',
      );
    } finally {
      setBusyLabel(null);
    }
  };

  const handleBackupBatch = async () => {
    if (!api || unbackedInCurrentView.length === 0 || busyLabel) return;
    try {
      await queueRegularBackup(unbackedInCurrentView.map((entry) => entry.item));
    } catch {
      setScanNote('Gagal menambahkan berkas ke antrean backup.');
      setBusyLabel(null);
    }
  };

  const toggleSelectDeviceFile = useCallback((item: DeviceFileItem) => {
    if (item.sourceKind === 'cloud_synced') return;
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectedLocalItems = useMemo(
    () =>
      itemsWithState
        .filter(({ item }) => item.sourceKind !== 'cloud_synced' && selectedIds.has(item.id))
        .map(({ item }) => item),
    [itemsWithState, selectedIds],
  );

  const selectedBytes = useMemo(
    () => selectedLocalItems.reduce((sum, it) => sum + Math.max(0, it.sizeBytes), 0),
    [selectedLocalItems],
  );

  const handleSelectAllVisible = () => {
    const selectableInView = filteredItems
      .filter(({ item }) => item.sourceKind !== 'cloud_synced')
      .map(({ item }) => item.id);
    if (
      selectableInView.length > 0 &&
      selectableInView.every((id) => selectedIds.has(id))
    ) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableInView));
    }
  };

  const handleUploadSelectedFiles = async () => {
    if (!api) {
      Alert.alert('Belum Login', 'Masuk ke akun GunyDrive terlebih dahulu.');
      return;
    }
    if (selectedLocalItems.length === 0 || busyLabel) return;

    const batch = [...selectedLocalItems];
    exitSelectMode();
    setScanNote('');

    let succeeded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        setBusyLabel(`Mengunggah ${i + 1}/${batch.length} · ${item.name}…`);
        try {
          const primaryUri = item.storageUri ?? item.uri;
          await uploadLocalFileDirect({
            api,
            localUri: primaryUri,
            fallbackUri: item.uri !== primaryUri ? item.uri : undefined,
            sourceAssetId: item.assetId ?? item.uri,
            sourceModifiedAt: item.modifiedAt,
            filename: item.name,
            mimeType: item.mimeType,
            space: 'regular',
            existingServerFiles: allCloudFiles,
            onProgress: (offset, total) => {
              if (total > 0) {
                const pct = Math.min(99, Math.round((offset / total) * 100));
                setBusyLabel(`Mengunggah ${i + 1}/${batch.length} · ${item.name} (${pct}%)`);
              }
            },
          });
          succeeded++;
        } catch {
          failed++;
        }
      }
      await Promise.all([onRefreshServerFiles(), refreshQueue(), refreshServerInfo()]);
      setScanNote(
        failed > 0
          ? `${succeeded} berkas berhasil diunggah, ${failed} gagal.`
          : `${succeeded} berkas pilihan berhasil diunggah ke Cloud.`,
      );
    } finally {
      setBusyLabel(null);
    }
  };

  const handlePressEntry = (item: DeviceFileItem) => {
    if (selectMode) {
      toggleSelectDeviceFile(item);
      return;
    }
    if (item.sourceKind === 'cloud_synced' && item.serverFile) {
      onOpenCloudFile(item.serverFile);
      return;
    }
    setSelectedItem(item);
    void readDeviceFileDetails(item).then(details => {
      setSelectedItem(current => current?.id === item.id ? details : current);
    }).catch(() => undefined);
  };

  const useGridView = layout !== 'list';

  return (
    <View style={{ gap: 10 }}>
      {/* 1. Ultra-compact Storage Summary Strip */}
      <Surface style={styles.storageStrip}>
        <ShieldCheck size={17} color={palette.success} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <AppText weight="bold" size={12.5} numberOfLines={1}>
            Sistem HP · {itemsWithState.length} berkas
            {storageSummary.totalDiskBytes > 0
              ? ` · ${formatBytes(storageSummary.availableDiskBytes)} kosong`
              : ''}
          </AppText>
        </View>
        {Platform.OS === 'android' && Number(Platform.Version) >= 30 && deviceCatalog && !deviceCatalog.hasSharedStorageAccess() ? (
          <ActionPressable
            onPress={() => void deviceCatalog?.requestSharedStorageAccess().catch(() => Linking.openSettings())}
            style={[
              styles.inlinePill,
              { backgroundColor: palette.activeBg, borderColor: palette.accent },
            ]}>
            <FolderOpen size={12.5} color={palette.accent} />
            <AppText weight="bold" size={11} color="accent">
              Izin dokumen
            </AppText>
          </ActionPressable>
        ) : null}
        {itemsWithState.some((e) => e.item.sourceKind !== 'cloud_synced') ? (
          <ActionPressable
            onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            style={[
              styles.inlinePill,
              {
                backgroundColor: selectMode ? palette.accent : palette.activeBg,
                borderColor: palette.accent,
              },
            ]}>
            <CheckSquare
              size={12}
              color={selectMode ? palette.onAccent : palette.accent}
            />
            <AppText
              weight="bold"
              size={11}
              color={selectMode ? 'onAccent' : 'accent'}>
              {selectMode ? 'Selesai' : 'Pilih'}
            </AppText>
          </ActionPressable>
        ) : null}
        {!selectMode && unbackedInCurrentView.length > 0 ? (
          <ActionPressable
            onPress={() => void handleBackupBatch()}
            style={[styles.inlineBackupBtn, { backgroundColor: palette.accent }]}>
            <CloudUpload size={12} color={palette.onAccent} strokeWidth={2.2} />
            <AppText weight="bold" size={11} color="onAccent">
              Backup ({unbackedInCurrentView.length})
            </AppText>
          </ActionPressable>
        ) : null}
        <ActionPressable
          disabled={scanning}
          onPress={() => void loadDeviceStorage(false, true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Pindai ulang perangkat">
          <RefreshCw size={15} color={palette.accent} />
        </ActionPressable>
      </Surface>

      <BackgroundScanProgressBanner scanning={scanning} />

      {busyLabel ? (
        <Surface style={styles.inlineBusyBanner}>
          <ActivityIndicator size="small" color={palette.accent} />
          <AppText weight="semibold" size={12.5} color="accent" style={{ flex: 1 }} numberOfLines={1}>
            {busyLabel}
          </AppText>
        </Surface>
      ) : null}

      <ActionPressable onPress={() => router.push('/explorer')} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
        <FolderOpen size={18} color={palette.accent} />
        <AppText weight="bold" size={13} color="accent">Jelajah penyimpanan</AppText>
      </ActionPressable>
      {Platform.OS !== 'web' && mediaPermission && mediaPermission !== 'all' ? (
        <ActionPressable onPress={() => void Linking.openSettings()}>
          <AppText size={12} color="accent">
            {mediaPermission === 'limited' ? 'Akses media terbatas' : 'Izin media belum diberikan'} · Buka pengaturan
          </AppText>
        </ActionPressable>
      ) : null}
      {scanNote ? <AppText size={12} color="secondary">{scanNote}</AppText> : null}

      {/* 2. Single Clean Scrollable Category + Unbacked Filter Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}>
        {(
          [
            ['all', `Semua (${counts.all})`],
            ['images', `Foto (${counts.images})`],
            ['videos', `Video (${counts.videos})`],
            ['docs', `Dok (${counts.docs})`],
            ['audio', `Audio (${counts.audio})`],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            label={label}
            active={category === key}
            onPress={() => {
              animateSectionSwitch(
                CATEGORY_FILTER_ORDER.indexOf(category),
                CATEGORY_FILTER_ORDER.indexOf(key),
                16,
              );
              startTransition(() => {
                setCategory(key);
                setLoadMoreBase(loadMoreSignal);
              });
            }}
          />
        ))}
        <Chip
          label={`Belum backup (${unbackedInCurrentView.length})`}
          active={onlyUnbacked}
          onPress={() => {
            startTransition(() => {
              setOnlyUnbacked((prev) => !prev);
              setLoadMoreBase(loadMoreSignal);
            });
          }}
        />
      </ScrollView>

      {/* 3. Compact Grid & Sorting Toolbar */}
      <FileViewToolbar
        layout={layout}
        sort={sort}
        onChangeLayout={(next) => startTransition(() => setLayout(next))}
        onChangeSort={(next) => startTransition(() => setSort(next))}
        countLabel={`${filteredItems.length} item`}
      />

      {/* Multi-Select Upload / Backup Action Bar */}
      {selectMode ? (
        <Surface solid style={[styles.multiSelectBar, { borderColor: palette.accent }]}>
          <View style={styles.multiSelectTop}>
            <View style={{ flex: 1 }}>
              <AppText weight="extrabold" size={13}>
                {selectedLocalItems.length} berkas dipilih
              </AppText>
              <AppText size={11} color="secondary" tabular>
                {selectedBytes > 0 ? formatBytes(selectedBytes) : 'Ketuk berkas HP untuk memilih'}
              </AppText>
            </View>
            <ActionPressable
              onPress={handleSelectAllVisible}
              style={[styles.multiSelectMiniBtn, { backgroundColor: palette.activeBg }]}>
              <Check size={12.5} color={palette.accent} />
              <AppText weight="bold" size={11} color="accent">
                Pilih Semua
              </AppText>
            </ActionPressable>
            <ActionPressable
              onPress={exitSelectMode}
              hitSlop={8}
              style={[styles.multiSelectClose, { backgroundColor: palette.background }]}>
              <X size={15} color={palette.textSecondary} />
            </ActionPressable>
          </View>
          <View style={styles.multiSelectActions}>
            <ActionPressable
              disabled={selectedLocalItems.length === 0 || Boolean(busyLabel)}
              onPress={() => void handleUploadSelectedFiles()}
              style={[
                styles.multiUploadBtn,
                {
                  backgroundColor:
                    selectedLocalItems.length > 0 ? palette.accent : palette.border,
                },
              ]}>
              <CloudUpload size={15} color={palette.onAccent} strokeWidth={2.2} />
              <AppText weight="bold" size={13} color="onAccent">
                Upload / Backup Sekarang ({selectedLocalItems.length})
              </AppText>
            </ActionPressable>
          </View>
        </Surface>
      ) : null}

      {/* File List / Grid Content */}
      <Animated.View
        style={{
          opacity: contentOpacity,
          transform: [{ translateX: contentTranslateX }],
        }}>
        {scanning && visibleItems.length === 0 ? (
          <FileSkeleton layout={layout} />
        ) : visibleItems.length === 0 ? (
          <Surface style={styles.emptyCard}>
            <AppText weight="bold" size={14}>
              Belum ada berkas pada kategori ini
            </AppText>
            <AppText
              size={12}
              color="secondary"
              style={{ textAlign: 'center', marginTop: 4, lineHeight: 17 }}>
              {runningInExpoGo && watchedFoldersCount === 0
                ? 'Expo Go menampilkan berkas yang diizinkan Android. Gunakan build GunyDrive untuk memberikan izin dokumen di penyimpanan bersama.'
                : 'Tekan "+ Tambah" untuk mencadangkan berkas baru atau ubah filter di atas.'}
            </AppText>
          </Surface>
        ) : useGridView ? (
          <View style={[styles.galleryGrid, { gap: gridGap, borderRadius: theme.radius.lg }]}>
            {visibleItems.map(({ item, backupState }) => (
              <DeviceGalleryTile
                key={item.id}
                item={item}
                backupState={backupState}
                api={api}
                size={tileSize}
                layout={layout}
                borderColor={palette.border}
                accentColor={palette.accent}
                onAccentColor={palette.onAccent}
                selectable={selectMode && item.sourceKind !== 'cloud_synced'}
                selected={selectedIds.has(item.id)}
                onPress={() => handlePressEntry(item)}
                onLongPress={() => toggleSelectDeviceFile(item)}
              />
            ))}
          </View>
        ) : (
          <Surface>
            {visibleItems.map(({ item, backupState }, idx) => (
              <ActionPressable
                key={item.id}
                onPress={() => handlePressEntry(item)}
                onLongPress={() => toggleSelectDeviceFile(item)}
                style={[
                  styles.listRow,
                  idx > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                  selectedIds.has(item.id) && { backgroundColor: palette.activeBg },
                ]}
                accessibilityRole="button">
                {selectMode && item.sourceKind !== 'cloud_synced' ? (
                  <View style={{ marginRight: -2 }}>
                    {selectedIds.has(item.id) ? (
                      <CheckSquare size={19} color={palette.accent} strokeWidth={2.2} />
                    ) : (
                      <Square size={19} color={palette.textSecondary} strokeWidth={1.8} />
                    )}
                  </View>
                ) : null}
                <View style={styles.fileIconTile}>
                  <DeviceListThumbnail item={item} api={api} />
                </View>

                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14} numberOfLines={1}>
                    {item.name}
                  </AppText>
                  <AppText size={11.5} color="secondary" numberOfLines={1}>
                    {item.extension} ·{' '}
                    {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : 'Ukuran belum tersedia'} ·{' '}
                    {item.folderLabel}
                  </AppText>
                </View>

                <SmallBackupStatusBadge state={backupState} />
              </ActionPressable>
            ))}
          </Surface>
        )}

        {loadingMoreCloud ? <FileSkeleton compact layout={layout} /> : null}
      </Animated.View>

      {/* Local Device File Action Sheet */}
      <Modal
        visible={selectedItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedItem(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelectedItem(null)}>
          {selectedItem ? (
            <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
              <Surface solid style={styles.sheet}>
                <View style={styles.sheetHeader}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <AppText weight="extrabold" size={16.5} numberOfLines={2}>
                      {selectedItem.name}
                    </AppText>
                    <AppText size={12} color="secondary" style={{ marginTop: 2 }}>
                      {selectedItem.extension} ·{' '}
                      {selectedItem.sizeBytes > 0
                        ? formatBytes(selectedItem.sizeBytes)
                        : 'Ukuran belum tersedia'}{' '}
                      · {selectedItem.folderLabel}
                      {selectedItem.modifiedAt > 0 && ` · ${new Date(selectedItem.modifiedAt).toLocaleDateString()} `}
                    </AppText>
                  </View>
                  <ActionPressable onPress={() => setSelectedItem(null)} hitSlop={8}>
                    <X size={20} color={palette.textSecondary} />
                  </ActionPressable>
                </View>

                <View style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
                  <SmallBackupStatusBadge
                    state={resolveDeviceBackupState(selectedItem, queue, allCloudFiles)}
                  />
                </View>

                {selectedItem.category === 'images' && selectedItem.uri ? (
                  <View style={styles.previewBox}>
                    <Image
                      source={{ uri: selectedItem.uri }}
                      style={{ width: '100%', height: 210, borderRadius: 14 }}
                      contentFit="contain"
                    />
                  </View>
                ) : (selectedItem.category === 'videos' || selectedItem.category === 'audio') &&
                  selectedItem.uri ? (
                  <View style={styles.previewBox}>
                    <MediaPreviewPlayer uri={selectedItem.uri} />
                  </View>
                ) : null}

                <ActionPressable
                  onPress={() => void handleBackupSingleFile(selectedItem, 'regular')}
                  style={styles.sheetItem}>
                  <CloudUpload size={19} color={palette.accent} strokeWidth={2.1} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={14.5}>
                      Backup Sekarang ke Cloud
                    </AppText>
                    <AppText size={12} color="secondary">
                      Unggah langsung tanpa membuat salinan ganda di HP
                    </AppText>
                  </View>
                </ActionPressable>

                <ActionPressable
                  onPress={() => void handleBackupSingleFile(selectedItem, 'private')}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <Lock size={19} color={palette.accent} strokeWidth={2.1} />
                  <AppText weight="bold" size={14.5}>
                    Simpan ke Folder Privat
                  </AppText>
                </ActionPressable>

                {selectedItem.canRename ? (
                  <ActionPressable
                    onPress={() => {
                      setRenameText(selectedItem.name);
                      setRenameModal(true);
                    }}
                    style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                    <Edit3 size={19} color={palette.accent} strokeWidth={2.1} />
                    <AppText weight="bold" size={14.5}>
                      Ubah Nama Berkas
                    </AppText>
                  </ActionPressable>
                ) : null}

                <ActionPressable
                  onPress={async () => {
                    const targetUri = selectedItem.storageUri ?? selectedItem.uri;
                    if (Platform.OS === 'web' || !targetUri) return;
                    try {
                      await new File(targetUri).preview({
                        title: selectedItem.name,
                        mimeType: selectedItem.mimeType || undefined,
                      });
                    } catch {
                      try {
                        if (targetUri.startsWith('file://') && (await Sharing.isAvailableAsync())) {
                          await Sharing.shareAsync(targetUri, {
                            dialogTitle: `Buka ${selectedItem.name}`,
                            mimeType: selectedItem.mimeType || undefined,
                          });
                          return;
                        }
                      } catch {
                        // Fall through to alert below
                      }
                      Alert.alert(
                        'Tidak Dapat Membuka',
                        'Tidak ditemukan aplikasi pembaca yang cocok untuk berkas ini di perangkat Anda.',
                      );
                    }
                  }}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <ExternalLink size={19} color={palette.accent} strokeWidth={2.1} />
                  <AppText weight="bold" size={14.5}>
                    Buka di Pembaca Berkas
                  </AppText>
                </ActionPressable>

                {selectedItem.canDelete ? (
                  <ActionPressable
                    onPress={() => handleDeleteItem(selectedItem)}
                    style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                    <Trash2 size={19} color={palette.danger} strokeWidth={2.1} />
                    <AppText weight="bold" size={14.5} color="danger">
                      Hapus dari Sistem HP
                    </AppText>
                  </ActionPressable>
                ) : null}
              </Surface>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* Rename Modal */}
      <Modal
        visible={renameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRenameModal(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <Surface solid style={styles.sheet}>
              <AppText weight="extrabold" size={17}>
                Ubah Nama Berkas
              </AppText>
              <TextInput
                value={renameText}
                onChangeText={setRenameText}
                placeholder="Nama berkas baru"
                placeholderTextColor={palette.textSecondary}
                autoFocus
                style={[
                  styles.modalInput,
                  {
                    borderColor: palette.border,
                    color: palette.text,
                    backgroundColor: palette.background,
                    fontFamily: FontFamily.medium,
                  },
                ]}
              />
              <View style={styles.modalActions}>
                <ActionPressable onPress={() => setRenameModal(false)} style={styles.btnGhost}>
                  <AppText weight="semibold" color="secondary">
                    Batal
                  </AppText>
                </ActionPressable>
                <ActionPressable
                  onPress={() => void handleRenameItem()}
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
    </View>
  );
}

const styles = StyleSheet.create({
  storageStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scanProgressCard: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 8,
  },
  inlineBusyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  scanProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  scanProgressTrack: {
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  scanProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  inlinePill: {
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineBackupBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterRow: {
    gap: 7,
    alignItems: 'center',
  },
  badgeCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 999,
  },
  extPill: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  galleryCell: {
    position: 'relative',
    backgroundColor: 'rgba(120,120,140,0.16)',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cellTopRight: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
  },
  selectTopLeft: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiSelectBar: {
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.2,
    gap: 10,
  },
  multiSelectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  multiSelectMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  multiSelectClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiSelectActions: {
    flexDirection: 'row',
    gap: 8,
  },
  multiUploadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
    borderRadius: 12,
  },
  videoPill: {
    position: 'absolute',
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(8, 11, 26, 0.65)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  cellBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(8, 11, 26, 0.56)',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 60,
  },
  fileIconTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tileCornerBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
  },
  emptyCard: {
    padding: 22,
    alignItems: 'center',
  },
  loadMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.55)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    padding: 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewBox: {
    width: '100%',
    marginVertical: 8,
    backgroundColor: 'rgba(8, 11, 26, 0.08)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    minHeight: 48,
  },
  modalInput: {
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    fontSize: 14.5,
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
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.48)',
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
