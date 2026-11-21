import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Appearance, useColorScheme } from 'react-native';

import {
  ColorMode,
  DEFAULT_COLOR_MODE,
  DEFAULT_REDUCE_TRANSPARENCY,
  DEFAULT_THEME_ID,
  normalizeColorMode,
  normalizeReduceTransparency,
  normalizeThemeId,
  Palette,
  ReduceTransparencyPref,
  ResolvedScheme,
  ThemeDefinition,
  ThemeId,
  THEMES,
} from '@/constants/theme';
import { getPref, setPref } from '@/lib/storage';

const PREF_KEY = 'appearance_pref_v2';

type StoredAppearance = {
  theme: ThemeId;
  mode: ColorMode;
  reduceTransparency: ReduceTransparencyPref;
};

export type ThemeContextValue = {
  ready: boolean;
  themeId: ThemeId;
  theme: ThemeDefinition;
  mode: ColorMode;
  scheme: ResolvedScheme;
  palette: Palette;
  reduceTransparencyPref: ReduceTransparencyPref;
  reduceTransparencyEffective: boolean;
  reduceMotion: boolean;
  useGlass: boolean;
  summaryText: string;
  setThemeId: (id: ThemeId) => void;
  setMode: (mode: ColorMode) => void;
  setReduceTransparencyPref: (pref: ReduceTransparencyPref) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const hookScheme = useColorScheme();
  const [listenerScheme, setListenerScheme] = useState<ResolvedScheme | null>(null);
  const osScheme: ResolvedScheme =
    listenerScheme ?? (hookScheme === 'dark' ? 'dark' : 'light');
  const [osReduceTransparency, setOsReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [ready, setReady] = useState(false);
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [mode, setModeState] = useState<ColorMode>(DEFAULT_COLOR_MODE);
  const [reduceTransparencyPref, setReduceTransparencyPrefState] =
    useState<ReduceTransparencyPref>(DEFAULT_REDUCE_TRANSPARENCY);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setListenerScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      const [stored, sysTrans, sysMotion] = await Promise.all([
        getPref<Partial<StoredAppearance>>(PREF_KEY, {}),
        AccessibilityInfo.isReduceTransparencyEnabled().catch(() => false),
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      ]);

      if (!mounted) return;
      setThemeIdState(normalizeThemeId(stored.theme));
      setModeState(normalizeColorMode(stored.mode));
      setReduceTransparencyPrefState(normalizeReduceTransparency(stored.reduceTransparency));
      setOsReduceTransparency(Boolean(sysTrans));
      setReduceMotion(Boolean(sysMotion));
      setReady(true);
    }

    void hydrate();

    const transSub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (val) => {
      setOsReduceTransparency(Boolean(val));
    });
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', (val) => {
      setReduceMotion(Boolean(val));
    });

    return () => {
      mounted = false;
      transSub.remove();
      motionSub.remove();
    };
  }, []);

  const persist = useCallback((next: StoredAppearance) => {
    void setPref(PREF_KEY, next);
  }, []);

  const setThemeId = useCallback(
    (id: ThemeId) => {
      setThemeIdState(id);
      persist({ theme: id, mode, reduceTransparency: reduceTransparencyPref });
    },
    [mode, persist, reduceTransparencyPref],
  );

  const setMode = useCallback(
    (nextMode: ColorMode) => {
      setModeState(nextMode);
      persist({ theme: themeId, mode: nextMode, reduceTransparency: reduceTransparencyPref });
    },
    [persist, reduceTransparencyPref, themeId],
  );

  const setReduceTransparencyPref = useCallback(
    (nextPref: ReduceTransparencyPref) => {
      setReduceTransparencyPrefState(nextPref);
      persist({ theme: themeId, mode, reduceTransparency: nextPref });
    },
    [mode, persist, themeId],
  );

  const value = useMemo<ThemeContextValue>(() => {
    const scheme: ResolvedScheme = mode === 'system' ? osScheme : mode;
    const theme = THEMES[themeId];
    const palette = theme[scheme];
    const reduceTransparencyEffective =
      reduceTransparencyPref === 'on' ||
      (reduceTransparencyPref === 'system' && osReduceTransparency);
    const useGlass = Boolean(palette.glass) && !reduceTransparencyEffective;

    const modeLabel =
      mode === 'system'
        ? `Sistem (${scheme === 'dark' ? 'gelap' : 'terang'})`
        : mode === 'dark'
          ? 'Gelap'
          : 'Terang';

    return {
      ready,
      themeId,
      theme,
      mode,
      scheme,
      palette,
      reduceTransparencyPref,
      reduceTransparencyEffective,
      reduceMotion,
      useGlass,
      summaryText: `${theme.name} · ${modeLabel}`,
      setThemeId,
      setMode,
      setReduceTransparencyPref,
    };
  }, [
    mode,
    osReduceTransparency,
    osScheme,
    ready,
    reduceMotion,
    reduceTransparencyPref,
    setMode,
    setReduceTransparencyPref,
    setThemeId,
    themeId,
  ]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used inside AppThemeProvider');
  }
  return ctx;
}
