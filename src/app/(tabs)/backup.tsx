import { ActionPressable } from '@/components/ui/ActionPressable';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Activity,
  ArrowUpCircle,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  CloudUpload,
  FileText,
  Film,
  Fingerprint,
  FolderPlus,
  Headphones,
  Image as ImageIcon,
  ListChecks,
  Lock,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Surface } from '@/components/ui/Surface';
import { Toggle } from '@/components/ui/Toggle';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { BackupFrequency } from '@/lib/backup-engine';
import { requestDeviceDirectoryPermission } from '@/lib/device-files';
import { formatBytes, formatShortTime } from '@/lib/format';
import { removeQueueItem } from '@/lib/storage';
import { listWatchedFolders, WatchedFolder } from '@/lib/watched-folders';

const FREQ_LABELS: Record<BackupFrequency, string> = {
  on_open: 'Saat dibuka',
  every_6h: 'Setiap 6 jam',
  daily: 'Harian · 00:00 (12 malam)',
};

export default function PengaturanScreen() {
  const router = useRouter();
  const { palette, summaryText } = useAppTheme();
  const {
    appVersion,
    availableUpdate,
    checkingUpdate,
    updateCheckError,
    credentials,
    me,
    usage,
    backupRules,
    queue,
    passkeyInfo,
    notificationPrefs,
    updateBackupRules,
    triggerBackupNow,
    refreshQueue,
    activatePasskeyBiometric,
    deactivatePasskeyBiometric,
    updateNotificationPrefs,
    disconnectServer,
    checkForAppUpdate,
    openUpdateModal,
  } = useApp();

  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);

  const loadWatched = useCallback(async () => {
    const folders = await listWatchedFolders().catch(() => []);
    setWatchedFolders(folders);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWatched();
    }, [loadWatched]),
  );

  const isPasskeyActive = Boolean(passkeyInfo || me?.owner.passkey_enabled);
  const initial = (me?.owner.name?.trim().charAt(0) || 'G').toUpperCase();
  const avatarUrl = me?.owner.avatar_url;

  const usedBytes = usage?.used_bytes ?? me?.usage.used_bytes ?? 0;
  const quotaBytes = usage?.quota_bytes ?? me?.usage.quota_bytes ?? 107_374_182_400;
  const usagePct =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  const pendingItems = queue.filter((i) => i.status === 'pending' || i.status === 'uploading');
  const completedItems = queue.filter((i) => i.status === 'completed');
  const activeItem = queue.find((i) => i.status === 'uploading') ?? pendingItems[0];
  const totalInBatch = pendingItems.length + completedItems.length;

  const progressPct =
    totalInBatch > 0
      ? Math.round((completedItems.length / totalInBatch) * 100)
      : backupRules.lastSuccessAt
        ? 100
        : 0;

  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progressPct / 100);

  const anyCategoryEnabled = (next: {
    includePhotos: boolean;
    includeVideos: boolean;
    includeDocuments: boolean;
    includeAudio: boolean;
  }) =>
    next.includePhotos ||
    next.includeVideos ||
    next.includeDocuments ||
    next.includeAudio ||
    backupRules.includeInbox;

  const toggleBackupCategory = async (
    key: 'includePhotos' | 'includeVideos' | 'includeDocuments' | 'includeAudio',
    enabled: boolean,
  ) => {
    const nextFlags = {
      includePhotos: key === 'includePhotos' ? enabled : backupRules.includePhotos,
      includeVideos: key === 'includeVideos' ? enabled : backupRules.includeVideos,
      includeDocuments: key === 'includeDocuments' ? enabled : backupRules.includeDocuments,
      includeAudio: key === 'includeAudio' ? enabled : backupRules.includeAudio,
    };
    const includeGallery = nextFlags.includePhotos || nextFlags.includeVideos;
    const galleryKind: 'all' | 'photo' | 'video' =
      nextFlags.includePhotos && nextFlags.includeVideos
        ? 'all'
        : nextFlags.includeVideos
          ? 'video'
          : 'photo';
    await updateBackupRules({
      ...nextFlags,
      includeGallery,
      galleryKind,
      // Do not turn auto-backup ON unexpectedly if the user keeps master auto-backup OFF
      ...(anyCategoryEnabled(nextFlags) ? {} : { enabled: false, autoBackupOnNewFile: false }),
    });
  };

  const cycleFrequency = () => {
    const order: BackupFrequency[] = ['daily', 'every_6h', 'on_open'];
    const next = order[(order.indexOf(backupRules.frequency) + 1) % order.length];
    void updateBackupRules({ frequency: next });
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await triggerBackupNow();
    } finally {
      setRunning(false);
    }
  };

  const handleAddWatchedFolder = async () => {
    if (Platform.OS === 'web') return;
    try {
      const folder = await requestDeviceDirectoryPermission();
      if (folder) {
        await loadWatched();
        Alert.alert(
          'Folder Pantauan Ditambahkan',
          `Folder "${folder.label}" kini akan ikut dianalisis untuk backup otomatis sesuai jenis berkas yang aktif.`,
        );
      }
    } catch (err) {
      Alert.alert(
        'Gagal Memilih Folder',
        err instanceof Error ? err.message : 'Pemilihan folder dibatalkan.',
      );
    }
  };

  const handleTogglePasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyMessage(null);
    try {
      if (isPasskeyActive) {
        await deactivatePasskeyBiometric();
        setPasskeyMessage('Passkey biometrik dinonaktifkan di perangkat ini.');
      } else {
        await activatePasskeyBiometric();
        setPasskeyMessage('Passkey biometrik aktif! Login cepat dengan sidik jari/wajah siap digunakan.');
      }
    } catch (err) {
      Alert.alert(
        'Passkey Biometrik',
        err instanceof Error ? err.message : 'Gagal memproses Passkey.',
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Keluar dari Akun GunyDrive?',
      'Sesi perangkat akan ditutup dari ponsel ini. Berkas yang sudah dicadangkan di server tetap aman.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Keluar',
          style: 'destructive',
          onPress: () => {
            void disconnectServer();
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
            title="Pengaturan"
            subtitle={me?.device?.name ?? 'Akun & Backup'}
          />

          <View style={styles.section}>
            {/* ============================================================
             * 1. AKUN & PENYIMPANAN
             * ============================================================ */}
            <Surface solid style={styles.profileCard}>
              <View style={styles.profileTop}>
                <View
                  style={[
                    styles.profileAvatarWrap,
                    { backgroundColor: palette.activeBg, borderColor: palette.border },
                  ]}>
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={styles.profileAvatarImg}
                      contentFit="cover"
                    />
                  ) : (
                    <AppText weight="extrabold" size={22} color="accent">
                      {initial}
                    </AppText>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="extrabold" size={17} numberOfLines={1}>
                    {me?.owner.name ?? 'Pengguna GunyDrive'}
                  </AppText>
                  {me?.owner.username ? (
                    <AppText weight="semibold" size={12.5} color="accent" numberOfLines={1}>
                      @{me.owner.username}
                    </AppText>
                  ) : null}
                  <AppText size={12} color="secondary" numberOfLines={1}>
                    {me?.owner.email ?? 'Akun Pribadi'}
                  </AppText>
                </View>
              </View>

              <View style={styles.quotaSection}>
                <View style={styles.quotaHeader}>
                  <AppText weight="semibold" size={12} color="secondary">
                    Penyimpanan Cloud
                  </AppText>
                  <AppText weight="bold" size={12} tabular>
                    {formatBytes(usedBytes)} / {formatBytes(quotaBytes)} ({usagePct}%)
                  </AppText>
                </View>
                <View style={[styles.quotaTrack, { backgroundColor: palette.track }]}>
                  <View
                    style={[
                      styles.quotaFill,
                      {
                        width: `${Math.max(3, usagePct)}%`,
                        backgroundColor: palette.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            </Surface>

            {/* ============================================================
             * 2. RINGKASAN & KONTROL BACKUP (1 KONTROL TERPADU, TANPA DUPLIKAT)
             * ============================================================ */}
            <AppText weight="bold" size={11.5} color="secondary" style={styles.groupLabel}>
              BACKUP &amp; SINKRONISASI
            </AppText>

            <Surface style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View style={styles.ringBox}>
                  <Svg width={72} height={72} viewBox="0 0 76 76">
                    <Circle
                      cx={38}
                      cy={38}
                      r={radius}
                      fill="none"
                      stroke={palette.track}
                      strokeWidth={7}
                    />
                    <Circle
                      cx={38}
                      cy={38}
                      r={radius}
                      fill="none"
                      stroke={palette.accent}
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      transform="rotate(-90 38 38)"
                    />
                  </Svg>
                  <View style={styles.ringText}>
                    <AppText weight="extrabold" size={15} tabular>
                      {progressPct}%
                    </AppText>
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15.5}>
                    {pendingItems.length > 0
                      ? `Mengunggah ${completedItems.length + 1} dari ${totalInBatch}`
                      : backupRules.enabled && !backupRules.paused
                        ? 'Auto Backup Aktif'
                        : 'Mode Manual (Auto Backup Mati)'}
                  </AppText>
                  <AppText size={12} color="secondary" numberOfLines={2} style={{ marginTop: 2 }}>
                    {activeItem
                      ? `${activeItem.filename} · ${formatBytes(activeItem.sizeBytes)}`
                      : backupRules.enabled && !backupRules.paused
                        ? backupRules.autoBackupOnNewFile
                          ? 'Otomatis unggah berkas baru + jadwal 00:00'
                          : `Jadwal: ${FREQ_LABELS[backupRules.frequency]}`
                        : `Terakhir berhasil: ${formatShortTime(backupRules.lastSuccessAt)}`}
                  </AppText>
                </View>

                <Toggle
                  value={backupRules.enabled && !backupRules.paused}
                  onValueChange={(v) =>
                    void updateBackupRules({
                      enabled: v,
                      paused: false,
                      ...(v ? {} : { autoBackupOnNewFile: false }),
                    })
                  }
                  accessibilityLabel="Aktifkan atau matikan backup otomatis"
                />
              </View>

              <View style={styles.heroBtns}>
                <ActionPressable
                  onPress={() => void handleRunNow()}
                  disabled={running}
                  style={[styles.btnPrimary, { backgroundColor: palette.accent }]}
                  accessibilityRole="button">
                  <RefreshCw size={15} color={palette.onAccent} strokeWidth={2.2} />
                  <AppText weight="bold" size={13} color="onAccent">
                    {running ? 'Mengunggah…' : 'Backup Sekarang'}
                  </AppText>
                </ActionPressable>

                <ActionPressable
                  onPress={() => setQueueModalOpen(true)}
                  style={[
                    styles.btnGhost,
                    {
                      backgroundColor: palette.field,
                      borderWidth: palette.borderWidth,
                      borderColor: palette.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Lihat antrean (${pendingItems.length})`}>
                  <ListChecks size={15} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="bold" size={13}>
                    Antrean ({pendingItems.length})
                  </AppText>
                </ActionPressable>
              </View>
            </Surface>

            {/* ============================================================
             * 3. JENIS BERKAS YANG DI-BACKUP (FOTO, VIDEO, DOKUMEN, AUDIO)
             * ============================================================ */}
            <AppText weight="bold" size={11.5} color="secondary" style={styles.groupLabel}>
              JENIS BERKAS AUTO-BACKUP
            </AppText>

            <Surface style={styles.rulesCard}>
              <View style={styles.ruleRow}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <ImageIcon size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Backup Foto
                  </AppText>
                  <AppText size={12} color="secondary">
                    JPG, PNG, HEIC, WebP dari galeri &amp; folder HP
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.includePhotos}
                  onValueChange={(v) => void toggleBackupCategory('includePhotos', v)}
                  accessibilityLabel="Aktifkan backup foto"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Film size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Backup Video
                  </AppText>
                  <AppText size={12} color="secondary">
                    MP4, MOV, MKV dari kamera &amp; unduhan perangkat
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.includeVideos}
                  onValueChange={(v) => void toggleBackupCategory('includeVideos', v)}
                  accessibilityLabel="Aktifkan backup video"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <FileText size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Backup Dokumen
                  </AppText>
                  <AppText size={12} color="secondary">
                    PDF, Word, Excel, PPT, TXT, CSV, ZIP &amp; arsip
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.includeDocuments}
                  onValueChange={(v) => void toggleBackupCategory('includeDocuments', v)}
                  accessibilityLabel="Aktifkan backup dokumen"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Headphones size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Backup Audio
                  </AppText>
                  <AppText size={12} color="secondary">
                    MP3, WAV, M4A, FLAC, musik &amp; rekaman suara
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.includeAudio}
                  onValueChange={(v) => void toggleBackupCategory('includeAudio', v)}
                  accessibilityLabel="Aktifkan backup audio"
                />
              </View>
            </Surface>

            {/* ============================================================
             * 4. ATURAN JADWAL & FOLDER PANTAUAN
             * ============================================================ */}
            <AppText weight="bold" size={11.5} color="secondary" style={styles.groupLabel}>
              ATURAN &amp; FOLDER PANTAUAN
            </AppText>

            <Surface style={styles.rulesCard}>
              <View style={styles.ruleRow}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Zap size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Backup Otomatis Berkas Baru
                  </AppText>
                  <AppText size={12} color="secondary">
                    Mode Google Foto · Otomatis unggah saat ada berkas baru tanpa scan ulang HP
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.autoBackupOnNewFile}
                  onValueChange={(v) =>
                    void updateBackupRules({
                      autoBackupOnNewFile: v,
                      ...(v ? { enabled: true, paused: false } : {}),
                    })
                  }
                  accessibilityLabel="Aktifkan backup otomatis setiap ada berkas baru"
                />
              </View>

              <ActionPressable
                onPress={cycleFrequency}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Clock size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Jadwal Latar Belakang
                  </AppText>
                  <AppText size={12} color="secondary">
                    {backupRules.frequency === 'daily'
                      ? 'Berjalan di latar belakang setiap jam 12 malam (00:00)'
                      : 'Jadwal pemeriksaan otomatis di latar belakang'}
                  </AppText>
                </View>
                <AppText weight="semibold" size={12.5} color="accent">
                  {FREQ_LABELS[backupRules.frequency]}
                </AppText>
                <ChevronRight size={17} color={palette.textSecondary} />
              </ActionPressable>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Wifi size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Hanya Wi-Fi
                  </AppText>
                  <AppText size={12} color="secondary">
                    Tunda unggahan saat memakai data seluler
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.wifiOnly}
                  onValueChange={(v) => void updateBackupRules({ wifiOnly: v })}
                  accessibilityLabel="Hanya backup lewat Wi-Fi"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Zap size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Saat Mengisi Daya
                  </AppText>
                  <AppText size={12} color="secondary">
                    Jalankan hanya ketika baterai terhubung daya
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.chargingOnly}
                  onValueChange={(v) => void updateBackupRules({ chargingOnly: v })}
                  accessibilityLabel="Backup hanya saat mengisi daya"
                />
              </View>

              <ActionPressable
                onPress={() => void handleAddWatchedFolder()}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <FolderPlus size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Folder tambahan (opsional)
                  </AppText>
                  <AppText size={12} color="secondary">
                    {watchedFolders.length > 0
                      ? `${watchedFolders.length} folder terhubung (${watchedFolders.map((f) => f.label).slice(0, 2).join(', ')})`
                      : 'Berkas yang dapat diakses perangkat terdeteksi otomatis.'}
                  </AppText>
                </View>
                <AppText weight="bold" size={12.5} color="accent">
                  + Tambah
                </AppText>
              </ActionPressable>
            </Surface>

            {/* ============================================================
             * 5. KEAMANAN & AKUN
             * ============================================================ */}
            <AppText weight="bold" size={11.5} color="secondary" style={styles.groupLabel}>
              KEAMANAN &amp; NOTIFIKASI
            </AppText>

            <Surface style={styles.rulesCard}>
              <View style={styles.ruleRow}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Fingerprint size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Passkey Biometrik
                  </AppText>
                  <AppText size={12} color="secondary">
                    {isPasskeyActive ? 'Aktif · Login dengan sidik jari/wajah' : 'Belum diaktifkan'}
                  </AppText>
                </View>
                <ActionPressable
                  disabled={passkeyBusy}
                  onPress={() => void handleTogglePasskey()}
                  style={[
                    styles.smallPillBtn,
                    {
                      backgroundColor: isPasskeyActive ? palette.background : palette.accent,
                      borderColor: isPasskeyActive ? palette.border : palette.accent,
                    },
                  ]}>
                  {passkeyBusy ? (
                    <ActivityIndicator
                      size="small"
                      color={isPasskeyActive ? palette.text : palette.onAccent}
                    />
                  ) : (
                    <AppText
                      weight="bold"
                      size={12}
                      color={isPasskeyActive ? 'primary' : 'onAccent'}>
                      {isPasskeyActive ? 'Matikan' : 'Aktifkan'}
                    </AppText>
                  )}
                </ActionPressable>
              </View>

              {passkeyMessage ? (
                <View style={[styles.feedbackRow, { borderTopColor: palette.divider }]}>
                  <CheckCircle2 size={14} color={palette.success} />
                  <AppText size={12} color="success" weight="semibold" style={{ flex: 1 }}>
                    {passkeyMessage}
                  </AppText>
                </View>
              ) : null}

              <ActionPressable
                onPress={() => router.push('/(tabs)/privat')}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Lock size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    PIN Folder Privat
                  </AppText>
                  <AppText size={12} color="secondary">
                    {me?.vault_configured ? 'Aktif & dilindungi PIN' : 'Belum diatur'}
                  </AppText>
                </View>
                <ChevronRight size={17} color={palette.textSecondary} />
              </ActionPressable>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <CloudUpload size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Notifikasi Backup
                  </AppText>
                  <AppText size={12} color="secondary">
                    Monitoring antrean &amp; verifikasi SHA-256
                  </AppText>
                </View>
                <Toggle
                  value={notificationPrefs.backupMonitoring}
                  onValueChange={(v) => void updateNotificationPrefs({ backupMonitoring: v })}
                  accessibilityLabel="Notifikasi Backup"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Bell size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Peringatan Kuota
                  </AppText>
                  <AppText size={12} color="secondary">
                    Info pemakaian kapasitas penyimpanan
                  </AppText>
                </View>
                <Toggle
                  value={notificationPrefs.quotaAlerts}
                  onValueChange={(v) => void updateNotificationPrefs({ quotaAlerts: v })}
                  accessibilityLabel="Peringatan Kuota"
                />
              </View>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <ShieldCheck size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Notifikasi Keamanan
                  </AppText>
                  <AppText size={12} color="secondary">
                    Status Passkey &amp; sesi perangkat
                  </AppText>
                </View>
                <Toggle
                  value={notificationPrefs.securityAlerts}
                  onValueChange={(v) => void updateNotificationPrefs({ securityAlerts: v })}
                  accessibilityLabel="Notifikasi Keamanan"
                />
              </View>
            </Surface>

            {/* ============================================================
             * 6. TAMPILAN & UTILITAS
             * ============================================================ */}
            <AppText weight="bold" size={11.5} color="secondary" style={styles.groupLabel}>
              TAMPILAN &amp; PENYIMPANAN
            </AppText>

            <Surface style={styles.rulesCard}>
              <ActionPressable
                onPress={() => router.push('/settings/appearance')}
                style={styles.ruleRow}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Palette size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Tema &amp; Tampilan
                  </AppText>
                  <AppText size={12} color="secondary">
                    {summaryText}
                  </AppText>
                </View>
                <ChevronRight size={17} color={palette.textSecondary} />
              </ActionPressable>

              <ActionPressable
                onPress={() => router.push('/trash')}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Trash2 size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Sampah Penyimpanan
                  </AppText>
                  <AppText size={12} color="secondary">
                    Pulihkan atau hapus permanen (retensi 30 hari)
                  </AppText>
                </View>
                <ChevronRight size={17} color={palette.textSecondary} />
              </ActionPressable>

              <ActionPressable
                onPress={() => router.push('/settings/diagnostics')}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Activity size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Log &amp; Diagnostik Backup
                  </AppText>
                  <AppText size={12} color="secondary">
                    Riwayat worker background &amp; kelola folder pantauan
                  </AppText>
                </View>
                <ChevronRight size={17} color={palette.textSecondary} />
              </ActionPressable>

              <ActionPressable
                disabled={checkingUpdate}
                onPress={async () => {
                  if (availableUpdate) {
                    openUpdateModal();
                    return;
                  }
                  setUpdateNotice(null);
                  const found = await checkForAppUpdate(true);
                  if (!found) {
                    setUpdateNotice(`GunyDrive v${appVersion} sudah merupakan versi terbaru.`);
                  }
                }}
                style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}
                accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <ArrowUpCircle size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14.5}>
                    Pembaruan Aplikasi (GitHub)
                  </AppText>
                  <AppText size={12} color="secondary">
                    {availableUpdate
                      ? `Tersedia v${availableUpdate.version} · Ketuk untuk unduh & pasang`
                      : `Versi terpasang v${appVersion} · Cek rilis terbaru otomatis`}
                  </AppText>
                </View>
                {checkingUpdate ? (
                  <ActivityIndicator size="small" color={palette.accent} />
                ) : availableUpdate ? (
                  <View
                    style={[
                      styles.smallPillBtn,
                      { backgroundColor: palette.accent, borderColor: palette.accent },
                    ]}>
                    <AppText weight="bold" size={11.5} color="onAccent">
                      v{availableUpdate.version}
                    </AppText>
                  </View>
                ) : (
                  <AppText weight="bold" size={12} color="accent">
                    Periksa
                  </AppText>
                )}
              </ActionPressable>

              {updateNotice && !availableUpdate ? (
                <View style={[styles.feedbackRow, { borderTopColor: palette.divider }]}>
                  <CheckCircle2 size={14} color={palette.success} />
                  <AppText size={12} color="success" weight="semibold" style={{ flex: 1 }}>
                    {updateNotice}
                  </AppText>
                </View>
              ) : null}

              {updateCheckError ? (
                <View style={[styles.feedbackRow, { borderTopColor: palette.divider }]}>
                  <AppText size={12} color="danger" weight="semibold" style={{ flex: 1 }}>
                    {updateCheckError}
                  </AppText>
                </View>
              ) : null}
            </Surface>

            {/* ============================================================
             * 7. TOMBOL LOGOUT PALING BAWAH
             * ============================================================ */}
            {credentials ? (
              <View style={{ marginTop: 20 }}>
                <Surface solid>
                  <ActionPressable
                    onPress={handleLogout}
                    style={styles.ruleRow}
                    accessibilityRole="button"
                    accessibilityLabel="Keluar dari Akun">
                    <View style={[styles.ruleIcon, { backgroundColor: `${palette.danger}1C` }]}>
                      <LogOut size={18} color={palette.danger} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText weight="bold" size={15} color="danger">
                        Keluar (Logout)
                      </AppText>
                      <AppText size={12} color="secondary">
                        Akhiri sesi akun GunyDrive pada perangkat ini
                      </AppText>
                    </View>
                  </ActionPressable>
                </Surface>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* Queue inspection modal */}
        <Modal
          visible={queueModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setQueueModalOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Surface solid style={styles.queueSheet}>
              <View style={styles.queueHeader}>
                <AppText weight="bold" size={17}>
                  Antrean Backup ({queue.length})
                </AppText>
                <ActionPressable onPress={() => setQueueModalOpen(false)}>
                  <AppText weight="bold" size={14} color="accent">
                    Tutup
                  </AppText>
                </ActionPressable>
              </View>

              <ScrollView style={{ maxHeight: 420 }}>
                {queue.length === 0 ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center', gap: 6 }}>
                    <Check size={22} color={palette.success} />
                    <AppText size={13} color="secondary" style={{ textAlign: 'center' }}>
                      Antrean kosong. Semua berkas yang aktif sudah tercadang.
                    </AppText>
                  </View>
                ) : (
                  queue.map((item, idx) => (
                    <View
                      key={item.id}
                      style={[
                        styles.queueRow,
                        idx > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                      ]}>
                      <View style={{ flex: 1 }}>
                        <AppText weight="bold" size={14} numberOfLines={1}>
                          {item.filename}
                        </AppText>
                        <AppText size={12} color="secondary" tabular>
                          {formatBytes(item.uploadedOffset)} / {formatBytes(item.sizeBytes)} ·{' '}
                          {item.status === 'completed'
                            ? 'Selesai'
                            : item.status === 'failed'
                              ? `Gagal: ${item.errorMessage ?? 'Coba lagi'}`
                              : item.status === 'uploading'
                                ? 'Mengunggah'
                                : 'Menunggu'}
                        </AppText>
                      </View>
                      {item.status !== 'completed' ? (
                        <ActionPressable
                          onPress={async () => {
                            await removeQueueItem(item.id);
                            await refreshQueue();
                          }}>
                          <AppText weight="semibold" size={12} color="danger">
                            Batal
                          </AppText>
                        </ActionPressable>
                      ) : null}
                    </View>
                  ))
                )}
              </ScrollView>
            </Surface>
          </View>
        </Modal>
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingBottom: 150 },
  section: { paddingHorizontal: Spacing.screen },
  profileCard: {
    padding: 15,
    gap: 12,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  profileAvatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImg: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  quotaSection: { gap: 5 },
  quotaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quotaTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  quotaFill: {
    height: '100%',
    borderRadius: 999,
  },
  heroCard: { padding: 15 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ringBox: { width: 76, height: 76, position: 'relative' },
  ringText: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  btnPrimary: {
    flex: 1.5,
    height: 42,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnGhost: {
    flex: 1,
    height: 42,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnIconOnly: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: {
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  rulesCard: { paddingVertical: 2 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 56,
  },
  ruleIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallPillBtn: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  queueSheet: { padding: 18 },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
});
