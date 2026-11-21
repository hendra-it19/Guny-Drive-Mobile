import { ActionPressable } from '@/components/ui/ActionPressable';
import React, { useEffect, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';

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

const TRACK_PAD = 4;
const ITEM_GAP = 4;

export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const { palette } = useAppTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const [animIndex] = useState(() => new Animated.Value(activeIndex));

  useEffect(() => {
    Animated.spring(animIndex, {
      toValue: activeIndex,
      damping: 20,
      stiffness: 220,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, animIndex]);

  const compact = options.length >= 4;
  const count = Math.max(1, options.length);
  const innerWidth = Math.max(0, trackWidth - TRACK_PAD * 2 - ITEM_GAP * (count - 1));
  const pillWidth = innerWidth / count;
  const stepDistance = pillWidth + ITEM_GAP;

  const translateX = animIndex.interpolate({
    inputRange: options.map((_, i) => i),
    outputRange: options.map((_, i) => i * stepDistance),
    extrapolate: 'clamp',
  });

  const handleLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  return (
    <Surface pill style={styles.wrap} onLayout={handleLayout}>
      {pillWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activePill,
            {
              width: pillWidth,
              backgroundColor: palette.segActiveBg,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <ActionPressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.item,
              compact && styles.itemCompact,
              pillWidth === 0 &&
                active && {
                  backgroundColor: palette.segActiveBg,
                },
            ]}>
            {opt.icon ? <View style={styles.icon}>{opt.icon}</View> : null}
            <AppText
              weight={active ? 'bold' : 'semibold'}
              size={compact ? 11 : 13}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={{
                color: active ? palette.segActiveFg : palette.textSecondary,
                flexShrink: 1,
              }}>
              {opt.label}
            </AppText>
          </ActionPressable>
        );
      })}
    </Surface>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    flexDirection: 'row',
    padding: TRACK_PAD,
    gap: ITEM_GAP,
  },
  activePill: {
    position: 'absolute',
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    borderRadius: 999,
  },
  item: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
    overflow: 'hidden',
    zIndex: 1,
  },
  itemCompact: {
    paddingHorizontal: 4,
    gap: 3,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
