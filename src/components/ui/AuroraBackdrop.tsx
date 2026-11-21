import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

export function AuroraBackdrop({ children }: { children: React.ReactNode }) {
  const { palette, useGlass, scheme } = useAppTheme();

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      {useGlass && palette.glass ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <LinearGradient
            colors={
              scheme === 'light'
                ? ['#DDE4FF', '#EEF1FB', '#E8E4FF', '#E4F3FA']
                : ['#141852', '#080B1A', '#1A1140', '#081C2E']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.glowTopLeft,
              {
                backgroundColor: palette.glass.aurora[0],
                opacity: scheme === 'light' ? 0.42 : 0.34,
              },
            ]}
          />
          <View
            style={[
              styles.glowMidRight,
              {
                backgroundColor: palette.glass.aurora[1],
                opacity: scheme === 'light' ? 0.38 : 0.3,
              },
            ]}
          />
          <View
            style={[
              styles.glowBottomLeft,
              {
                backgroundColor: palette.glass.aurora[2],
                opacity: scheme === 'light' ? 0.36 : 0.26,
              },
            ]}
          />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  glowTopLeft: {
    position: 'absolute',
    top: -70,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  glowMidRight: {
    position: 'absolute',
    top: '28%',
    right: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
  },
  glowBottomLeft: {
    position: 'absolute',
    bottom: 60,
    left: -80,
    width: 250,
    height: 250,
    borderRadius: 125,
  },
});
