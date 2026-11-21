import { Segmented } from '@/components/ui/Segmented';
import * as MediaLibrary from 'expo-media-library';
import {
  Check,
  ChevronRight,
  Clock,
  FolderInput,
  Image as ImageIcon,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  Wifi,
  Zap,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
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
import { BackupFrequency, importDocumentToInbox } from '@/lib/backup-engine';
import { formatBytes, formatShortTime } from '@/lib/format';
import { removeQueueItem } from '@/lib/storage';

const FREQ_LABELS: Record<BackupFrequency, string> = {
  on_open: 'Saat dibuka',
  every_6h: 'Setiap 6 jam',
  daily: 'Harian',
};

export default function BackupScreen() {
  const { palette } = useAppTheme();
  const { me, backupRules, queue, updateBackupRules, triggerBackupNow, refreshQueue } = useApp();

  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [running, setRunning] = useState(false);

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

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progressPct / 100);

  const cycleFrequency = () => {
    const order: BackupFrequency[] = ['daily', 'every_6h', 'on_open'];
    const next = order[(order.indexOf(backupRules.frequency) + 1) % order.length];
    void updateBackupRules({ frequency: next });
  };

  const toggleGallerySource = async (enabled: boolean) => {
    if (enabled && Platform.OS !== 'web') {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Izin galeri diperlukan',
          'Berikan akses foto/video di pengaturan perangkat agar GunyDrive dapat mencadangkan galeri.',
        );
        return;
      }
    }
    await updateBackupRules({ includeGallery: enabled, enabled: enabled || backupRules.includeInbox });
  };

  const handleImportInbox = async () => {
    try {
      const item = await importDocumentToInbox();
      if (item) {
        await refreshQueue();
        Alert.alert(
          'Masuk Kotak Masuk',
          `"${item.filename}" (${formatBytes(item.sizeBytes)}) disalin ke penyimpanan aplikasi dan siap dicadangkan.`,
        );
      }
    } catch (err) {
      Alert.alert('Gagal mengimpor', err instanceof Error ? err.message : 'Ruang perangkat penuh atau dibatalkan.');
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await updateBackupRules({ enabled: true, paused: false });
      await triggerBackupNow();
    } finally {
      setRunning(false);
    }
  };

  const deviceLabel = me?.device?.name ?? 'Perangkat ini';

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <ScreenHeader title="Backup" subtitle={deviceLabel} />

          <View style={styles.section}>
            <Surface style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View style={styles.ringBox}>
                  <Svg width={84} height={84} viewBox="0 0 84 84">
                    <Circle
                      cx={42}
                      cy={42}
                      r={radius}
                      fill="none"
                      stroke={palette.track}
                      strokeWidth={8}
                    />
                    <Circle
                      cx={42}
                      cy={42}
                      r={radius}
                      fill="none"
                      stroke={palette.accent}
                      strokeWidth={8}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      transform="rotate(-90 42 42)"
                    />
                  </Svg>
                  <View style={styles.ringText}>
                    <AppText weight="extrabold" size={18} tabular>
                      {progressPct}%
                    </AppText>
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={16}>
                    {backupRules.paused
                      ? 'Backup dijeda'
                      : pendingItems.length > 0
                        ? `Mengunggah ${completedItems.length + 1} dari ${totalInBatch}`
                        : backupRules.enabled
                          ? 'Semua berkas aman'
                          : 'Backup otomatis nonaktif'}
                  </AppText>
                  <AppText size={12.5} color="secondary" numberOfLines={1} style={{ marginTop: 3 }}>
                    {activeItem
                      ? `${activeItem.filename} · ${formatBytes(activeItem.sizeBytes)}`
                      : backupRules.lastDelayReason ?? 'Jadwal mengikuti kesempatan latar OS'}
                  </AppText>
                  <AppText size={12} color="secondary" style={{ marginTop: 2 }}>
                    {pendingItems.length} tersisa dalam antrean lokal
                  </AppText>
                </View>
              </View>

              <View style={styles.heroBtns}>
                <Pressable
                  onPress={() => void updateBackupRules({ paused: !backupRules.paused })}
                  style={[
                    styles.btnGhost,
                    {
                      backgroundColor: palette.field,
                      borderWidth: palette.borderWidth,
                      borderColor: palette.border,
                    },
                  ]}
                  accessibilityRole="button">
                  {backupRules.paused ? (
                    <Play size={16} color={palette.text} strokeWidth={2.2} />
                  ) : (
                    <Pause size={16} color={palette.text} strokeWidth={2.2} />
                  )}
                  <AppText weight="bold" size={14}>
                    {backupRules.paused ? 'Lanjut' : 'Jeda'}
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => setQueueModalOpen(true)}
                  style={[styles.btnPrimary, { backgroundColor: palette.accent }]}
                  accessibilityRole="button">
                  <ListChecks size={17} color={palette.onAccent} strokeWidth={2.2} />
                  <AppText weight="bold" size={14} color="onAccent">
                    Lihat antrean ({queue.length})
                  </AppText>
                </Pressable>
              </View>

              <View style={[styles.lastOkRow, { borderTopColor: palette.divider }]}>
                <View style={styles.okLeft}>
                  <Check size={14} color={palette.success} strokeWidth={2.6} />
                  <AppText weight="semibold" size={12.5} color="success">
                    Terakhir berhasil
                  </AppText>
                </View>
                <AppText weight="semibold" size={12.5} color="secondary" tabular>
                  {formatShortTime(backupRules.lastSuccessAt)}
                </AppText>
              </View>
            </Surface>

            <View style={styles.quickRow}>
              <Pressable
                onPress={() => void handleRunNow()}
                disabled={running}
                style={{ flex: 1 }}
                accessibilityRole="button">
                <Surface pill style={styles.quickBtn}>
                  <RefreshCw size={16} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="bold" size={13} color="accent">
                    {running ? 'Memeriksa…' : 'Backup sekarang'}
                  </AppText>
                </Surface>
              </Pressable>

              <Pressable
                onPress={() => void handleImportInbox()}
                style={{ flex: 1 }}
                accessibilityRole="button">
                <Surface pill style={styles.quickBtn}>
                  <FolderInput size={16} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="bold" size={13} color="accent">
                    Impor Kotak Masuk
                  </AppText>
                </Surface>
              </Pressable>
            </View>

            <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
              ATURAN
            </AppText>

            <Surface style={styles.rulesCard}>
              <Pressable onPress={cycleFrequency} style={styles.ruleRow} accessibilityRole="button">
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Clock size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
                    Frekuensi
                  </AppText>
                  <AppText size={12} color="secondary">
                    Preferensi jadwal pemeriksaan latar
                  </AppText>
                </View>
                <AppText weight="semibold" size={13} color="secondary">
                  {FREQ_LABELS[backupRules.frequency]}
                </AppText>
                <ChevronRight size={18} color={palette.textSecondary} />
              </Pressable>

              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <ImageIcon size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
                    Sumber Galeri
                  </AppText>
                  <AppText size={12} color="secondary">
                    Foto &amp; video yang diizinkan OS
                  </AppText>
                </View>
                <Toggle
                  value={backupRules.includeGallery}
                  onValueChange={(v) => void toggleGallerySource(v)}
                  accessibilityLabel="Aktifkan backup galeri"
                />
              </View>

              {backupRules.includeGallery && (
                <Segmented options={[{value: 'all', label: 'Semua'}, {value: 'photo', label: 'Foto'}, {value: 'video', label: 'Video'}] as const}
                  value={backupRules.galleryKind} onChange={(galleryKind) => void updateBackupRules({ galleryKind })} />
              )}
              <View style={styles.ruleRow}>
                <View style={{ flex: 1 }}><AppText weight="bold" size={15}>Sumber Kotak Masuk</AppText></View>
                <Toggle value={backupRules.includeInbox} accessibilityLabel="Aktifkan backup Kotak Masuk"
                  onValueChange={(includeInbox) => void updateBackupRules({ includeInbox, enabled: includeInbox || backupRules.includeGallery })} />
              </View>
              <View style={[styles.ruleRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
                <View style={[styles.ruleIcon, { backgroundColor: palette.activeBg }]}>
                  <Wifi size={18} color={palette.activeFg} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15}>
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
                  <AppText weight="bold" size={15}>
                    Saat mengisi daya
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
            </Surface>
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
                <Pressable onPress={() => setQueueModalOpen(false)}>
                  <AppText weight="bold" size={14} color="accent">
                    Tutup
                  </AppText>
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 420 }}>
                {queue.length === 0 ? (
                  <AppText size={13} color="secondary" style={{ paddingVertical: 24, textAlign: 'center' }}>
                    Antrean kosong. Impor dokumen ke Kotak Masuk atau aktifkan Galeri.
                  </AppText>
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
                          {item.sourceType === 'inbox' ? 'Kotak Masuk' : 'Galeri'} ·{' '}
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
                        <Pressable
                          onPress={async () => {
                            await removeQueueItem(item.id);
                            await refreshQueue();
                          }}>
                          <AppText weight="semibold" size={12} color="danger">
                            Batal
                          </AppText>
                        </Pressable>
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
  scrollPad: { paddingBottom: 145 },
  section: { paddingHorizontal: Spacing.screen },
  heroCard: { padding: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringBox: { width: 84, height: 84, position: 'relative' },
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
    gap: 10,
    marginTop: 14,
  },
  btnGhost: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnPrimary: {
    flex: 1.4,
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lastOkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  okLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickBtn: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
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
    paddingVertical: 12,
    minHeight: 58,
  },
  ruleIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
