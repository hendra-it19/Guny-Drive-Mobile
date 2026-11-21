import { ActionPressable } from '@/components/ui/ActionPressable';
import * as BackgroundTask from 'expo-background-task';
import * as Device from 'expo-device';
import * as TaskManager from 'expo-task-manager';
import { useRouter } from 'expo-router';
import {
  Activity,
  ChevronLeft,
  FolderPlus,
  Play,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import {
  BACKGROUND_BACKUP_TASK,
  buildDiagnosticReportMarkdown,
  triggerDebugWorker,
} from '@/lib/backup-engine';
import { formatBytes, formatShortTime } from '@/lib/format';
import { listWorkerRuns, WorkerRunLog } from '@/lib/storage';
import {
  listWatchedFolders,
  pickAndAddWatchedFolder,
  reauthorizeWatchedFolder,
  removeWatchedFolder,
  WatchedFolder,
} from '@/lib/watched-folders';

export default function DiagnosticsScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { refreshQueue } = useApp();

  const [bgStatus, setBgStatus] = useState('Memeriksa…');
  const [registered, setRegistered] = useState(false);
  const [runs, setRuns] = useState<WorkerRunLog[]>([]);
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [runList, folderList] = await Promise.all([
      listWorkerRuns(25),
      listWatchedFolders(),
    ]);
    setRuns(runList);
    setFolders(folderList);

    if (Platform.OS === 'web') {
      setBgStatus('Web (terbatas)');
      setRegistered(false);
      return;
    }

    try {
      const [st, isReg] = await Promise.all([
        BackgroundTask.getStatusAsync(),
        TaskManager.isTaskRegisteredAsync(BACKGROUND_BACKUP_TASK),
      ]);
      setBgStatus(
        st === BackgroundTask.BackgroundTaskStatus.Available ? 'Tersedia' : 'Dibatasi OS',
      );
      setRegistered(isReg);
    } catch {
      setBgStatus('Tidak tersedia');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [runList, folderList] = await Promise.all([
        listWorkerRuns(25),
        listWatchedFolders(),
      ]);
      if (!active) return;
      setRuns(runList);
      setFolders(folderList);

      if (Platform.OS === 'web') {
        setBgStatus('Web (terbatas)');
        setRegistered(false);
        return;
      }

      try {
        const [st, isReg] = await Promise.all([
          BackgroundTask.getStatusAsync(),
          TaskManager.isTaskRegisteredAsync(BACKGROUND_BACKUP_TASK),
        ]);
        if (!active) return;
        setBgStatus(
          st === BackgroundTask.BackgroundTaskStatus.Available ? 'Tersedia' : 'Dibatasi OS',
        );
        setRegistered(isReg);
      } catch {
        if (active) {
          setBgStatus('Tidak tersedia');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleDebugTrigger = async () => {
    setBusy(true);
    try {
      const msg = await triggerDebugWorker(() => {
        void refreshQueue();
      });
      await loadAll();
      Alert.alert('Pemicu Debug (T02)', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleExportReport = async () => {
    const report = await buildDiagnosticReportMarkdown();
    await Share.share({
      title: 'Laporan Uji GunyDrive T02/T10',
      message: report,
    });
  };

  const handleAddWatchedFolder = async () => {
    try {
      const added = await pickAndAddWatchedFolder();
      if (added) {
        await loadAll();
      }
    } catch (err) {
      Alert.alert(
        'Gagal memilih folder',
        err instanceof Error ? err.message : 'Tidak dapat mengakses direktori.',
      );
    }
  };

  const osRuns = runs.filter((r) => r.trigger === 'os_background' || r.trigger === 'app_open');
  const debugRuns = runs.filter((r) => r.trigger === 'debug' || r.trigger === 'manual');

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <ActionPressable
            onPress={() => router.back()}
            style={styles.backRow}
            accessibilityRole="button">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Pengaturan
            </AppText>
          </ActionPressable>

          <AppText weight="extrabold" size={28} style={styles.title}>
            Diagnostik Backup
          </AppText>
          <AppText size={13} color="secondary">
            Observasi worker T02/T10 (memisahkan pemicu debug dari jadwal OS) dan prototipe folder
            berulang T18.
          </AppText>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            STATUS PERANGKAT &amp; WORKER
          </AppText>

          <Surface style={styles.card}>
            <View style={styles.statRow}>
              <AppText size={13} color="secondary">
                Perangkat / OS
              </AppText>
              <AppText weight="bold" size={13}>
                {Device.modelName ?? Platform.OS} · {Device.osName ?? Platform.OS}{' '}
                {Device.osVersion ?? ''}
              </AppText>
            </View>
            <View style={[styles.statRow, { borderTopWidth: 1, borderTopColor: palette.divider }]}>
              <AppText size={13} color="secondary">
                BackgroundTask API
              </AppText>
              <AppText weight="bold" size={13}>
                {bgStatus} · {registered ? 'Terdaftar' : 'Belum terdaftar'}
              </AppText>
            </View>

            <View style={styles.btnRow}>
              <ActionPressable
                disabled={busy}
                onPress={() => void handleDebugTrigger()}
                style={[styles.btnPrimary, { backgroundColor: palette.accent }]}>
                <Play size={15} color={palette.onAccent} strokeWidth={2.2} />
                <AppText weight="bold" size={13} color="onAccent">
                  {busy ? 'Menjalankan…' : 'Picu Debug'}
                </AppText>
              </ActionPressable>

              <ActionPressable
                onPress={() => void handleExportReport()}
                style={[
                  styles.btnGhost,
                  {
                    backgroundColor: palette.field,
                    borderWidth: palette.borderWidth,
                    borderColor: palette.border,
                  },
                ]}>
                <Share2 size={15} color={palette.text} strokeWidth={2} />
                <AppText weight="bold" size={13}>
                  Bagikan Laporan
                </AppText>
              </ActionPressable>
            </View>
          </Surface>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            OBSERVASI PENJADWALAN OS &amp; BUKA APLIKASI ({osRuns.length})
          </AppText>

          <Surface style={styles.card}>
            {osRuns.length === 0 ? (
              <AppText size={12.5} color="secondary">
                Belum ada eksekusi otomatis `os_background` atau `app_open` yang tercatat.
              </AppText>
            ) : (
              osRuns.slice(0, 8).map((r, i) => (
                <View
                  key={r.id}
                  style={[
                    styles.logRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                  ]}>
                  <View style={styles.logTop}>
                    <AppText weight="bold" size={13}>
                      {r.trigger} · {formatShortTime(r.startedAt)}
                    </AppText>
                    <AppText size={12} color="secondary" tabular>
                      +{r.uploadedCount} / sisa {r.pendingCount}
                    </AppText>
                  </View>
                  <AppText size={12} color="secondary" tabular>
                    net={r.networkType} · bat={r.batteryState} · izin={r.permissionStatus} ·
                    checkpoint={formatBytes(r.lastCheckpointOffset)}
                  </AppText>
                  {r.delayReason ? (
                    <AppText size={12} color="warning" style={{ marginTop: 2 }}>
                      Alasan: {r.delayReason}
                    </AppText>
                  ) : null}
                </View>
              ))
            )}
          </Surface>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            PEMICU DEBUG &amp; MANUAL ({debugRuns.length})
          </AppText>

          <Surface style={styles.card}>
            {debugRuns.length === 0 ? (
              <AppText size={12.5} color="secondary">
                Ketuk “Picu Debug” di atas untuk menguji antrean tanpa menunggu jadwal OS.
              </AppText>
            ) : (
              debugRuns.slice(0, 8).map((r, i) => (
                <View
                  key={r.id}
                  style={[
                    styles.logRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                  ]}>
                  <View style={styles.logTop}>
                    <AppText weight="bold" size={13}>
                      {r.trigger} · {formatShortTime(r.startedAt)}
                    </AppText>
                    <AppText size={12} color="secondary" tabular>
                      +{r.uploadedCount} / sisa {r.pendingCount}
                    </AppText>
                  </View>
                  <AppText size={12} color="secondary" tabular>
                    net={r.networkType} · izin={r.permissionStatus} · checkpoint=
                    {formatBytes(r.lastCheckpointOffset)}
                  </AppText>
                </View>
              ))
            )}
          </Surface>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            EKSPERIMEN P1 · FOLDER DOKUMEN BERULANG (T18)
          </AppText>

          <Surface style={styles.card}>
            <View style={styles.logTop}>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={14}>
                  Folder SAF Android / Files iOS
                </AppText>
                <AppText size={12} color="secondary">
                  Jika izin dicabut atau folder dipindah, antrean SQLite tetap terjaga.
                </AppText>
              </View>
              <ActionPressable
                onPress={() => void handleAddWatchedFolder()}
                style={[styles.smallBtn, { backgroundColor: palette.activeBg }]}>
                <FolderPlus size={16} color={palette.activeFg} />
                <AppText weight="bold" size={12.5} color="accent">
                  Pilih
                </AppText>
              </ActionPressable>
            </View>

            {folders.map((folder) => (
              <View
                key={folder.id}
                style={[styles.folderRow, { borderTopColor: palette.divider }]}>
                <Activity size={16} color={folder.status === 'active' ? palette.success : palette.warning} />
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={13.5}>
                    {folder.label}
                  </AppText>
                  <AppText size={12} color={folder.status === 'active' ? 'secondary' : 'warning'}>
                    {folder.lastError ??
                      `Aktif · Terakhir dipindai ${formatShortTime(folder.lastScannedAt)}`}
                  </AppText>
                </View>
                {folder.status !== 'active' ? (
                  <ActionPressable
                    onPress={async () => {
                      await reauthorizeWatchedFolder(folder.id);
                      await loadAll();
                    }}>
                    <RefreshCw size={16} color={palette.accent} />
                  </ActionPressable>
                ) : null}
                <ActionPressable
                  onPress={async () => {
                    await removeWatchedFolder(folder.id);
                    await loadAll();
                  }}>
                  <Trash2 size={16} color={palette.danger} />
                </ActionPressable>
              </View>
            ))}
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingHorizontal: Spacing.screen, paddingBottom: 40 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 44,
    marginLeft: -6,
  },
  title: { letterSpacing: -0.8, marginTop: 2, marginBottom: 4 },
  groupLabel: {
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { padding: 14 },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  btnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
  logRow: { paddingVertical: 10 },
  logTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  smallBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});
