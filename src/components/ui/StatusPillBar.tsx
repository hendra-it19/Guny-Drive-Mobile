import { useRouter } from 'expo-router';
import { AlertTriangle, CloudUpload, WifiOff } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { Surface } from './Surface';

export function StatusPillBar() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { authRevoked, backupRules, queue, triggerBackupNow } = useApp();

  const uploading = queue.filter((i) => i.status === 'uploading');
  const pending = queue.filter((i) => i.status === 'pending' || i.status === 'uploading');
  const failed = queue.filter((i) => i.status === 'failed');

  let message: string | null = null;
  let actionLabel = 'Lihat antrean';
  let kind: 'info' | 'warn' | 'danger' = 'info';
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
  } else if (backupRules.lastDelayReason) {
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

  const tint =
    kind === 'danger'
      ? palette.danger
      : kind === 'warn'
        ? palette.warning
        : palette.accent;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${message}. ${actionLabel}`}
      style={styles.wrap}>
      <Surface pill solid={kind === 'danger'} nativeChrome={kind !== 'danger'} style={styles.pill}>
        <View style={styles.left}>
          {kind === 'danger' ? (
            <AlertTriangle size={16} color={tint} strokeWidth={2.2} />
          ) : kind === 'warn' ? (
            <WifiOff size={16} color={tint} strokeWidth={2.2} />
          ) : (
            <CloudUpload size={16} color={tint} strokeWidth={2.2} />
          )}
          <AppText weight="semibold" size={12.5} numberOfLines={1} style={{ flex: 1 }}>
            {message}
          </AppText>
        </View>
        <AppText weight="bold" size={12.5} style={{ color: tint }}>
          {actionLabel}
        </AppText>
      </Surface>
    </Pressable>
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
