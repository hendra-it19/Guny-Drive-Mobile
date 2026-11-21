import { ActionPressable } from '@/components/ui/ActionPressable';
import { Plus } from 'lucide-react-native';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { useStatusPillActive } from './StatusPillBar';

type Props = {
  label?: string;
  onPress: () => void;
  bottomOffset?: number;
};

export function FabButton({ label = 'Tambah', onPress, bottomOffset = 94 }: Props) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const statusPillActive = useStatusPillActive();
  const resolvedOffset = statusPillActive ? bottomOffset + 54 : bottomOffset;

  return (
    <ActionPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: palette.accent,
          bottom: Math.max(insets.bottom, 10) + resolvedOffset,
          shadowColor: palette.accent,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}>
      <Plus size={20} color={palette.onAccent} strokeWidth={2.4} />
      <AppText weight="bold" size={15} color="onAccent">
        {label}
      </AppText>
    </ActionPressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    height: 50,
    paddingLeft: 16,
    paddingRight: 20,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 20,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
});
