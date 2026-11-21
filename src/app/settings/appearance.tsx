import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Check,
  ChevronLeft,
  Layers,
  Moon,
  Smartphone,
  Sun,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Segmented } from '@/components/ui/Segmented';
import { Surface } from '@/components/ui/Surface';
import { Toggle } from '@/components/ui/Toggle';
import { Spacing, THEME_LIST, ThemeDefinition } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

function ThemeSwatch({ item, scheme }: { item: ThemeDefinition; scheme: 'light' | 'dark' }) {
  const p = item[scheme];

  if (item.id === 'kaca') {
    return (
      <View style={styles.swatch}>
        <LinearGradient
          colors={
            scheme === 'light'
              ? ['#8EA2FF', '#C3A6FF', '#7FD8F5']
              : ['#2B2F9E', '#5A2FA8', '#0B6A8A']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.barTop,
            {
              backgroundColor:
                scheme === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(18,22,46,0.72)',
            },
          ]}
        />
        <View
          style={[
            styles.barBottom,
            {
              backgroundColor:
                scheme === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(18,22,46,0.72)',
            },
          ]}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.swatch,
        {
          backgroundColor: p.background,
          borderWidth: 1,
          borderColor: p.border,
        },
      ]}>
      <View
        style={[
          styles.barTop,
          {
            backgroundColor: p.surface,
            borderWidth: 0.5,
            borderColor: p.border,
          },
        ]}
      />
      <View style={[styles.barBottom, { backgroundColor: p.accent }]} />
    </View>
  );
}

export default function AppearanceScreen() {
  const router = useRouter();
  const {
    themeId,
    mode,
    scheme,
    palette,
    reduceTransparencyEffective,
    summaryText,
    setThemeId,
    setMode,
    setReduceTransparencyPref,
  } = useAppTheme();

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="Kembali ke Pengaturan">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Pengaturan
            </AppText>
          </Pressable>

          <AppText weight="extrabold" size={32} style={styles.title}>
            Tampilan
          </AppText>
          <AppText weight="medium" size={13} color="secondary">
            {summaryText}
          </AppText>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            TEMA
          </AppText>

          <Surface>
            {THEME_LIST.map((item, idx) => {
              const selected = item.id === themeId;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setThemeId(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={`Tema ${item.name}, ${item.description}`}
                  style={({ pressed }) => [
                    styles.themeRow,
                    idx > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                    pressed && { opacity: 0.72 },
                  ]}>
                  <ThemeSwatch item={item} scheme={scheme} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={15}>
                      {item.name}
                    </AppText>
                    <AppText size={12.5} color="secondary" style={{ marginTop: 2 }}>
                      {item.description}
                    </AppText>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      selected
                        ? { backgroundColor: palette.accent, borderWidth: 0 }
                        : { borderColor: palette.textSecondary, borderWidth: 2, opacity: 0.55 },
                    ]}>
                    {selected ? (
                      <Check size={14} color={palette.onAccent} strokeWidth={3} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </Surface>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            MODE WARNA
          </AppText>

          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              {
                value: 'system',
                label: 'Sistem',
                icon: (
                  <Smartphone
                    size={15}
                    color={mode === 'system' ? palette.segActiveFg : palette.textSecondary}
                    strokeWidth={2}
                  />
                ),
              },
              {
                value: 'light',
                label: 'Terang',
                icon: (
                  <Sun
                    size={15}
                    color={mode === 'light' ? palette.segActiveFg : palette.textSecondary}
                    strokeWidth={2}
                  />
                ),
              },
              {
                value: 'dark',
                label: 'Gelap',
                icon: (
                  <Moon
                    size={15}
                    color={mode === 'dark' ? palette.segActiveFg : palette.textSecondary}
                    strokeWidth={2}
                  />
                ),
              },
            ]}
          />

          <Surface style={styles.transCard}>
            <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
              <Layers size={18} color={palette.activeFg} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText weight="bold" size={15}>
                Kurangi transparansi
              </AppText>
              <AppText size={12.5} color="secondary" style={{ marginTop: 2 }}>
                Ganti kaca dengan panel solid
              </AppText>
            </View>
            <Toggle
              value={reduceTransparencyEffective}
              onValueChange={(next) => setReduceTransparencyPref(next ? 'on' : 'off')}
              accessibilityLabel="Kurangi transparansi, ganti kaca dengan panel solid"
            />
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingHorizontal: Spacing.screen, paddingBottom: 40 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 44,
    marginLeft: -6,
  },
  title: { letterSpacing: -1, marginTop: 2, marginBottom: 4 },
  groupLabel: {
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 68,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 13,
    overflow: 'hidden',
    position: 'relative',
  },
  barTop: {
    position: 'absolute',
    top: 10,
    left: 7,
    right: 7,
    height: 9,
    borderRadius: 5,
  },
  barBottom: {
    position: 'absolute',
    top: 24,
    left: 7,
    right: 17,
    height: 9,
    borderRadius: 5,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transCard: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 62,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
