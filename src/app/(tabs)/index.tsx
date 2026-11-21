import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  ArrowUpDown,
  ChevronLeft,
  Download,
  FolderPlus,
  Lock,
  Trash2,
  Upload,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { BackupCard } from '@/components/ui/BackupCard';
import { Chip } from '@/components/ui/Chip';
import { FabButton } from '@/components/ui/FabButton';
import { FileRow, FileRowKind } from '@/components/ui/FileRow';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SearchField } from '@/components/ui/SearchField';
import { Surface } from '@/components/ui/Surface';
import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile, DriveFolder } from '@/lib/api';
import { uploadLocalFileDirect } from '@/lib/backup-engine';
import { formatBytes, formatShortTime } from '@/lib/format';

type FilterCategory = 'all' | 'document' | 'media' | 'archive';
type SortKey = 'date' | 'name' | 'size';

type ListEntry =
  | { kind: 'folder'; folder: DriveFolder }
  | { kind: 'file'; file: DriveFile }
  | { kind: 'private-shortcut' };

const DEMO_FILES: DriveFile[] = [
  {
    id: 'demo-pdf',
    folder_id: null,
    space: 'regular',
    name: 'Catatan.pdf',
    size_bytes: 1_248_000,
    sha256: '0'.repeat(64),
    mime_type: 'application/pdf',
    category: 'document',
    has_preview: true,
    has_thumbnail: false,
    media_taken_at: null,
    status: 'ready',
    deleted_at: null,
    purge_after_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEMO_FOLDERS: DriveFolder[] = [
  {
    id: 'demo-folder',
    parent_id: null,
    space: 'regular',
    name: 'Perjalanan',
    files_count: 12,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function BerkasScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { api, usage, backupRules, queue, vaultToken, refreshServerInfo } = useApp();

  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FilterCategory>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [folders, setFolders] = useState<DriveFolder[]>(DEMO_FOLDERS);
  const [files, setFiles] = useState<DriveFile[]>(DEMO_FILES);
  const [loading, setLoading] = useState(false);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const fetchDirectory = useCallback(async () => {
    if (!api) {
      setFolders(DEMO_FOLDERS);
      setFiles(DEMO_FILES);
      setBreadcrumbs([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.listFiles({
        folderId,
        q: query.trim() || undefined,
        category,
        sort,
      });
      setFolders(res.folders);
      setFiles(res.files);
      setBreadcrumbs(res.breadcrumbs);
    } catch {
      // Offline — preserve last rendered items.
    } finally {
      setLoading(false);
    }
  }, [api, category, folderId, query, sort]);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchDirectory();
    }, 120);
    return () => clearTimeout(t);
  }, [fetchDirectory]);

  const cycleSort = () => {
    setSort((prev) => (prev === 'name' ? 'date' : prev === 'date' ? 'size' : 'name'));
  };

  const sortLabel = sort === 'name' ? 'Nama' : sort === 'size' ? 'Ukuran' : 'Terbaru';

  const handleUploadManual = async () => {
    setAddSheetOpen(false);
    if (!api) {
      router.push('/settings/connect');
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusyAction(`Mengunggah ${asset.name}…`);
    try {
      await uploadLocalFileDirect({
        api,
        localUri: asset.uri,
        filename: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        space: 'regular',
        folderId,
      });
      await Promise.all([fetchDirectory(), refreshServerInfo()]);
    } catch (err) {
      Alert.alert('Unggah gagal', err instanceof Error ? err.message : 'Gagal mengunggah berkas.');
    } finally {
      setBusyAction(null);
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
    if (!api) {
      Alert.alert('Mode pratinjau', 'Hubungkan server pribadi Anda di Pengaturan untuk mengunduh berkas asli.');
      return;
    }
    setBusyAction(`Mengunduh & memeriksa SHA-256 ${file.name}…`);
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
              await Promise.all([fetchDirectory(), refreshServerInfo()]);
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
      await fetchDirectory();
      Alert.alert('Dipindahkan ke Privat', `"${file.name}" sekarang hanya dapat diakses melalui Folder Privat.`);
    } catch (err) {
      Alert.alert('Gagal memindahkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const usedBytes = usage?.used_bytes ?? 45_956_150_067;
  const quotaBytes = usage?.quota_bytes ?? 107_374_182_400;
  const totalCount = usage?.total_files ?? 1248;

  const uploadingCount = queue.filter((i) => i.status === 'uploading').length;
  const backupStatusKind = backupRules.lastDelayReason
    ? 'warning'
    : uploadingCount > 0
      ? 'uploading'
      : 'ok';
  const backupTitle = backupRules.lastDelayReason
    ? 'Backup tertunda'
    : uploadingCount > 0
      ? `Mengunggah ${uploadingCount} berkas`
      : 'Backup selesai';
  const backupSubtitle = backupRules.lastDelayReason
    ? backupRules.lastDelayReason
    : `${backupRules.lastSuccessAt ? formatShortTime(backupRules.lastSuccessAt) : 'Terbaru'} · ${totalCount.toLocaleString('id-ID')} item`;

  const entries: ListEntry[] = [
    ...folders.map((folder): ListEntry => ({ kind: 'folder', folder })),
    ...files.map((file): ListEntry => ({ kind: 'file', file })),
    ...(!folderId && !query.trim() ? [{ kind: 'private-shortcut' as const }] : []),
  ];

  const categoryToRowKind = (cat: DriveFile['category']): FileRowKind => {
    if (cat === 'image' || cat === 'video' || cat === 'audio' || cat === 'archive' || cat === 'document') {
      return cat;
    }
    return 'other';
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={entries}
          keyExtractor={(item, idx) =>
            item.kind === 'folder'
              ? `f-${item.folder.id}`
              : item.kind === 'file'
                ? `d-${item.file.id}`
                : `priv-${idx}`
          }
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void fetchDirectory()}
              tintColor={palette.accent}
            />
          }
          contentContainerStyle={styles.listPad}
          ListHeaderComponent={
            <View>
              <ScreenHeader
                title="Berkas"
                subtitle={`${formatBytes(usedBytes)} dari ${formatBytes(quotaBytes)}`}
              />

              <View style={styles.section}>
                {!api ? (
                  <Pressable
                    onPress={() => router.push('/settings/connect')}
                    accessibilityRole="button"
                    style={{ marginBottom: 12 }}>
                    <Surface solid style={styles.connectBanner}>
                      <View style={{ flex: 1 }}>
                        <AppText weight="bold" size={14}>
                          Hubungkan Server Pribadi
                        </AppText>
                        <AppText weight="medium" size={12} color="secondary">
                          Ketuk untuk memasukkan alamat server &amp; token dari dashboard.
                        </AppText>
                      </View>
                      <AppText weight="bold" size={13} color="accent">
                        Hubungkan
                      </AppText>
                    </Surface>
                  </Pressable>
                ) : null}

                <SearchField value={query} onChangeText={setQuery} />

                <View style={{ marginTop: 12 }}>
                  <BackupCard
                    statusKind={backupStatusKind}
                    title={backupTitle}
                    subtitle={backupSubtitle}
                    usedBytes={usedBytes}
                    quotaBytes={quotaBytes}
                    onPress={() => router.push('/(tabs)/backup')}
                  />
                </View>

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
                  ).map(([key, label]) => (
                    <Chip
                      key={key}
                      label={label}
                      active={category === key}
                      onPress={() => setCategory(key)}
                    />
                  ))}
                </ScrollView>

                {breadcrumbs.length > 0 ? (
                  <Pressable
                    onPress={() => {
                      const parent =
                        breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].id : null;
                      setFolderId(parent);
                    }}
                    style={styles.backFolder}
                    accessibilityRole="button">
                    <ChevronLeft size={18} color={palette.accent} strokeWidth={2.2} />
                    <AppText weight="semibold" size={14} color="accent">
                      {breadcrumbs.map((b) => b.name).join(' / ')}
                    </AppText>
                  </Pressable>
                ) : null}

                <View style={styles.sectionHeader}>
                  <AppText weight="bold" size={15}>
                    {query.trim() ? 'Hasil pencarian' : folderId ? 'Isi folder' : 'Terbaru'}
                  </AppText>
                  <Pressable
                    onPress={cycleSort}
                    style={styles.sortBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Urutkan berdasarkan ${sortLabel}`}>
                    <ArrowUpDown size={15} color={palette.accent} strokeWidth={2} />
                    <AppText weight="semibold" size={13} color="accent">
                      {sortLabel}
                    </AppText>
                  </Pressable>
                </View>
              </View>
            </View>
          }
          renderItem={({ item, index }) => (
            <View style={styles.cardRowContainer}>
              <Surface
                style={[
                  index === 0 && styles.firstCard,
                  index === entries.length - 1 && styles.lastCard,
                  index > 0 && styles.middleCard,
                  index < entries.length - 1 && styles.notLastCard,
                ]}>
                {item.kind === 'folder' ? (
                  <FileRow
                    kind="folder"
                    title={item.folder.name}
                    subtitle={`Folder · ${item.folder.files_count} berkas`}
                    showDivider={index > 0}
                    onPress={() => {
                      if (!api) {
                        Alert.alert('Data contoh', 'Hubungkan server untuk menelusuri isi folder nyata.');
                        return;
                      }
                      setFolderId(item.folder.id);
                    }}
                  />
                ) : item.kind === 'file' ? (
                  <FileRow
                    kind={categoryToRowKind(item.file.category)}
                    title={item.file.name}
                    subtitle={`${item.file.mime_type.split('/').pop()?.toUpperCase() || 'BERKAS'} · ${formatBytes(item.file.size_bytes)} · ${formatShortTime(item.file.created_at)}`}
                    showDivider={index > 0}
                    onPress={() => setSelectedFile(item.file)}
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
          )}
          ListEmptyComponent={
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
          }
        />

        <FabButton label="Tambah" onPress={() => setAddSheetOpen(true)} />

        {/* Add action sheet */}
        <Modal
          visible={addSheetOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAddSheetOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setAddSheetOpen(false)}>
            <Surface solid style={styles.sheet}>
              <AppText weight="bold" size={17} style={{ marginBottom: 12 }}>
                Tambah ke {folderId ? 'folder ini' : 'GunyDrive'}
              </AppText>
              <Pressable onPress={() => void handleUploadManual()} style={styles.sheetItem}>
                <Upload size={20} color={palette.accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
                    Unggah berkas
                  </AppText>
                  <AppText size={12.5} color="secondary">
                    Pilih PDF, foto, video, audio, ZIP, atau format lain
                  </AppText>
                </View>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAddSheetOpen(false);
                  setNewFolderModal(true);
                }}
                style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <FolderPlus size={20} color={palette.accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
                    Buat folder baru
                  </AppText>
                  <AppText size={12.5} color="secondary">
                    Kelompokkan berkas dalam ruang biasa
                  </AppText>
                </View>
              </Pressable>
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
                <Pressable onPress={() => setNewFolderModal(false)} style={styles.btnGhost}>
                  <AppText weight="semibold" color="secondary">
                    Batal
                  </AppText>
                </Pressable>
                <Pressable
                  onPress={() => void handleCreateFolder()}
                  style={[styles.btnPrimary, { backgroundColor: palette.accent }]}>
                  <AppText weight="bold" color="onAccent">
                    Buat
                  </AppText>
                </Pressable>
              </View>
            </Surface>
          </Pressable>
        </Modal>

        {/* File detail / action modal */}
        <Modal
          visible={selectedFile !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedFile(null)}>
          <Pressable style={styles.backdrop} onPress={() => setSelectedFile(null)}>
            {selectedFile ? (
              <Surface solid style={styles.sheet}>
                <AppText weight="bold" size={17} numberOfLines={2}>
                  {selectedFile.name}
                </AppText>
                <AppText size={12.5} color="secondary" tabular style={{ marginTop: 4, marginBottom: 14 }}>
                  {selectedFile.mime_type} · {formatBytes(selectedFile.size_bytes)} · SHA-256:{' '}
                  {selectedFile.sha256.slice(0, 12)}…
                </AppText>

                <Pressable onPress={() => void handleDownloadFile(selectedFile)} style={styles.sheetItem}>
                  <Download size={19} color={palette.accent} strokeWidth={2} />
                  <AppText weight="bold" size={15}>
                    Unduh salinan asli (verifikasi SHA-256)
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => void handleMoveToPrivate(selectedFile)}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <Lock size={19} color={palette.accent} strokeWidth={2} />
                  <AppText weight="bold" size={15}>
                    Pindahkan ke Folder Privat
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => void handleTrashFile(selectedFile)}
                  style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                  <Trash2 size={19} color={palette.danger} strokeWidth={2} />
                  <AppText weight="bold" size={15} color="danger">
                    Pindahkan ke Sampah
                  </AppText>
                </Pressable>
              </Surface>
            ) : null}
          </Pressable>
        </Modal>

        {/* Progress overlay */}
        {busyAction ? (
          <View style={styles.busyOverlay}>
            <Surface solid style={styles.busyCard}>
              <ActivityIndicator color={palette.accent} />
              <AppText weight="semibold" size={14} style={{ marginTop: 10 }}>
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
    gap: 8,
    paddingTop: 14,
    paddingBottom: 2,
  },
  backFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    minHeight: 36,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
  },
  cardRowContainer: {
    paddingHorizontal: Spacing.screen,
  },
  firstCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  middleCard: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  notLastCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  lastCard: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
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
    paddingVertical: 14,
    minHeight: 52,
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
