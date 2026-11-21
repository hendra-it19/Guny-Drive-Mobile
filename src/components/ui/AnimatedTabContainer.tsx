import { useEffect, useState } from 'react';
import { Animated } from 'react-native';

type TabSwitchListener = (direction: 1 | -1) => void;

const listeners = new Set<TabSwitchListener>();

export function notifyTabSwitch(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  const direction: 1 | -1 = toIndex > fromIndex ? 1 : -1;
  listeners.forEach((listener) => listener(direction));
}

export function useDirectionalShiftAnimation() {
  const [translateX] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));

  const triggerShift = (direction: 1 | -1, distance = 32) => {
    translateX.setValue(direction * distance);
    opacity.setValue(0.42);

    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        damping: 21,
        stiffness: 230,
        mass: 0.75,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 190,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    const handler: TabSwitchListener = (direction) => {
      triggerShift(direction, 26);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  });

  return { translateX, opacity, triggerShift };
}

/**
 * Local section animation hook for inner tab content (e.g. Images / Videos / Docs / Audio).
 * Animates ONLY the bottom content container without shifting or blinking the full screen.
 */
export function useSectionSlideAnimation() {
  const [translateX] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));

  const animateSectionSwitch = (fromIndex: number, toIndex: number, distance = 22) => {
    if (fromIndex === toIndex) return;
    const direction: 1 | -1 = toIndex > fromIndex ? 1 : -1;

    translateX.setValue(direction * distance);
    opacity.setValue(0.75);

    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        damping: 22,
        stiffness: 250,
        mass: 0.7,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return { translateX, opacity, animateSectionSwitch };
}
