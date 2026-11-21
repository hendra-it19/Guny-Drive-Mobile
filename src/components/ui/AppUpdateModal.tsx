import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import {
  canInstallApkDirectly,
  downloadReleaseApk,
  type GitHubReleaseInfo,
  installDownloadedReleaseApk,
  openReleaseInBrowser,
  type UpdateDownloadProgress,
} from '@/lib/app-updater';
import { formatBytes } from '@/lib/format';

import { ActionPressable } from './ActionPressable';
import { AppText } from './AppText';
import { Surface } from './Surface';

type InstallPhase = 'idle' | 'downloading' | 'ready' | 'permission_required' | 'error';

function AppUpdateModalContent({
  appVersion,
  availableUpdate,
  onClose,
  onSkip,
}: {
  appVersion: string;
  availableUpdate: GitHubReleaseInfo;
  onClose: () => void;
  onSkip: () => Promise<void>;
}) {
  const { palette } = useAppTheme();

  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [progress, setProgress] = useState<UpdateDownloadProgress>({
    bytesWritten: 0,
    totalBytes: 0,
    percent: 0,
  });
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAndroidApkReady = Platform.OS === 'android' && Boolean(availableUpdate.apkAsset);
  const directInstallSupported = isAndroidApkReady && canInstallApkDirectly();

  const handleCancelDownload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setProgress({ bytesWritten: 0, totalBytes: 0, percent: 0 });
  };

  const triggerInstall = async (localUri: string) => {
    try {
      const outcome = await installDownloadedReleaseApk(localUri, availableUpdate.htmlUrl);
      if (outcome === 'permission_required') {
        setPhase('permission_required');
      } else {
        setPhase('ready');
      }
    } catch (err) {
      setPhase('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal membuka pemasang aplikasi Android. Anda dapat mengunduh manual lewat GitHub.',
      );
    }
  };

  const handlePrimaryAction = async () => {
    setErrorMsg(null);

    if (downloadedUri) {
      await triggerInstall(downloadedUri);
      return;
    }

    if (!isAndroidApkReady) {
      await openReleaseInBrowser(availableUpdate.htmlUrl);
      onClose();
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('downloading');
    setProgress({
      bytesWritten: 0,
      totalBytes: availableUpdate.apkAsset?.sizeBytes ?? 0,
      percent: 0,
    });

    try {
      const localUri = await downloadReleaseApk(
        availableUpdate,
        (next) => setProgress(next),
        controller.signal,
      );
      abortRef.current = null;
      setDownloadedUri(localUri);
      setPhase('ready');
      await triggerInstall(localUri);
    } catch (err) {
      abortRef.current = null;
      if (err instanceof Error && err.name === 'AbortError') {
        setPhase('idle');
        return;
      }
      setPhase('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unduhan pembaruan gagal. Periksa koneksi internet Anda lalu coba lagi.',
      );
    }
  };

  const handleSkip = () => {
    if (phase === 'downloading') {
      handleCancelDownload();
    }
    void onSkip();
  };

  const handleClose = () => {
    if (phase === 'downloading') {
      Alert.alert(
        'Batalkan unduhan pembaruan?',
        'Proses unduhan APK akan dihentikan jika Anda menutup jendela ini.',
        [
          { text: 'Lanjutkan Unduh', style: 'cancel' },
          {
            text: 'Batalkan',
            style: 'destructive',
            onPress: () => {
              handleCancelDownload();
              onClose();
            },
          },
        ],
      );
      return;
    }
    onClose();
  };

  const publishedDate = availableUpdate.publishedAt
    ? new Date(availableUpdate.publishedAt).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <Pressable style={styles.backdrop} onPress={handleClose}>
      <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440 }}>
        <Surface solid style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.heroIcon, { backgroundColor: palette.activeBg }]}>
              <ArrowUpCircle size={26} color={palette.accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeLine}>
                <View style={[styles.newBadge, { backgroundColor: palette.accent }]}>
                  <Sparkles size={10} color={palette.onAccent} />
                  <AppText weight="extrabold" size={10} color="onAccent">
                    PEMBARUAN TERSEDIA
                  </AppText>
                </View>
                {publishedDate ? (
                  <AppText size={11} color="secondary">
                    {publishedDate}
                  </AppText>
                ) : null}
              </View>
              <AppText weight="extrabold" size={18} style={{ marginTop: 3 }} numberOfLines={2}>
                {availableUpdate.name}
              </AppText>
            </View>
            <ActionPressable
              onPress={handleClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Tutup pemberitahuan pembaruan">
              <X size={20} color={palette.textSecondary} />
            </ActionPressable>
          </View>

          <View
            style={[
              styles.versionStrip,
              { backgroundColor: palette.background, borderColor: palette.border },
            ]}>
            <View style={{ flex: 1 }}>
              <AppText size={11} color="secondary">
                Versi terpasang → Rilis baru
              </AppText>
              <AppText weight="extrabold" size={14} tabular style={{ marginTop: 2 }}>
                v{appVersion} → v{availableUpdate.version}
              </AppText>
            </View>
            {availableUpdate.apkAsset && availableUpdate.apkAsset.sizeBytes > 0 ? (
              <View style={[styles.sizePill, { backgroundColor: palette.activeBg }]}>
                <AppText weight="bold" size={11.5} color="accent" tabular>
                  APK · {formatBytes(availableUpdate.apkAsset.sizeBytes)}
                </AppText>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.notesBox,
              { backgroundColor: palette.background, borderColor: palette.border },
            ]}>
            <AppText weight="bold" size={12} color="secondary" style={{ marginBottom: 4 }}>
              Catatan Rilis ({availableUpdate.repo})
            </AppText>
            <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
              <AppText size={12.5} style={{ lineHeight: 19 }}>
                {availableUpdate.body ||
                  'Peningkatan performa, perbaikan bug, dan penyempurnaan fitur GunyDrive terbaru.'}
              </AppText>
            </ScrollView>
          </View>

          {phase === 'downloading' ? (
            <View
              style={[
                styles.statusCard,
                { backgroundColor: palette.activeBg, borderColor: palette.accent },
              ]}>
              <View style={styles.progressTop}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <ActivityIndicator size="small" color={palette.accent} />
                  <AppText weight="bold" size={12.5} color="accent" numberOfLines={1}>
                    Mengunduh {availableUpdate.apkAsset?.name ?? 'pembaruan'}…
                  </AppText>
                </View>
                <AppText weight="extrabold" size={13} color="accent" tabular>
                  {progress.percent}%
                </AppText>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: palette.track }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(4, progress.percent)}%`,
                      backgroundColor: palette.accent,
                    },
                  ]}
                />
              </View>
              <AppText size={11} color="secondary" tabular>
                {formatBytes(progress.bytesWritten)}
                {progress.totalBytes > 0 ? ` / ${formatBytes(progress.totalBytes)}` : ''}
              </AppText>
            </View>
          ) : null}

          {phase === 'permission_required' ? (
            <View
              style={[
                styles.statusCard,
                {
                  backgroundColor: `${palette.warning}1A`,
                  borderColor: palette.warning,
                },
              ]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={17} color={palette.warning} />
                <AppText weight="bold" size={12.5} style={{ flex: 1 }}>
                  Izin Instalasi Aplikasi Diperlukan
                </AppText>
              </View>
              <AppText size={12} color="secondary" style={{ lineHeight: 17 }}>
                Aktifkan opsi &ldquo;Izinkan dari sumber ini&rdquo; pada pengaturan Android yang
                baru dibuka, lalu kembali ke GunyDrive dan tekan tombol{' '}
                <AppText weight="bold" size={12}>
                  Pasang Sekarang
                </AppText>{' '}
                di bawah.
              </AppText>
            </View>
          ) : null}

          {phase === 'ready' && downloadedUri ? (
            <View
              style={[
                styles.statusCard,
                {
                  backgroundColor: `${palette.success}16`,
                  borderColor: palette.success,
                },
              ]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={17} color={palette.success} />
                <AppText weight="bold" size={12.5} color="success" style={{ flex: 1 }}>
                  APK siap dipasang · Ketuk tombol di bawah jika pemasang belum muncul
                </AppText>
              </View>
            </View>
          ) : null}

          {phase === 'error' && errorMsg ? (
            <View
              style={[
                styles.statusCard,
                {
                  backgroundColor: `${palette.danger}18`,
                  borderColor: palette.danger,
                },
              ]}>
              <AppText weight="semibold" size={12} color="danger">
                {errorMsg}
              </AppText>
            </View>
          ) : null}

          <View style={{ gap: 8, marginTop: 2 }}>
            {phase === 'downloading' ? (
              <ActionPressable
                onPress={handleCancelDownload}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: `${palette.danger}1C`,
                    borderWidth: 1,
                    borderColor: palette.danger,
                  },
                ]}>
                <AppText weight="bold" size={14} color="danger">
                  Batalkan Unduhan
                </AppText>
              </ActionPressable>
            ) : (
              <ActionPressable
                onPress={() => void handlePrimaryAction()}
                style={[styles.primaryBtn, { backgroundColor: palette.accent }]}
                accessibilityRole="button">
                {isAndroidApkReady ? (
                  <Download size={17} color={palette.onAccent} strokeWidth={2.3} />
                ) : (
                  <ExternalLink size={17} color={palette.onAccent} strokeWidth={2.3} />
                )}
                <AppText weight="bold" size={14} color="onAccent">
                  {downloadedUri
                    ? 'Pasang Sekarang'
                    : directInstallSupported
                      ? 'Unduh & Pasang Langsung'
                      : isAndroidApkReady
                        ? 'Unduh APK Pembaruan'
                        : 'Buka Rilis di GitHub'}
                </AppText>
              </ActionPressable>
            )}

            <View style={styles.secondaryRow}>
              <ActionPressable
                onPress={handleSkip}
                disabled={phase === 'downloading'}
                style={[styles.secondaryBtn, { borderColor: palette.border }]}>
                <AppText weight="semibold" size={12.5} color="secondary">
                  Lewati Versi Ini
                </AppText>
              </ActionPressable>

              <ActionPressable
                onPress={handleClose}
                style={[styles.secondaryBtn, { borderColor: palette.border }]}>
                <AppText weight="semibold" size={12.5} color="primary">
                  Nanti Saja
                </AppText>
              </ActionPressable>
            </View>

            <ActionPressable
              onPress={() => void openReleaseInBrowser(availableUpdate.htmlUrl)}
              style={styles.githubLink}>
              <ExternalLink size={12.5} color={palette.accent} />
              <AppText weight="semibold" size={12} color="accent">
                Lihat detail rilis {availableUpdate.tagName} di GitHub
              </AppText>
            </ActionPressable>
          </View>
        </Surface>
      </Pressable>
    </Pressable>
  );
}

export function AppUpdateModal() {
  const {
    appVersion,
    availableUpdate,
    updateModalOpen,
    closeUpdateModal,
    skipAvailableUpdate,
  } = useApp();

  if (!availableUpdate || !updateModalOpen) {
    return null;
  }

  return (
    <Modal
      visible={updateModalOpen}
      transparent
      animationType="fade"
      onRequestClose={closeUpdateModal}>
      <AppUpdateModalContent
        key={availableUpdate.version}
        appVersion={appVersion}
        availableUpdate={availableUpdate}
        onClose={closeUpdateModal}
        onSkip={skipAvailableUpdate}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.58)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  card: {
    padding: 18,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  newBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  versionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  sizePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  notesBox: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 7,
  },
  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  primaryBtn: {
    height: 46,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  githubLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 4,
  },
});
