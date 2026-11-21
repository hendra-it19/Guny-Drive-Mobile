import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

type Props = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
};

export function Toggle({ value, onValueChange, accessibilityLabel }: Props) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      style={[
        styles.track,
        {
          backgroundColor: value ? palette.accent : palette.track,
          borderWidth: palette.isMono ? 1.5 : 0,
          borderColor: palette.text,
        },
      ]}>
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: value ? palette.onAccent : '#FFFFFF',
            transform: [{ translateX: value ? 18 : 0 }],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    padding: 3,
    justifyContent: 'center',
  },
  thumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
});
