import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { Surface } from './Surface';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

type Props<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const { palette } = useAppTheme();

  return (
    <Surface pill style={styles.wrap}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.item,
              active && {
                backgroundColor: palette.segActiveBg,
              },
            ]}>
            {opt.icon ? <View style={styles.icon}>{opt.icon}</View> : null}
            <AppText
              weight="semibold"
              size={13}
              style={{ color: active ? palette.segActiveFg : palette.textSecondary }}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </Surface>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  item: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
