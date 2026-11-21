import { ActionPressable } from '@/components/ui/ActionPressable';
import { useRouter } from 'expo-router';
import { AlertCircle, AlertTriangle, CloudUpload, RefreshCw, WifiOff } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import {
  getCurrentScanState,
  isExpoGoEnvironment,
  type ScanProgress,
  subscribeScanProgress,
} from '@/lib/device-files';

import { AppText } from './AppText';
import { Surface } from './Surface';

function useGlobalScanState(): ScanProgress {
  const [scanState, setScanState] = useState<ScanProgress>(() => getCurrentScanState());
  useEffect(() => subscribeScanProgress(setScanState), []);
  return scanState;
}

export function useStatusPillActive(): boolean {
  const { authRevoked, backupRules, queue } = useApp();
  const scanState = useGlobalScanState();
  const uploading = queue.some((i) => i.status === 'uploading');
  const failed = queue.some((i) => i.status === 'failed');
  const ignoreExpoGoPermDelay =
    backupRules.lastDelayAction === 'permissions' &&
    (!backupRules.enabled || (Platform.OS === 'android' && isExpoGoEnvironment()));
  const hasDelay = Boolean(backupRules.lastDelayReason) && !ignoreExpoGoPermDelay;
  return authRevoked || uploading || scanState.active || hasDelay || failed;
}

export function StatusPillBar() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { authRevoked, backupRules, queue, triggerBackupNow } = useApp();
  const scanState = useGlobalScanState();

  const uploading = queue.filter((i) => i.status === 'uploading');
  const pending = queue.filter((i) => i.status === 'pending' || i.status === 'uploading');
  const failed = queue.filter((i) => i.status === 'failed');

  const ignoreExpoGoPermDelay =
    backupRules.lastDelayAction === 'permissions' &&
    (!backupRules.enabled || (Platform.OS === 'android' && isExpoGoEnvironment()));

  let message: string | null = null;
  let actionLabel = 'Lihat antrean';
  let kind: 'info' | 'scan' | 'warn' | 'danger' = 'info';
  let onPress = () => router.push('/(tabs)/backup');

  if (authRevoked) {
    message = 'Akses perangkat dicabut';
    actionLabel = 'Hubungkan ulang';
    kind = 'danger';
    onPress = () => router.push('/settings/connect');
  } else if (uploading.length > 0) {
    const doneCount = queue.filter((i) => i.status === 'completed').length;
    const total = doneCount + pending.length;
    message = `Mengunggah ${doneCount + 1} dari ${total} berkas`;
    actionLabel = 'Lihat antrean';
    kind = 'info';
  } else if (scanState.active) {
    message = `Memindai HP ${scanState.percent}% · ${scanState.files} berkas`;
    actionLabel = scanState.source || 'Latar';
    kind = 'scan';
    onPress = () => router.push('/(tabs)');
  } else if (backupRules.lastDelayReason && !ignoreExpoGoPermDelay) {
    message = backupRules.lastDelayReason;
    kind = backupRules.lastDelayAction === 'reconnect' ? 'danger' : 'warn';
    if (backupRules.lastDelayAction === 'reconnect') {
      actionLabel = 'Hubungkan ulang';
      onPress = () => router.push('/settings/connect');
    } else if (backupRules.lastDelayAction === 'retry') {
      actionLabel = 'Coba lagi';
      onPress = () => {
        void triggerBackupNow();
      };
    } else if (backupRules.lastDelayAction === 'permissions') {
      actionLabel = 'Pengaturan';
      onPress = () => {
        void Linking.openSettings();
      };
    } else {
      actionLabel = 'Lihat aturan';
    }
  } else if (failed.length > 0) {
    message = `${failed.length} unggahan gagal`;
    actionLabel = 'Coba lagi';
    kind = 'danger';
    onPress = () => {
      void triggerBackupNow();
    };
  }

  if (!message) {
    return null;
  }

  const isNetworkDelay = /wi-fi|wifi|jaringan|offline/i.test(message);

  const tint =
    kind === 'danger'
      ? palette.danger
      : kind === 'warn'
        ? palette.warning
        : palette.accent;

  return (
    <ActionPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${message}. ${actionLabel}`}
      style={styles.wrap}>
      <Surface pill solid={kind === 'danger'} nativeChrome={kind !== 'danger'} style={styles.pill}>
        <View style={styles.left}>
          {kind === 'danger' ? (
            <AlertTriangle size={16} color={tint} strokeWidth={2.2} />
          ) : kind === 'warn' ? (
            isNetworkDelay ? (
              <WifiOff size={16} color={tint} strokeWidth={2.2} />
            ) : (
              <AlertCircle size={16} color={tint} strokeWidth={2.2} />
            )
          ) : kind === 'scan' ? (
            <RefreshCw size={15} color={tint} strokeWidth={2.2} />
          ) : (
            <CloudUpload size={16} color={tint} strokeWidth={2.2} />
          )}
          <AppText weight="semibold" size={12.5} numberOfLines={1} style={{ flex: 1 }}>
            {message}
          </AppText>
        </View>
        <AppText weight="bold" size={12} numberOfLines={1} style={{ color: tint, maxWidth: 110 }}>
          {actionLabel}
        </AppText>
      </Surface>
    </ActionPressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 14,
    marginBottom: 8,
  },
  pill: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
