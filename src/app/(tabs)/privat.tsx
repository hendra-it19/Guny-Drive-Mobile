import { FileSkeleton } from '@/components/ui/FileSkeleton';
import { ActionPressable } from '@/components/ui/ActionPressable';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  Eye,
  EyeOff,
  FolderLock,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  ShieldAlert,
  Upload,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import {
  DriveFileGridTile,
  getDriveFileThumbnailSource,
} from '@/components/ui/DriveFileGridTile';
import { FileRow } from '@/components/ui/FileRow';
import {
  FileViewToolbar,
  getGridMetrics,
  sortFileEntries,
  useFileViewPreferences,
} from '@/components/ui/FileViewToolbar';
import { OnlineFileViewerModal } from '@/components/ui/OnlineFileViewerModal';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Surface } from '@/components/ui/Surface';
import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile } from '@/lib/api';
import { uploadLocalFileDirect } from '@/lib/backup-engine';
import { formatBytes, formatShortTime } from '@/lib/format';

export default function PrivatScreen() {
  const { palette } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const {
    layout: vaultLayout,
    sort: vaultSort,
    setLayout: setVaultLayout,
    setSort: setVaultSort,
  } = useFileViewPreferences('file_view_pref_vault_v1', 'list', 'newest');
  const { columns: vaultColumns, gap: vaultGridGap, tileSize: vaultTileSize } = getGridMetrics(
    windowWidth,
    vaultLayout,
  );
  const {
    api,
    me,
    vaultToken,
    vaultUnlocked,
    setupVault,
    unlockVault,
    lockVault,
    touchVaultActivity,
  } = useApp();

  const [creatingVault, setCreatingVault] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [vaultNextCursor, setVaultNextCursor] = useState<string | null>(null);
  const [selectedPrivateFile, setSelectedPrivateFile] = useState<DriveFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMoreVault, setLoadingMoreVault] = useState(false);
  const loadingMoreVaultRef = useRef(false);

  const vaultConfigured = Boolean(me?.vault_configured);

  const sortedVaultFiles = useMemo(
    () =>
      sortFileEntries(files, vaultSort, (f) => ({
        name: f.name,
        dateMs: new Date(f.media_taken_at ?? f.created_at).getTime() || 0,
        sizeBytes: f.size_bytes,
      })),
    [files, vaultSort],
  );

  const loadVaultFiles = useCallback(async () => {
    if (!api || !vaultToken) {
      setFiles([]);
      setVaultNextCursor(null);
      return;
    }
    setLoadingFiles(true);
    try {
      const res = await api.listVaultFiles(vaultToken, { perPage: 24 });
      setFiles(res.files);
      setVaultNextCursor(res.next_cursor ?? null);
      touchVaultActivity();
    } catch {
      await lockVault(false);
    } finally {
      setLoadingFiles(false);
    }
  }, [api, lockVault, touchVaultActivity, vaultToken]);

  const loadMoreVaultFiles = useCallback(async () => {
    if (!api || !vaultToken || !vaultNextCursor || loadingFiles || loadingMoreVaultRef.current) return;
    loadingMoreVaultRef.current = true;
    setLoadingMoreVault(true);
    try {
      const res = await api.listVaultFiles(vaultToken, {
        cursor: vaultNextCursor,
        perPage: 24,
      });
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...res.files.filter((f) => !seen.has(f.id))];
      });
      setVaultNextCursor(res.next_cursor ?? null);
      touchVaultActivity();
    } catch {
      // Keep existing
    } finally {
      loadingMoreVaultRef.current = false;
      setLoadingMoreVault(false);
    }
  }, [api, loadingFiles, touchVaultActivity, vaultNextCursor, vaultToken]);

  useEffect(() => {
    if (!vaultUnlocked || !api || !vaultToken) {
      return;
    }
    let active = true;
    void api
      .listVaultFiles(vaultToken, { perPage: 24 })
      .then((res) => {
        if (!active) return;
        setFiles(res.files);
        setVaultNextCursor(res.next_cursor ?? null);
        touchVaultActivity();
      })
      .catch(() => {
        if (active) {
          void lockVault(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api, lockVault, touchVaultActivity, vaultToken, vaultUnlocked]);

  const handleCreateVault = async () => {
    const cleanPin = newPin.trim();
    const cleanConfirm = confirmPin.trim();
    if (cleanPin.length < 4) {
      setErrorText('Masukkan PIN Folder Privat minimal 4 digit.');
      return;
    }
    if (cleanPin !== cleanConfirm) {
      setErrorText('Konfirmasi PIN tidak cocok dengan PIN yang dimasukkan.');
      return;
    }
    setUnlocking(true);
    setErrorText(null);
    try {
      await setupVault(cleanPin, cleanConfirm);
      setNewPin('');
      setConfirmPin('');
      setCreatingVault(false);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Gagal membuat Folder Privat. Coba lagi.',
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlock = async () => {
    if (!passphrase.trim()) {
      setErrorText('Masukkan PIN Folder Privat Anda.');
      return;
    }
    setUnlocking(true);
    setErrorText(null);
    try {
      await unlockVault(passphrase);
      setPassphrase('');
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : 'Server tidak dapat dihubungi. Coba lagi.',
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handleUploadPrivate = async () => {
    if (!api || !vaultToken) return;
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: Platform.OS === 'ios',
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    try {
      touchVaultActivity();
      await uploadLocalFileDirect({
        api,
        localUri: asset.uri,
        filename: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        space: 'private',
        vaultToken,
        existingServerFiles: files,
      });
      await loadVaultFiles();
    } catch (err) {
      Alert.alert(
        'Unggah privat gagal',
        err instanceof Error ? err.message : 'Sesi mungkin berakhir.',
      );
    }
  };

  const handleExportPrivateFile = (file: DriveFile) => {
    if (!api || !vaultToken) return;
    Alert.alert(
      'Simpan salinan di luar Folder Privat?',
      `Salinan "${file.name}" yang diekspor ke penyimpanan perangkat atau aplikasi lain berada di luar perlindungan Folder Privat.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Lanjutkan ekspor',
          onPress: async () => {
            try {
              touchVaultActivity();
              const { localUri } = await api.downloadAndVerify(file, vaultToken);
              if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
                await Sharing.shareAsync(localUri);
              }
            } catch (err) {
              Alert.alert(
                'Gagal mengunduh',
                err instanceof Error ? err.message : 'Terjadi kesalahan.',
              );
            }
          },
        },
      ],
    );
  };

  type VaultRow =
    | { kind: 'list'; key: string; file: DriveFile; idx: number; total: number }
    | { kind: 'grid'; key: string; files: DriveFile[] };

  const vaultRows = useMemo<VaultRow[]>(() => {
    if (!vaultUnlocked || sortedVaultFiles.length === 0) return [];
    if (vaultLayout === 'list') {
      return sortedVaultFiles.map((file, idx) => ({
        kind: 'list' as const,
        key: `vl-${file.id}`,
        file,
        idx,
        total: sortedVaultFiles.length,
      }));
    }
    const rows: VaultRow[] = [];
    for (let i = 0; i < sortedVaultFiles.length; i += vaultColumns) {
      const chunk = sortedVaultFiles.slice(i, i + vaultColumns);
      rows.push({ kind: 'grid', key: `vg-${chunk[0].id}`, files: chunk });
    }
    return rows;
  }, [sortedVaultFiles, vaultColumns, vaultLayout, vaultUnlocked]);

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {vaultUnlocked ? (
          <FlatList
            data={vaultRows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={styles.scrollPad}
            onEndReached={() => void loadMoreVaultFiles()}
            onEndReachedThreshold={0.45}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            refreshControl={
              <RefreshControl
                refreshing={loadingFiles && files.length > 0}
                onRefresh={() => void loadVaultFiles()}
                tintColor={palette.accent}
              />
            }
            ListHeaderComponent={
              <View>
                <ScreenHeader
                  title="Privat"
                  rightElement={
                    <ActionPressable
                      onPress={() => {
                        setFiles([]);
                        void lockVault(true);
                      }}
                      style={[styles.lockNowBtn, { backgroundColor: palette.accent }]}
                      accessibilityRole="button">
                      <Lock size={14} color={palette.onAccent} strokeWidth={2.2} />
                      <AppText weight="bold" size={12.5} color="onAccent">
                        Kunci sekarang
                      </AppText>
                    </ActionPressable>
                  }
                />
                <View style={[styles.section, { gap: 12, marginBottom: 12 }]}>
                  <Surface solid style={styles.unlockedBanner}>
                    <AppText
                      weight="semibold"
                      size={12.5}
                      color="secondary"
                      style={{ flex: 1 }}>
                      Sesi privat aktif · terkunci otomatis bila diam 5 menit.
                    </AppText>
                    <ActionPressable
                      onPress={() => void handleUploadPrivate()}
                      style={[
                        styles.uploadPrivBtn,
                        { backgroundColor: palette.accent },
                      ]}>
                      <Upload size={15} color={palette.onAccent} strokeWidth={2.2} />
                      <AppText weight="bold" size={13} color="onAccent">
                        Unggah
                      </AppText>
                    </ActionPressable>
                  </Surface>

                  <FileViewToolbar
                    layout={vaultLayout}
                    sort={vaultSort}
                    onChangeLayout={setVaultLayout}
                    onChangeSort={setVaultSort}
                    countLabel={`${sortedVaultFiles.length} berkas`}
                  />
                </View>
              </View>
            }
            renderItem={({ item }) => {
              if (item.kind === 'list') {
                return (
                  <View style={styles.section}>
                    <Surface
                      solid
                      style={[
                        item.idx === 0 && item.total > 1 && {
                          borderBottomLeftRadius: 0,
                          borderBottomRightRadius: 0,
                          borderBottomWidth: 0,
                        },
                        item.idx === item.total - 1 && item.total > 1 && {
                          borderTopLeftRadius: 0,
                          borderTopRightRadius: 0,
                          borderTopWidth: 0,
                        },
                        item.idx > 0 && item.idx < item.total - 1 && {
                          borderRadius: 0,
                          borderTopWidth: 0,
                          borderBottomWidth: 0,
                        },
                      ]}>
                      <FileRow
                        kind="private"
                        title={item.file.name}
                        subtitle={`${formatBytes(item.file.size_bytes)} · ${formatShortTime(item.file.created_at)}`}
                        mimeType={item.file.mime_type}
                        thumbnailPreset={item.file.thumbnail_preset}
                        thumbnailSource={getDriveFileThumbnailSource(api, item.file, vaultToken)}
                        showDivider={item.idx > 0}
                        onPress={() => {
                          touchVaultActivity();
                          setSelectedPrivateFile(item.file);
                        }}
                      />
                    </Surface>
                  </View>
                );
              }
              return (
                <View style={[styles.section, { marginBottom: vaultGridGap }]}>
                  <View style={{ flexDirection: 'row', gap: vaultGridGap }}>
                    {item.files.map((file) => (
                      <DriveFileGridTile
                        key={file.id}
                        file={file}
                        api={api}
                        vaultToken={vaultToken}
                        size={vaultTileSize}
                        layout={vaultLayout}
                        onPress={() => {
                          touchVaultActivity();
                          setSelectedPrivateFile(file);
                        }}
                      />
                    ))}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.section}>
                <Surface solid>
                  {loadingFiles ? (
                    <FileSkeleton layout={vaultLayout} />
                  ) : (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <AppText weight="bold" size={14}>
                        Folder Privat masih kosong
                      </AppText>
                      <AppText
                        size={12.5}
                        color="secondary"
                        style={{ marginTop: 4, textAlign: 'center' }}>
                        Unggah langsung ke sini atau pindahkan berkas dari tab Berkas.
                      </AppText>
                    </View>
                  )}
                </Surface>
              </View>
            }
            ListFooterComponent={
              loadingMoreVault ? (
                <FileSkeleton compact layout={vaultLayout} />
              ) : undefined
            }
          />
        ) : (
        <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title="Privat"
            rightElement={
              <AppText weight="semibold" size={13} color="secondary">
                {vaultConfigured ? 'Terkunci' : 'Belum Dibuat'}
              </AppText>
            }
          />

          <View style={styles.section}>
            {!vaultConfigured ? (
              /* ============================================================
               * STATE 1: FOLDER PRIVAT BELUM ADA -> BUAT FOLDER PRIVAT + PIN
               * ============================================================ */
              <Surface solid style={styles.lockCard}>
                <View style={[styles.lockCircle, { backgroundColor: palette.activeBg }]}>
                  <FolderLock size={30} color={palette.activeFg} strokeWidth={2} />
                </View>

                <AppText
                  weight="extrabold"
                  size={20}
                  style={{ textAlign: 'center', marginTop: 14 }}>
                  {creatingVault ? 'Atur PIN Folder Privat' : 'Folder Privat Belum Ada'}
                </AppText>
                <AppText
                  size={13}
                  color="secondary"
                  style={{ textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
                  {creatingVault
                    ? 'Masukkan PIN dan konfirmasi PIN untuk membuat Folder Privat. Selanjutnya Folder Privat akan dibuka menggunakan PIN ini.'
                    : 'Simpan berkas, foto, dan dokumen rahasia di ruang terenkripsi yang terpisah dari daftar berkas biasa dan pencarian.'}
                </AppText>

                {!creatingVault ? (
                  <ActionPressable
                    onPress={() => {
                      setErrorText(null);
                      setCreatingVault(true);
                    }}
                    accessibilityRole="button"
                    style={[styles.unlockBtn, { backgroundColor: palette.accent }]}>
                    <Plus size={18} color={palette.onAccent} strokeWidth={2.4} />
                    <AppText weight="bold" size={15} color="onAccent">
                      Buat Folder Privat
                    </AppText>
                  </ActionPressable>
                ) : (
                  <View style={{ width: '100%', marginTop: 18, gap: 12 }}>
                    <View>
                      <AppText weight="semibold" size={13} style={{ marginBottom: 6 }}>
                        Masukkan PIN Baru
                      </AppText>
                      <View
                        style={[
                          styles.passInputWrap,
                          {
                            borderColor: palette.border,
                            backgroundColor: palette.background,
                          },
                        ]}>
                        <TextInput
                          value={newPin}
                          onChangeText={(t) => {
                            setNewPin(t);
                            setErrorText(null);
                          }}
                          secureTextEntry={!showPassphrase}
                          keyboardType="number-pad"
                          placeholder="Masukkan PIN (minimal 4 digit)"
                          placeholderTextColor={palette.textSecondary}
                          accessibilityLabel="Masukkan PIN Baru"
                          style={[
                            styles.passInput,
                            { color: palette.text, fontFamily: FontFamily.medium },
                          ]}
                        />
                        <ActionPressable
                          onPress={() => setShowPassphrase((v) => !v)}
                          accessibilityRole="button"
                          hitSlop={10}>
                          {showPassphrase ? (
                            <EyeOff size={19} color={palette.textSecondary} />
                          ) : (
                            <Eye size={19} color={palette.textSecondary} />
                          )}
                        </ActionPressable>
                      </View>
                    </View>

                    <View>
                      <AppText weight="semibold" size={13} style={{ marginBottom: 6 }}>
                        Konfirmasi PIN Baru
                      </AppText>
                      <View
                        style={[
                          styles.passInputWrap,
                          {
                            borderColor: palette.border,
                            backgroundColor: palette.background,
                          },
                        ]}>
                        <TextInput
                          value={confirmPin}
                          onChangeText={(t) => {
                            setConfirmPin(t);
                            setErrorText(null);
                          }}
                          secureTextEntry={!showPassphrase}
                          keyboardType="number-pad"
                          placeholder="Ulangi PIN yang sama"
                          placeholderTextColor={palette.textSecondary}
                          accessibilityLabel="Konfirmasi PIN Baru"
                          onSubmitEditing={() => void handleCreateVault()}
                          style={[
                            styles.passInput,
                            { color: palette.text, fontFamily: FontFamily.medium },
                          ]}
                        />
                      </View>
                    </View>

                    {errorText ? (
                      <View style={styles.errBox}>
                        <ShieldAlert size={16} color={palette.danger} />
                        <AppText
                          weight="semibold"
                          size={12.5}
                          color="danger"
                          style={{ flex: 1 }}>
                          {errorText}
                        </AppText>
                      </View>
                    ) : null}

                    <ActionPressable
                      disabled={unlocking}
                      onPress={() => void handleCreateVault()}
                      accessibilityRole="button"
                      style={[
                        styles.unlockBtn,
                        { backgroundColor: palette.accent, marginTop: 4 },
                      ]}>
                      {unlocking ? (
                        <ActivityIndicator color={palette.onAccent} />
                      ) : (
                        <>
                          <KeyRound
                            size={17}
                            color={palette.onAccent}
                            strokeWidth={2.2}
                          />
                          <AppText weight="bold" size={15} color="onAccent">
                            Simpan PIN &amp; Buka Folder Privat
                          </AppText>
                        </>
                      )}
                    </ActionPressable>

                    <ActionPressable
                      disabled={unlocking}
                      onPress={() => {
                        setCreatingVault(false);
                        setNewPin('');
                        setConfirmPin('');
                        setErrorText(null);
                      }}
                      accessibilityRole="button"
                      style={[styles.cancelBtn, { borderColor: palette.border }]}>
                      <AppText weight="semibold" size={13.5} color="secondary">
                        Batal
                      </AppText>
                    </ActionPressable>
                  </View>
                )}
              </Surface>
            ) : (
              /* ============================================================
               * STATE 2: FOLDER PRIVAT SUDAH ADA & TERKUNCI -> BUKA DENGAN PIN
               * ============================================================ */
              <Surface solid style={styles.lockCard}>
                <View style={[styles.lockCircle, { backgroundColor: palette.activeBg }]}>
                  <Lock size={30} color={palette.activeFg} strokeWidth={2} />
                </View>

                <AppText
                  weight="extrabold"
                  size={20}
                  style={{ textAlign: 'center', marginTop: 14 }}>
                  Folder Privat Terkunci
                </AppText>
                <AppText
                  size={13}
                  color="secondary"
                  style={{ textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
                  Masukkan PIN Folder Privat Anda untuk membuka berkas rahasia. Terkunci
                  otomatis saat aplikasi masuk latar atau diam 5 menit.
                </AppText>

                <View style={{ width: '100%', marginTop: 20 }}>
                  <AppText weight="semibold" size={13} style={{ marginBottom: 6 }}>
                    PIN Folder Privat
                  </AppText>
                  <View
                    style={[
                      styles.passInputWrap,
                      {
                        borderColor: palette.border,
                        backgroundColor: palette.background,
                      },
                    ]}>
                    <TextInput
                      value={passphrase}
                      onChangeText={(t) => {
                        setPassphrase(t);
                        setErrorText(null);
                      }}
                      secureTextEntry={!showPassphrase}
                      keyboardType="number-pad"
                      placeholder="Masukkan PIN Folder Privat"
                      placeholderTextColor={palette.textSecondary}
                      autoCapitalize="none"
                      accessibilityLabel="PIN Folder Privat"
                      onSubmitEditing={() => void handleUnlock()}
                      style={[
                        styles.passInput,
                        { color: palette.text, fontFamily: FontFamily.medium },
                      ]}
                    />
                    <ActionPressable
                      onPress={() => setShowPassphrase((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassphrase ? 'Sembunyikan PIN' : 'Tampilkan PIN'
                      }
                      hitSlop={10}>
                      {showPassphrase ? (
                        <EyeOff size={19} color={palette.textSecondary} />
                      ) : (
                        <Eye size={19} color={palette.textSecondary} />
                      )}
                    </ActionPressable>
                  </View>
                </View>

                {errorText ? (
                  <View style={styles.errBox}>
                    <ShieldAlert size={16} color={palette.danger} />
                    <AppText
                      weight="semibold"
                      size={12.5}
                      color="danger"
                      style={{ flex: 1 }}>
                      {errorText}
                    </AppText>
                  </View>
                ) : null}

                <ActionPressable
                  disabled={unlocking}
                  onPress={() => void handleUnlock()}
                  accessibilityRole="button"
                  style={[styles.unlockBtn, { backgroundColor: palette.accent }]}>
                  {unlocking ? (
                    <ActivityIndicator color={palette.onAccent} />
                  ) : (
                    <>
                      <LockOpen
                        size={17}
                        color={palette.onAccent}
                        strokeWidth={2.2}
                      />
                      <AppText weight="bold" size={15} color="onAccent">
                        {errorText ? 'Coba lagi' : 'Buka Folder Privat'}
                      </AppText>
                    </>
                  )}
                </ActionPressable>
              </Surface>
            )}
          </View>
        </ScrollView>
        )}

        <OnlineFileViewerModal
          file={selectedPrivateFile}
          api={api}
          vaultToken={vaultToken}
          onClose={() => setSelectedPrivateFile(null)}
          onDownload={(f) => handleExportPrivateFile(f)}
          onTrash={async (f) => {
            if (!api || !vaultToken) return;
            Alert.alert(
              'Hapus dari Folder Privat?',
              `Pindahkan "${f.name}" ke Sampah Privat?`,
              [
                { text: 'Batal', style: 'cancel' },
                {
                  text: 'Hapus',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.trashVaultFile(vaultToken, f.id);
                      setSelectedPrivateFile(null);
                      await loadVaultFiles();
                    } catch (err) {
                      Alert.alert(
                        'Gagal menghapus',
                        err instanceof Error ? err.message : 'Terjadi kesalahan.',
                      );
                    }
                  },
                },
              ],
            );
          }}
        />
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingBottom: 140 },
  section: { paddingHorizontal: Spacing.screen },
  lockNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 999,
  },
  lockCard: {
    padding: 22,
    alignItems: 'center',
  },
  lockCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passInputWrap: {
    height: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  passInput: {
    flex: 1,
    fontSize: 15,
  },
  errBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginTop: 4,
  },
  unlockBtn: {
    width: '100%',
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  cancelBtn: {
    width: '100%',
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockedBanner: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  uploadPrivBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
