import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { Surface } from './Surface';

type Props = {
  label: string;
  active: boolean;
  onPress: () => void;
};

export function Chip({ label, active, onPress }: Props) {
  const { palette } = useAppTheme();

  if (active) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: true }}
        style={[styles.pill, { backgroundColor: palette.accent }]}>
        <AppText weight="semibold" size={13} color="onAccent">
          {label}
        </AppText>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: false }}>
      <Surface pill style={styles.pill}>
        <AppText weight="semibold" size={13} color="secondary">
          {label}
        </AppText>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
