import { ActionPressable } from '@/components/ui/ActionPressable';
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

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
  const [scale] = useState(() => new Animated.Value(active ? 1.03 : 1));

  useEffect(() => {
    Animated.spring(scale, {
      toValue: active ? 1.03 : 1,
      damping: 16,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [active, scale]);

  if (active) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <ActionPressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          style={[styles.pill, { backgroundColor: palette.accent }]}>
          <AppText weight="bold" size={13} color="onAccent">
            {label}
          </AppText>
        </ActionPressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <ActionPressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: false }}>
        <Surface pill style={styles.pill}>
          <AppText weight="semibold" size={13} color="secondary">
            {label}
          </AppText>
        </Surface>
      </ActionPressable>
    </Animated.View>
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
