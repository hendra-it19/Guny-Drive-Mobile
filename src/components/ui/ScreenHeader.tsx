import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Cloud } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { Surface } from './Surface';

type Props = {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, rightElement }: Props) {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { me } = useApp();

  const initial = (me?.owner.name?.trim().charAt(0) || 'G').toUpperCase();

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <LinearGradient
            colors={[palette.logoGradient[0], palette.logoGradient[1], palette.logoGradient[2]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoBox}>
            <Cloud size={17} color={palette.logoFg} strokeWidth={2.2} />
          </LinearGradient>
          <AppText weight="bold" size={16} style={{ letterSpacing: -0.2 }}>
            GunyDrive
          </AppText>
        </View>

        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Buka Pengaturan dan Tampilan"
          hitSlop={6}>
          <Surface pill style={styles.avatar}>
            <AppText weight="bold" size={15} color="accent">
              {initial}
            </AppText>
          </Surface>
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        <AppText
          weight="extrabold"
          size={32}
          style={{ letterSpacing: -1, lineHeight: 38 }}
          accessibilityRole="header">
          {title}
        </AppText>
        {rightElement ?? (subtitle ? (
          <AppText weight="medium" size={13} color="secondary" tabular>
            {subtitle}
          </AppText>
        ) : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.screen,
    paddingTop: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  logoBox: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
  },
});
