import { ActionPressable } from '@/components/ui/ActionPressable';
import { notifyTabSwitch } from '@/components/ui/AnimatedTabContainer';
import type { Tabs } from 'expo-router';
import { Files, Folder, Lock, Settings } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { StatusPillBar } from './StatusPillBar';
import { Surface } from './Surface';

type TabBarRender = NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>;
type FloatingTabBarProps = Parameters<TabBarRender>[0];

const TAB_META: Record<string, { label: string }> = {
  index: { label: 'Berkas' },
  foto: { label: 'File' },
  privat: { label: 'Privat' },
  backup: { label: 'Pengaturan' },
};

const BAR_PAD = 7;
const TAB_GAP = 4;

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

  const [barWidth, setBarWidth] = useState(0);
  const [animIndex] = useState(() => new Animated.Value(state.index));

  useEffect(() => {
    Animated.spring(animIndex, {
      toValue: state.index,
      damping: 19,
      stiffness: 210,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [animIndex, state.index]);

  const count = Math.max(1, state.routes.length);
  const innerWidth = Math.max(0, barWidth - BAR_PAD * 2 - TAB_GAP * (count - 1));
  const pillWidth = innerWidth / count;
  const stepDistance = pillWidth + TAB_GAP;

  const translateX = animIndex.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * stepDistance),
    extrapolate: 'clamp',
  });

  const handleBarLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  const renderIcon = (name: string, color: string, focused: boolean) => {
    const strokeWidth = focused ? 2.2 : 1.8;
    switch (name) {
      case 'foto':
        return <Files size={21} color={color} strokeWidth={strokeWidth} />;
      case 'backup':
        return <Settings size={21} color={color} strokeWidth={strokeWidth} />;
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
      <Surface pill nativeChrome style={styles.bar} onLayout={handleBarLayout}>
        {pillWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.activePill,
              {
                width: pillWidth,
                backgroundColor: palette.activeBg,
                transform: [{ translateX }],
              },
            ]}
          />
        ) : null}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.title === 'string'
              ? options.title
              : TAB_META[route.name]?.label ?? route.name;

          const color = focused ? palette.activeFg : palette.textSecondary;

          const itemScale = animIndex.interpolate({
            inputRange: [index - 1, index, index + 1],
            outputRange: [1, 1.06, 1],
            extrapolate: 'clamp',
          });

          const itemTranslateY = animIndex.interpolate({
            inputRange: [index - 1, index, index + 1],
            outputRange: [0, -1.5, 0],
            extrapolate: 'clamp',
          });

          const onPress = () => {
            const event = emitter.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!focused && !event.defaultPrevented) {
              notifyTabSwitch(state.index, index);
              navigateToTab(route.key);
            }
          };

          return (
            <ActionPressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={[
                styles.tab,
                pillWidth === 0 && focused && { backgroundColor: palette.activeBg },
              ]}>
              <Animated.View
                style={[
                  styles.tabInner,
                  {
                    transform: [{ scale: itemScale }, { translateY: itemTranslateY }],
                  },
                ]}>
                {renderIcon(route.name, color, focused)}
                <AppText
                  weight={focused ? 'bold' : 'semibold'}
                  size={11}
                  style={{ color }}
                  numberOfLines={1}>
                  {label}
                </AppText>
              </Animated.View>
            </ActionPressable>
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
    position: 'relative',
    marginHorizontal: 14,
    height: 66,
    flexDirection: 'row',
    padding: BAR_PAD,
    gap: TAB_GAP,
  },
  activePill: {
    position: 'absolute',
    top: BAR_PAD,
    bottom: BAR_PAD,
    left: BAR_PAD,
    borderRadius: 999,
  },
  tab: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    zIndex: 1,
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
});
