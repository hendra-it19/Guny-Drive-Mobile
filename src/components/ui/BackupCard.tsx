import { ActionPressable } from '@/components/ui/ActionPressable';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertCircle, Check, ChevronRight, CloudUpload } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';
import { formatBytes } from '@/lib/format';

import { AppText } from './AppText';
import { Surface } from './Surface';

type Props = {
  statusKind: 'ok' | 'uploading' | 'warning';
  title: string;
  subtitle: string;
  usedBytes: number;
  quotaBytes: number;
  onPress: () => void;
};

export function BackupCard({
  statusKind,
  title,
  subtitle,
  usedBytes,
  quotaBytes,
  onPress,
}: Props) {
  const { palette } = useAppTheme();

  const pct = quotaBytes > 0 ? Math.min(100, Math.max(2, (usedBytes / quotaBytes) * 100)) : 0;

  const badgeColor =
    statusKind === 'warning'
      ? palette.warning
      : statusKind === 'uploading'
        ? palette.accent
        : palette.success;

  const badgeBg = palette.isMono ? palette.text : `${badgeColor}20`;
  const iconColor = palette.isMono ? palette.onAccent : badgeColor;

  return (
    <ActionPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`}>
      {({ pressed }) => (
        <Surface style={[styles.card, pressed && { transform: [{ scale: 0.985 }] }]}>
          <View style={styles.row}>
            <View style={[styles.statusCircle, { backgroundColor: badgeBg }]}>
              {statusKind === 'warning' ? (
                <AlertCircle size={20} color={iconColor} strokeWidth={2.2} />
              ) : statusKind === 'uploading' ? (
                <CloudUpload size={20} color={iconColor} strokeWidth={2.2} />
              ) : (
                <Check size={20} color={iconColor} strokeWidth={2.4} />
              )}
            </View>
            <View style={styles.grow}>
              <AppText weight="bold" size={15} numberOfLines={1}>
                {title}
              </AppText>
              <AppText weight="medium" size={12.5} color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
                {subtitle}
              </AppText>
            </View>
            <ChevronRight size={18} color={palette.textSecondary} strokeWidth={1.8} />
          </View>

          <View style={[styles.track, { backgroundColor: palette.track }]}>
            <LinearGradient
              colors={[palette.meterGradient[0], palette.meterGradient[1], palette.meterGradient[2]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${pct}%` }]}
            />
          </View>

          <View style={styles.meterFooter}>
            <AppText weight="semibold" size={12} color="secondary">
              Penyimpanan
            </AppText>
            <AppText weight="semibold" size={12} color="secondary" tabular>
              {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
            </AppText>
          </View>
        </Surface>
      )}
    </ActionPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  track: {
    height: 6,
    borderRadius: 6,
    overflow: 'hidden',
    marginTop: 14,
    marginBottom: 7,
  },
  fill: {
    height: '100%',
    borderRadius: 6,
  },
  meterFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
