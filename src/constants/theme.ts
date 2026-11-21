export type ThemeId = 'kaca' | 'minimal' | 'zamrud' | 'mono' | 'senja';
export type ColorMode = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';
export type ReduceTransparencyPref = 'system' | 'on' | 'off';

export type GlassTokens = {
  fill: string;
  fallbackFill: string;
  tintColor: string;
  blur: number;
  edge: string;
  highlight: string;
  shadowColor: string;
  shadowOpacity: number;
  aurora: readonly [string, string, string];
  auroraOpacity: number;
};

export type Palette = {
  background: string;
  surface: string;
  field: string;
  text: string;
  textSecondary: string;
  accent: string;
  onAccent: string;
  border: string;
  borderWidth: number;
  divider: string;
  activeBg: string;
  activeFg: string;
  track: string;
  meterGradient: readonly [string, string, string];
  logoGradient: readonly [string, string, string];
  logoFg: string;
  success: string;
  warning: string;
  danger: string;
  segActiveBg: string;
  segActiveFg: string;
  isMono: boolean;
  glass?: GlassTokens;
};

export type ThemeDefinition = {
  id: ThemeId;
  letter: string;
  name: string;
  description: string;
  radius: { md: number; lg: number };
  light: Palette;
  dark: Palette;
};

export const STATUS_COLORS = {
  light: {
    success: '#15803D',
    warning: '#B45309',
    danger: '#B91C1C',
  },
  dark: {
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
  },
} as const;

export const FILE_TILE_COLORS = {
  light: {
    pdf: '#E5484D',
    audio: '#8E4EC6',
    archive: '#D97706',
  },
  dark: {
    pdf: '#FF8A8D',
    audio: '#C9A2F2',
    archive: '#FBBF24',
  },
} as const;

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  kaca: {
    id: 'kaca',
    letter: 'A',
    name: 'Kaca Kristal',
    description: 'Glassmorphism modern dan bersih',
    radius: { md: 14, lg: 22 },
    light: {
      background: '#EEF1FB',
      surface: '#F7F8FE',
      field: 'rgba(255, 255, 255, 0.72)',
      text: '#0E1530',
      textSecondary: '#4A5578',
      accent: '#4F46E5',
      onAccent: '#FFFFFF',
      border: 'rgba(255, 255, 255, 0.85)',
      borderWidth: 1,
      divider: 'rgba(14, 21, 48, 0.08)',
      activeBg: 'rgba(79, 70, 229, 0.13)',
      activeFg: '#4F46E5',
      track: 'rgba(14, 21, 48, 0.10)',
      meterGradient: ['#4F46E5', '#8B5CF6', '#22B8E0'],
      logoGradient: ['#4F46E5', '#8B5CF6', '#22B8E0'],
      logoFg: '#FFFFFF',
      success: STATUS_COLORS.light.success,
      warning: STATUS_COLORS.light.warning,
      danger: STATUS_COLORS.light.danger,
      segActiveBg: 'rgba(255, 255, 255, 0.92)',
      segActiveFg: '#0E1530',
      isMono: false,
      glass: {
        fill: 'rgba(255, 255, 255, 0.62)',
        fallbackFill: 'rgba(255, 255, 255, 0.82)',
        tintColor: 'rgba(255, 255, 255, 0.55)',
        blur: 24,
        edge: 'rgba(255, 255, 255, 0.82)',
        highlight: 'rgba(255, 255, 255, 0.90)',
        shadowColor: '#1F295F',
        shadowOpacity: 0.16,
        aurora: ['#8EA2FF', '#C3A6FF', '#7FD8F5'],
        auroraOpacity: 0.85,
      },
    },
    dark: {
      background: '#080B1A',
      surface: '#141A30',
      field: 'rgba(255, 255, 255, 0.08)',
      text: '#EEF1FF',
      textSecondary: '#A3ACCB',
      accent: '#A8B4FF',
      onAccent: '#14164A',
      border: 'rgba(255, 255, 255, 0.12)',
      borderWidth: 1,
      divider: 'rgba(255, 255, 255, 0.08)',
      activeBg: 'rgba(168, 180, 255, 0.16)',
      activeFg: '#C7CEFF',
      track: 'rgba(255, 255, 255, 0.12)',
      meterGradient: ['#A8B4FF', '#C4A5FF', '#67D5F0'],
      logoGradient: ['#6366F1', '#8B5CF6', '#22B8E0'],
      logoFg: '#FFFFFF',
      success: STATUS_COLORS.dark.success,
      warning: STATUS_COLORS.dark.warning,
      danger: STATUS_COLORS.dark.danger,
      segActiveBg: 'rgba(255, 255, 255, 0.14)',
      segActiveFg: '#EEF1FF',
      isMono: false,
      glass: {
        fill: 'rgba(18, 22, 46, 0.62)',
        fallbackFill: 'rgba(18, 22, 46, 0.86)',
        tintColor: 'rgba(18, 22, 46, 0.65)',
        blur: 24,
        edge: 'rgba(255, 255, 255, 0.12)',
        highlight: 'rgba(255, 255, 255, 0.08)',
        shadowColor: '#000000',
        shadowOpacity: 0.55,
        aurora: ['#3B3FD8', '#7A3FE0', '#0E8FB8'],
        auroraOpacity: 0.5,
      },
    },
  },
  minimal: {
    id: 'minimal',
    letter: 'B',
    name: 'Minimal',
    description: 'Netral dan padat informasi',
    radius: { md: 10, lg: 14 },
    light: {
      background: '#F6F7F9',
      surface: '#FFFFFF',
      field: '#FFFFFF',
      text: '#111827',
      textSecondary: '#5B6474',
      accent: '#2563EB',
      onAccent: '#FFFFFF',
      border: '#E5E7EB',
      borderWidth: 1,
      divider: '#EEF0F3',
      activeBg: 'rgba(37, 99, 235, 0.10)',
      activeFg: '#2563EB',
      track: '#E5E7EB',
      meterGradient: ['#2563EB', '#2563EB', '#2563EB'],
      logoGradient: ['#2563EB', '#2563EB', '#2563EB'],
      logoFg: '#FFFFFF',
      success: STATUS_COLORS.light.success,
      warning: STATUS_COLORS.light.warning,
      danger: STATUS_COLORS.light.danger,
      segActiveBg: '#FFFFFF',
      segActiveFg: '#111827',
      isMono: false,
    },
    dark: {
      background: '#0B0C0E',
      surface: '#16181C',
      field: '#16181C',
      text: '#F3F4F6',
      textSecondary: '#9CA3AF',
      accent: '#7AA7FF',
      onAccent: '#0B1B3A',
      border: '#262A31',
      borderWidth: 1,
      divider: '#20232A',
      activeBg: 'rgba(122, 167, 255, 0.14)',
      activeFg: '#7AA7FF',
      track: '#2A2E36',
      meterGradient: ['#7AA7FF', '#7AA7FF', '#7AA7FF'],
      logoGradient: ['#7AA7FF', '#7AA7FF', '#7AA7FF'],
      logoFg: '#0B1B3A',
      success: STATUS_COLORS.dark.success,
      warning: STATUS_COLORS.dark.warning,
      danger: STATUS_COLORS.dark.danger,
      segActiveBg: '#262A31',
      segActiveFg: '#F3F4F6',
      isMono: false,
    },
  },
  zamrud: {
    id: 'zamrud',
    letter: 'C',
    name: 'Zamrud',
    description: 'Hijau tenang, lapang untuk foto',
    radius: { md: 14, lg: 20 },
    light: {
      background: '#F4F6F3',
      surface: '#FFFFFF',
      field: '#FFFFFF',
      text: '#132019',
      textSecondary: '#4F5F56',
      accent: '#0F7A55',
      onAccent: '#FFFFFF',
      border: '#E4EAE5',
      borderWidth: 1,
      divider: '#EDF1EE',
      activeBg: 'rgba(15, 122, 85, 0.11)',
      activeFg: '#0F7A55',
      track: '#E1E8E3',
      meterGradient: ['#0F7A55', '#0F7A55', '#0F7A55'],
      logoGradient: ['#0F7A55', '#0F7A55', '#0F7A55'],
      logoFg: '#FFFFFF',
      success: STATUS_COLORS.light.success,
      warning: STATUS_COLORS.light.warning,
      danger: STATUS_COLORS.light.danger,
      segActiveBg: '#FFFFFF',
      segActiveFg: '#132019',
      isMono: false,
    },
    dark: {
      background: '#0A110D',
      surface: '#141D18',
      field: '#141D18',
      text: '#E9F2EC',
      textSecondary: '#9DB0A5',
      accent: '#5FE0A8',
      onAccent: '#06281B',
      border: '#1F2A24',
      borderWidth: 1,
      divider: '#1C2621',
      activeBg: 'rgba(95, 224, 168, 0.14)',
      activeFg: '#5FE0A8',
      track: '#25322B',
      meterGradient: ['#5FE0A8', '#5FE0A8', '#5FE0A8'],
      logoGradient: ['#5FE0A8', '#5FE0A8', '#5FE0A8'],
      logoFg: '#06281B',
      success: STATUS_COLORS.dark.success,
      warning: STATUS_COLORS.dark.warning,
      danger: STATUS_COLORS.dark.danger,
      segActiveBg: '#22302A',
      segActiveFg: '#E9F2EC',
      isMono: false,
    },
  },
  mono: {
    id: 'mono',
    letter: 'D',
    name: 'Monokrom',
    description: 'Kontras tertinggi, tanpa warna',
    radius: { md: 8, lg: 12 },
    light: {
      background: '#F5F5F5',
      surface: '#FFFFFF',
      field: '#FFFFFF',
      text: '#0A0A0A',
      textSecondary: '#404040',
      accent: '#0A0A0A',
      onAccent: '#FFFFFF',
      border: '#0A0A0A',
      borderWidth: 1.5,
      divider: '#0A0A0A',
      activeBg: '#0A0A0A',
      activeFg: '#FFFFFF',
      track: '#D4D4D4',
      meterGradient: ['#0A0A0A', '#0A0A0A', '#0A0A0A'],
      logoGradient: ['#0A0A0A', '#0A0A0A', '#0A0A0A'],
      logoFg: '#FFFFFF',
      success: '#0A0A0A',
      warning: '#0A0A0A',
      danger: '#0A0A0A',
      segActiveBg: '#0A0A0A',
      segActiveFg: '#FFFFFF',
      isMono: true,
    },
    dark: {
      background: '#000000',
      surface: '#121212',
      field: '#121212',
      text: '#FFFFFF',
      textSecondary: '#C7C7C7',
      accent: '#FFFFFF',
      onAccent: '#000000',
      border: '#FFFFFF',
      borderWidth: 1.5,
      divider: '#FFFFFF',
      activeBg: '#FFFFFF',
      activeFg: '#000000',
      track: '#3A3A3A',
      meterGradient: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
      logoGradient: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
      logoFg: '#000000',
      success: '#FFFFFF',
      warning: '#FFFFFF',
      danger: '#FFFFFF',
      segActiveBg: '#FFFFFF',
      segActiveFg: '#000000',
      isMono: true,
    },
  },
  senja: {
    id: 'senja',
    letter: 'E',
    name: 'Senja',
    description: 'Hangat, lembut, bersahabat',
    radius: { md: 16, lg: 24 },
    light: {
      background: '#FFF6F1',
      surface: '#FFFFFF',
      field: '#FFFFFF',
      text: '#26150F',
      textSecondary: '#6B5249',
      accent: '#C2410C',
      onAccent: '#FFFFFF',
      border: '#F3E3DA',
      borderWidth: 1,
      divider: '#F6EAE3',
      activeBg: 'rgba(194, 65, 12, 0.11)',
      activeFg: '#C2410C',
      track: '#F1E1D8',
      meterGradient: ['#C2410C', '#C2410C', '#C2410C'],
      logoGradient: ['#C2410C', '#C2410C', '#C2410C'],
      logoFg: '#FFFFFF',
      success: STATUS_COLORS.light.success,
      warning: STATUS_COLORS.light.warning,
      danger: STATUS_COLORS.light.danger,
      segActiveBg: '#FFFFFF',
      segActiveFg: '#26150F',
      isMono: false,
    },
    dark: {
      background: '#160E0B',
      surface: '#231814',
      field: '#231814',
      text: '#FFF1EA',
      textSecondary: '#C8ADA2',
      accent: '#FFAB7A',
      onAccent: '#3A1606',
      border: '#33231C',
      borderWidth: 1,
      divider: '#2E201A',
      activeBg: 'rgba(255, 171, 122, 0.16)',
      activeFg: '#FFAB7A',
      track: '#3A2820',
      meterGradient: ['#FFAB7A', '#FFAB7A', '#FFAB7A'],
      logoGradient: ['#FFAB7A', '#FFAB7A', '#FFAB7A'],
      logoFg: '#3A1606',
      success: STATUS_COLORS.dark.success,
      warning: STATUS_COLORS.dark.warning,
      danger: STATUS_COLORS.dark.danger,
      segActiveBg: '#3A2820',
      segActiveFg: '#FFF1EA',
      isMono: false,
    },
  },
};

export const THEME_LIST: readonly ThemeDefinition[] = [
  THEMES.kaca,
  THEMES.minimal,
  THEMES.zamrud,
  THEMES.mono,
  THEMES.senja,
];

export const DEFAULT_THEME_ID: ThemeId = 'kaca';
export const DEFAULT_COLOR_MODE: ColorMode = 'system';
export const DEFAULT_REDUCE_TRANSPARENCY: ReduceTransparencyPref = 'system';

export function normalizeThemeId(value: unknown): ThemeId {
  if (typeof value === 'string' && value in THEMES) {
    return value as ThemeId;
  }
  return DEFAULT_THEME_ID;
}

export function normalizeColorMode(value: unknown): ColorMode {
  if (value === 'system' || value === 'light' || value === 'dark') {
    return value;
  }
  return DEFAULT_COLOR_MODE;
}

export function normalizeReduceTransparency(value: unknown): ReduceTransparencyPref {
  if (value === 'system' || value === 'on' || value === 'off') {
    return value;
  }
  return DEFAULT_REDUCE_TRANSPARENCY;
}

export const FontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  screen: 18,
  xl: 24,
  xxl: 32,
} as const;
