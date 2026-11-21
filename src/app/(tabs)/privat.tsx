import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Eye, EyeOff, Lock, LockOpen, ShieldAlert, Upload } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { FileRow } from '@/components/ui/FileRow';
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
  const { api, vaultToken, vaultUnlocked, unlockVault, lockVault, touchVaultActivity } = useApp();

  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const loadVaultFiles = useCallback(async () => {
    if (!api || !vaultToken) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    try {
      const res = await api.listVaultFiles(vaultToken);
      setFiles(res.files);
      touchVaultActivity();
    } catch {
      await lockVault(false);
    } finally {
      setLoadingFiles(false);
    }
  }, [api, lockVault, touchVaultActivity, vaultToken]);

  useEffect(() => {
    if (!vaultUnlocked || !api || !vaultToken) {
      return;
    }
    let active = true;
    void api
      .listVaultFiles(vaultToken)
      .then((res) => {
        if (!active) return;
        setFiles(res.files);
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

  const handleUnlock = async () => {
    if (!passphrase.trim()) {
      setErrorText('Masukkan frasa sandi Folder Privat.');
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
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
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
      });
      await loadVaultFiles();
    } catch (err) {
      Alert.alert('Unggah privat gagal', err instanceof Error ? err.message : 'Sesi mungkin berakhir.');
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
              Alert.alert('Gagal mengunduh', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            }
          },
        },
      ],
    );
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <ScreenHeader
            title="Privat"
            rightElement={
              vaultUnlocked ? (
                <Pressable
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
                </Pressable>
              ) : (
                <AppText weight="semibold" size={13} color="secondary">
                  Terkunci
                </AppText>
              )
            }
          />

          <View style={styles.section}>
            {!vaultUnlocked ? (
              <Surface solid style={styles.lockCard}>
                <View style={[styles.lockCircle, { backgroundColor: palette.activeBg }]}>
                  <Lock size={30} color={palette.activeFg} strokeWidth={2} />
                </View>

                <AppText weight="extrabold" size={20} style={{ textAlign: 'center', marginTop: 14 }}>
                  Folder Privat Terkunci
                </AppText>
                <AppText
                  size={13}
                  color="secondary"
                  style={{ textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
                  Nama berkas dan pratinjau di sini disembunyikan dari pustaka biasa, pencarian, dan
                  galeri. Terkunci otomatis saat aplikasi masuk latar atau diam 5 menit.
                </AppText>

                <View style={{ width: '100%', marginTop: 20 }}>
                  <AppText weight="semibold" size={13} style={{ marginBottom: 6 }}>
                    Frasa sandi Folder Privat
                  </AppText>
                  <View
                    style={[
                      styles.passInputWrap,
                      { borderColor: palette.border, backgroundColor: palette.background },
                    ]}>
                    <TextInput
                      value={passphrase}
                      onChangeText={(t) => {
                        setPassphrase(t);
                        setErrorText(null);
                      }}
                      secureTextEntry={!showPassphrase}
                      placeholder="Masukkan frasa sandi"
                      placeholderTextColor={palette.textSecondary}
                      autoCapitalize="none"
                      accessibilityLabel="Frasa sandi Folder Privat"
                      onSubmitEditing={() => void handleUnlock()}
                      style={[
                        styles.passInput,
                        { color: palette.text, fontFamily: FontFamily.medium },
                      ]}
                    />
                    <Pressable
                      onPress={() => setShowPassphrase((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={showPassphrase ? 'Sembunyikan frasa sandi' : 'Tampilkan frasa sandi'}
                      hitSlop={10}>
                      {showPassphrase ? (
                        <EyeOff size={19} color={palette.textSecondary} />
                      ) : (
                        <Eye size={19} color={palette.textSecondary} />
                      )}
                    </Pressable>
                  </View>
                </View>

                {errorText ? (
                  <View style={styles.errBox}>
                    <ShieldAlert size={16} color={palette.danger} />
                    <AppText weight="semibold" size={12.5} color="danger" style={{ flex: 1 }}>
                      {errorText}
                    </AppText>
                  </View>
                ) : null}

                <Pressable
                  disabled={unlocking}
                  onPress={() => void handleUnlock()}
                  accessibilityRole="button"
                  style={[styles.unlockBtn, { backgroundColor: palette.accent }]}>
                  {unlocking ? (
                    <ActivityIndicator color={palette.onAccent} />
                  ) : (
                    <>
                      <LockOpen size={17} color={palette.onAccent} strokeWidth={2.2} />
                      <AppText weight="bold" size={15} color="onAccent">
                        {errorText ? 'Coba lagi' : 'Buka folder'}
                      </AppText>
                    </>
                  )}
                </Pressable>
              </Surface>
            ) : (
              <View style={{ gap: 12 }}>
                <Surface solid style={styles.unlockedBanner}>
                  <AppText weight="semibold" size={13} color="secondary" style={{ flex: 1 }}>
                    Sesi privat aktif · terkunci otomatis bila diam 5 menit atau keluar aplikasi.
                  </AppText>
                  <Pressable
                    onPress={() => void handleUploadPrivate()}
                    style={[styles.uploadPrivBtn, { backgroundColor: palette.accent }]}>
                    <Upload size={15} color={palette.onAccent} strokeWidth={2.2} />
                    <AppText weight="bold" size={13} color="onAccent">
                      Unggah
                    </AppText>
                  </Pressable>
                </Surface>

                <Surface solid>
                  {loadingFiles ? (
                    <View style={{ padding: 28, alignItems: 'center' }}>
                      <ActivityIndicator color={palette.accent} />
                    </View>
                  ) : files.length === 0 ? (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <AppText weight="bold" size={14}>
                        Folder Privat masih kosong
                      </AppText>
                      <AppText size={12.5} color="secondary" style={{ marginTop: 4, textAlign: 'center' }}>
                        Unggah langsung ke sini atau pindahkan berkas dari tab Berkas.
                      </AppText>
                    </View>
                  ) : (
                    files.map((file, idx) => (
                      <FileRow
                        key={file.id}
                        kind="private"
                        title={file.name}
                        subtitle={`${formatBytes(file.size_bytes)} · ${formatShortTime(file.created_at)}`}
                        showDivider={idx > 0}
                        onPress={() => handleExportPrivateFile(file)}
                      />
                    ))
                  )}
                </Surface>
              </View>
            )}
          </View>
        </ScrollView>
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
    marginTop: 12,
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
