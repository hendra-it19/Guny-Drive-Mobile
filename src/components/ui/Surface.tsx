import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

export type SurfaceProps = ViewProps & {
  /** Force opaque solid surface (used for Vault lock, errors, dialogs). */
  solid?: boolean;
  /** Prefer native iOS GlassView on fixed chrome (tab bar, header, sheets). */
  nativeChrome?: boolean;
  /** Pill shape (borderRadius 999). */
  pill?: boolean;
  radius?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
};

let cachedLiquidGlass: boolean | null = null;
function supportsNativeGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (cachedLiquidGlass === null) {
    try {
      cachedLiquidGlass = isLiquidGlassAvailable();
    } catch {
      cachedLiquidGlass = false;
    }
  }
  return cachedLiquidGlass;
}

export function Surface({
  solid = false,
  nativeChrome = false,
  pill = false,
  radius = 'lg',
  style,
  children,
  ...rest
}: SurfaceProps) {
  const { theme, palette, scheme, useGlass } = useAppTheme();
  const borderRadius = pill ? 999 : theme.radius[radius];

  const glass = !solid && useGlass ? palette.glass : undefined;

  if (glass && nativeChrome && supportsNativeGlass()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        tintColor={glass.tintColor}
        colorScheme={scheme}
        style={[
          {
            borderRadius,
            borderWidth: 1,
            borderColor: glass.edge,
            overflow: 'hidden',
          },
          style,
        ]}
        {...rest}>
        {children}
      </GlassView>
    );
  }

  const backgroundColor = glass
    ? Platform.OS === 'web'
      ? glass.fill
      : glass.fallbackFill
    : palette.surface;

  const borderColor = glass ? glass.edge : palette.border;
  const shadowStyle: ViewStyle = glass
    ? Platform.select({
        ios: {
          shadowColor: glass.shadowColor,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: glass.shadowOpacity,
          shadowRadius: 20,
        },
        android: {
          elevation: 2,
        },
        default: {},
      }) ?? {}
    : {};

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor,
          borderRadius,
          borderWidth: palette.borderWidth,
          borderColor,
        },
        shadowStyle,
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
