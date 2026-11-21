import type { Tabs } from 'expo-router';
import { CloudUpload, Folder, Image as ImageIcon, Lock } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { StatusPillBar } from './StatusPillBar';
import { Surface } from './Surface';

type TabBarRender = NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>;
type FloatingTabBarProps = Parameters<TabBarRender>[0];

const TAB_META: Record<string, { label: string }> = {
  index: { label: 'Berkas' },
  foto: { label: 'Foto' },
  backup: { label: 'Backup' },
  privat: { label: 'Privat' },
};

export function FloatingTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
}: FloatingTabBarProps) {
  const { palette } = useAppTheme();
  const safeInsets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, safeInsets.bottom, 10);

  const renderIcon = (name: string, color: string, focused: boolean) => {
    const strokeWidth = focused ? 2.2 : 1.8;
    switch (name) {
      case 'foto':
        return <ImageIcon size={21} color={color} strokeWidth={strokeWidth} />;
      case 'backup':
        return <CloudUpload size={21} color={color} strokeWidth={strokeWidth} />;
      case 'privat':
        return <Lock size={21} color={color} strokeWidth={strokeWidth} />;
      default:
        return <Folder size={21} color={color} strokeWidth={strokeWidth} />;
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outer,
        { paddingBottom: bottomInset },
      ]}>
      <StatusPillBar />
      <Surface pill nativeChrome style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.title === 'string'
              ? options.title
              : TAB_META[route.name]?.label ?? route.name;

          const color = focused ? palette.activeFg : palette.textSecondary;

          const onPress = () => {
            const event = emitter.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!focused && !event.defaultPrevented) {
              navigateToTab(route.key);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={[
                styles.tab,
                focused && { backgroundColor: palette.activeBg },
              ]}>
              {renderIcon(route.name, color, focused)}
              <AppText
                weight={focused ? 'bold' : 'semibold'}
                size={11}
                style={{ color }}
                numberOfLines={1}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    marginHorizontal: 14,
    height: 66,
    flexDirection: 'row',
    padding: 7,
    gap: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 48,
  },
});
