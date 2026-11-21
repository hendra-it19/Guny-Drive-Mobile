import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';
import type { FileGridLayout } from './FileViewToolbar';

export function FileSkeleton({ layout, compact = false }: { layout: FileGridLayout; compact?: boolean }) {
  const { palette } = useAppTheme();
  const [opacity] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([0.85, 0.45].map(toValue =>
      Animated.timing(opacity, { toValue, duration: 750, useNativeDriver: true, isInteraction: false }),
    )));
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);
  const list = layout === 'list';
  const columns = list ? 1 : Number(layout.slice(-1));
  return (
    <Animated.View accessible accessibilityLabel="Memuat berkas" accessibilityState={{ busy: true }} style={{ opacity, gap: 8 }}>
      {Array.from({ length: compact ? 1 : list ? 5 : 2 }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 8 }}>
          {Array.from({ length: columns }, (_, col) => (
            <View key={col} style={{ flex: 1, borderRadius: 12, backgroundColor: palette.divider,
              ...(list ? { height: 56, flexDirection: 'row', alignItems: 'center' } : { aspectRatio: 1, justifyContent: 'flex-end' }), padding: 10, gap: 10 }}>
              {list && <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: palette.surface }} />}
              <View style={{ width: '60%', height: 8, borderRadius: 4, backgroundColor: palette.surface }} />
            </View>
          ))}
        </View>
      ))}
    </Animated.View>
  );
}
