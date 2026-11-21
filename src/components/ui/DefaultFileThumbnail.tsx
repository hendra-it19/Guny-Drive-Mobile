import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

export type ThumbnailPreset =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'text'
  | 'code'
  | 'audio'
  | 'archive'
  | 'video'
  | 'image'
  | 'file';

const VALID_PRESETS = new Set<string>([
  'pdf',
  'word',
  'excel',
  'powerpoint',
  'text',
  'code',
  'audio',
  'archive',
  'video',
  'image',
  'file',
]);

const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const EXCEL_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv']);
const WORD_EXTS = new Set(['doc', 'docx', 'docm', 'odt', 'rtf']);
const PPT_EXTS = new Set(['ppt', 'pptx', 'pptm', 'odp', 'key']);
const CODE_EXTS = new Set([
  'json',
  'xml',
  'yaml',
  'yml',
  'js',
  'ts',
  'tsx',
  'jsx',
  'php',
  'py',
  'java',
  'kt',
  'swift',
  'sql',
  'html',
  'htm',
  'css',
  'sh',
  'ini',
  'env',
]);
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log']);

export function isMediaThumbnailPreset(preset: ThumbnailPreset): boolean {
  return preset === 'image' || preset === 'video';
}

export function resolveClientThumbnailPreset(
  filename: string,
  mimeType?: string | null,
  category?: string | null,
  serverPreset?: string | null,
): ThumbnailPreset {
  if (serverPreset && VALID_PRESETS.has(serverPreset)) {
    return serverPreset as ThumbnailPreset;
  }

  const mime = (mimeType ?? '').toLowerCase().trim();
  const cat = (category ?? '').toLowerCase().trim();
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : '';

  if (cat === 'image' || cat === 'images' || mime.startsWith('image/')) {
    return 'image';
  }
  if (cat === 'video' || cat === 'videos' || mime.startsWith('video/')) {
    return 'video';
  }
  if (cat === 'audio' || mime.startsWith('audio/')) {
    return 'audio';
  }
  if (cat === 'archive' || ARCHIVE_EXTS.has(ext)) {
    return 'archive';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    EXCEL_EXTS.has(ext) ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'text/csv'
  ) {
    return 'excel';
  }
  if (
    WORD_EXTS.has(ext) ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('opendocument.text')
  ) {
    return 'word';
  }
  if (
    PPT_EXTS.has(ext) ||
    mime.includes('presentation') ||
    mime.includes('powerpoint')
  ) {
    return 'powerpoint';
  }
  if (
    CODE_EXTS.has(ext) ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'text/xml' ||
    mime === 'text/javascript' ||
    mime === 'application/javascript'
  ) {
    return 'code';
  }
  if (TEXT_EXTS.has(ext) || mime.startsWith('text/')) {
    return 'text';
  }
  return 'file';
}

type PresetStyle = {
  bgStart: string;
  bgEnd: string;
  badgeBg: string;
  accent: string;
  badge: string;
  isDark?: boolean;
};

const PRESET_STYLES: Record<ThumbnailPreset, PresetStyle> = {
  pdf: { bgStart: '#FEE2E2', bgEnd: '#FECACA', badgeBg: '#DC2626', accent: '#EF4444', badge: 'PDF' },
  word: { bgStart: '#DBEAFE', bgEnd: '#BFDBFE', badgeBg: '#2563EB', accent: '#3B82F6', badge: 'WORD' },
  excel: { bgStart: '#DCFCE7', bgEnd: '#BBF7D0', badgeBg: '#16A34A', accent: '#22C55E', badge: 'EXCEL' },
  powerpoint: { bgStart: '#FFEDD5', bgEnd: '#FED7AA', badgeBg: '#EA580C', accent: '#F97316', badge: 'PPT' },
  text: { bgStart: '#F1F5F9', bgEnd: '#E2E8F0', badgeBg: '#475569', accent: '#64748B', badge: 'TEXT' },
  code: { bgStart: '#CFFAFE', bgEnd: '#A5F3FC', badgeBg: '#0891B2', accent: '#06B6D4', badge: 'CODE' },
  audio: { bgStart: '#F3E8FF', bgEnd: '#E9D5FF', badgeBg: '#7C3AED', accent: '#8B5CF6', badge: 'AUDIO' },
  archive: { bgStart: '#FEF3C7', bgEnd: '#FDE68A', badgeBg: '#D97706', accent: '#F59E0B', badge: 'ZIP' },
  video: {
    bgStart: '#1E293B',
    bgEnd: '#0F172A',
    badgeBg: '#6366F1',
    accent: '#818CF6',
    badge: 'VIDEO',
    isDark: true,
  },
  image: { bgStart: '#E0E7FF', bgEnd: '#C7D2FE', badgeBg: '#4F46E5', accent: '#6366F1', badge: 'FOTO' },
  file: { bgStart: '#F1F5F9', bgEnd: '#E2E8F0', badgeBg: '#64748B', accent: '#94A3B8', badge: 'FILE' },
};

type Props = {
  preset: ThumbnailPreset;
  size: number;
  compact?: boolean;
  borderRadius?: number;
};

/**
 * Shared vector default thumbnail for documents (PDF, Word, Excel, PowerPoint, Text, Code, Audio, Archive)
 * and fallback artwork for media files. Zero network fetches, zero disk bloat, crisp at any DPR.
 */
export const DefaultFileThumbnail = memo(function DefaultFileThumbnail({
  preset,
  size,
  compact = false,
  borderRadius = 0,
}: Props) {
  const cfg = PRESET_STYLES[preset];
  const sheetFill = cfg.isDark ? '#1E293B' : '#FFFFFF';
  const sheetStroke = cfg.isDark ? '#334155' : '#E2E8F0';
  const foldFill = cfg.isDark ? '#334155' : cfg.bgEnd;
  const gradId = `thumb-bg-${preset}`;

  // Shift graphic slightly upward on non-compact grid tiles so bottom filename overlay never covers the badge
  const viewBox = compact ? '34 22 172 196' : '0 8 240 240';

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius }]}>
      <Svg width={size} height={size} viewBox={viewBox}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={cfg.bgStart} />
            <Stop offset="100%" stopColor={cfg.bgEnd} />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="240" height="248" fill={`url(#${gradId})`} />

        <Path
          d="M64 32 H144 L176 64 V192 A12 12 0 0 1 164 204 H64 A12 12 0 0 1 52 192 V44 A12 12 0 0 1 64 32 Z"
          fill={sheetFill}
          stroke={sheetStroke}
          strokeWidth={2.8}
        />
        <Path d="M144 32 V56 A8 8 0 0 0 152 64 H176 Z" fill={foldFill} />

        {preset === 'excel' ? (
          <>
            <Rect
              x="84"
              y="84"
              width="72"
              height="44"
              rx="5"
              fill="none"
              stroke={cfg.accent}
              strokeWidth={3.2}
            />
            <Line x1="84" y1="99" x2="156" y2="99" stroke={cfg.accent} strokeWidth={2.6} />
            <Line x1="84" y1="114" x2="156" y2="114" stroke={cfg.accent} strokeWidth={2.6} />
            <Line x1="112" y1="84" x2="112" y2="128" stroke={cfg.accent} strokeWidth={2.6} />
            <Line x1="136" y1="84" x2="136" y2="128" stroke={cfg.accent} strokeWidth={2.6} />
          </>
        ) : preset === 'powerpoint' ? (
          <>
            <Rect
              x="84"
              y="84"
              width="72"
              height="44"
              rx="6"
              fill={cfg.bgStart}
              stroke={cfg.accent}
              strokeWidth={3}
            />
            <Circle cx="110" cy="106" r="11" fill={cfg.accent} opacity={0.28} />
            <Path d="M110 95 A11 11 0 0 1 121 106 L110 106 Z" fill={cfg.accent} />
            <Rect x="128" y="96" width="20" height="5" rx="2.5" fill={cfg.accent} />
            <Rect x="128" y="106" width="14" height="5" rx="2.5" fill={cfg.accent} opacity={0.65} />
          </>
        ) : preset === 'code' ? (
          <>
            <Path
              d="M104 94 L90 106 L104 118"
              fill="none"
              stroke={cfg.accent}
              strokeWidth={4.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M136 94 L150 106 L136 118"
              fill="none"
              stroke={cfg.accent}
              strokeWidth={4.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Line
              x1="125"
              y1="90"
              x2="115"
              y2="122"
              stroke={cfg.accent}
              strokeWidth={3.6}
              strokeLinecap="round"
            />
          </>
        ) : preset === 'audio' ? (
          <>
            <Rect x="92" y="100" width="6" height="20" rx="3" fill={cfg.accent} />
            <Rect x="104" y="88" width="6" height="44" rx="3" fill={cfg.accent} />
            <Rect x="117" y="80" width="6" height="60" rx="3" fill={cfg.badgeBg} />
            <Rect x="130" y="90" width="6" height="40" rx="3" fill={cfg.accent} />
            <Rect x="142" y="102" width="6" height="16" rx="3" fill={cfg.accent} />
          </>
        ) : preset === 'archive' ? (
          <>
            <Rect
              x="94"
              y="82"
              width="52"
              height="48"
              rx="7"
              fill={cfg.bgStart}
              stroke={cfg.accent}
              strokeWidth={3}
            />
            <Rect x="116" y="82" width="8" height="32" fill={cfg.accent} opacity={0.25} />
            <Rect x="114" y="87" width="6" height="4" rx="1" fill={cfg.badgeBg} />
            <Rect x="120" y="93" width="6" height="4" rx="1" fill={cfg.badgeBg} />
            <Rect x="114" y="99" width="6" height="4" rx="1" fill={cfg.badgeBg} />
            <Rect x="115" y="108" width="10" height="10" rx="2.5" fill={cfg.badgeBg} />
          </>
        ) : preset === 'video' ? (
          <>
            <Circle cx="120" cy="106" r="24" fill={cfg.badgeBg} opacity={0.92} />
            <Polygon points="113,94 134,106 113,118" fill="#FFFFFF" />
          </>
        ) : preset === 'image' ? (
          <>
            <Rect
              x="86"
              y="84"
              width="68"
              height="44"
              rx="6"
              fill={cfg.bgStart}
              stroke={cfg.accent}
              strokeWidth={3}
            />
            <Circle cx="104" cy="98" r="5" fill={cfg.accent} />
            <Path
              d="M90 124 L108 106 L122 118 L134 108 L150 124 Z"
              fill={cfg.accent}
              opacity={0.78}
            />
          </>
        ) : (
          <>
            <Rect x="86" y="86" width="68" height="7.5" rx="3.75" fill={cfg.accent} opacity={0.88} />
            <Rect x="86" y="101" width="56" height="6.5" rx="3.25" fill={cfg.accent} opacity={0.48} />
            <Rect x="86" y="114" width="62" height="6.5" rx="3.25" fill={cfg.accent} opacity={0.35} />
          </>
        )}

        <Rect x="66" y="148" width="108" height="34" rx="17" fill={cfg.badgeBg} />
        <SvgText
          x="120"
          y="171"
          textAnchor="middle"
          fontSize="17"
          fontWeight="800"
          letterSpacing="0.8"
          fill="#FFFFFF">
          {cfg.badge}
        </SvgText>
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
