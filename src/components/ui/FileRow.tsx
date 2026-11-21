import {
  Archive,
  ChevronRight,
  FileText,
  Film,
  Folder as FolderIcon,
  Image as ImageIcon,
  Lock,
  Music,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FILE_TILE_COLORS } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';

export type FileRowKind = 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive' | 'private' | 'other';

type Props = {
  kind: FileRowKind;
  title: string;
  subtitle: string;
  showDivider?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export function FileRow({ kind, title, subtitle, showDivider = false, onPress, onLongPress }: Props) {
  const { theme, palette, scheme, useGlass } = useAppTheme();
  const tilePalette = FILE_TILE_COLORS[scheme];

  const iconColor = palette.isMono
    ? palette.text
    : kind === 'document'
      ? tilePalette.pdf
      : kind === 'audio'
        ? tilePalette.audio
        : kind === 'archive'
          ? tilePalette.archive
          : kind === 'private'
            ? palette.textSecondary
            : palette.accent;

  const tileBg = palette.isMono
    ? 'transparent'
    : useGlass
      ? scheme === 'light'
        ? 'rgba(255, 255, 255, 0.72)'
        : 'rgba(255, 255, 255, 0.08)'
      : `${iconColor}1C`;

  const tileBorder = palette.isMono
    ? { borderWidth: 1.5, borderColor: palette.text }
    : useGlass
      ? {
          borderWidth: 1,
          borderColor:
            scheme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.12)',
        }
      : {};

  const renderIcon = () => {
    switch (kind) {
      case 'folder':
        return <FolderIcon size={20} color={iconColor} strokeWidth={1.8} />;
      case 'image':
        return <ImageIcon size={20} color={iconColor} strokeWidth={1.8} />;
      case 'video':
        return <Film size={20} color={iconColor} strokeWidth={1.8} />;
      case 'audio':
        return <Music size={20} color={iconColor} strokeWidth={1.8} />;
      case 'archive':
        return <Archive size={20} color={iconColor} strokeWidth={1.8} />;
      case 'private':
        return <Lock size={20} color={iconColor} strokeWidth={1.8} />;
      default:
        return <FileText size={20} color={iconColor} strokeWidth={1.8} />;
    }
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [
        styles.row,
        showDivider && { borderTopWidth: 1, borderTopColor: palette.divider },
        pressed && { opacity: 0.72 },
      ]}>
      <View
        style={[
          styles.tile,
          { borderRadius: theme.radius.md, backgroundColor: tileBg },
          tileBorder,
        ]}>
        {renderIcon()}
      </View>
      <View style={styles.grow}>
        <AppText weight="bold" size={15} numberOfLines={1}>
          {title}
        </AppText>
        <AppText weight="medium" size={12.5} color="secondary" numberOfLines={1} tabular style={{ marginTop: 2 }}>
          {subtitle}
        </AppText>
      </View>
      <ChevronRight size={18} color={palette.textSecondary} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 62,
  },
  tile: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
});
