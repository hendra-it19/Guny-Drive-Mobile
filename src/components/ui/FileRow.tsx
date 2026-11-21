import { ActionPressable } from '@/components/ui/ActionPressable';
import { Image } from 'expo-image';
import {
  CheckSquare,
  ChevronRight,
  Folder as FolderIcon,
  Lock,
  Square,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import {
  DefaultFileThumbnail,
  resolveClientThumbnailPreset,
  type ThumbnailPreset,
} from './DefaultFileThumbnail';

export type FileRowKind = 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive' | 'private' | 'other';

type Props = {
  kind: FileRowKind;
  title: string;
  subtitle: string;
  mimeType?: string | null;
  thumbnailPreset?: ThumbnailPreset | null;
  thumbnailSource?: { uri: string; headers?: Record<string, string> } | null;
  showDivider?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export function FileRow({
  kind,
  title,
  subtitle,
  mimeType,
  thumbnailPreset,
  thumbnailSource,
  showDivider = false,
  selectable = false,
  selected = false,
  onPress,
  onLongPress,
}: Props) {
  const { theme, palette, scheme, useGlass } = useAppTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const thumbFailed = Boolean(thumbnailSource?.uri && failedUri === thumbnailSource.uri);

  const isFolderOrShortcut =
    kind === 'folder' || (kind === 'private' && !mimeType && !thumbnailPreset);

  const resolvedPreset = useMemo(
    () =>
      isFolderOrShortcut
        ? null
        : resolveClientThumbnailPreset(title, mimeType, kind === 'private' ? undefined : kind, thumbnailPreset),
    [isFolderOrShortcut, kind, mimeType, thumbnailPreset, title],
  );

  const iconColor = palette.isMono
    ? palette.text
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

  return (
    <ActionPressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [
        styles.row,
        showDivider && { borderTopWidth: 1, borderTopColor: palette.divider },
        selected && { backgroundColor: palette.activeBg },
        pressed && { opacity: 0.72 },
      ]}>
      {selectable ? (
        <View style={{ marginRight: -2 }}>
          {selected ? (
            <CheckSquare size={20} color={palette.accent} strokeWidth={2.2} />
          ) : (
            <Square size={20} color={palette.textSecondary} strokeWidth={1.8} />
          )}
        </View>
      ) : null}
      <View
        style={[
          styles.tile,
          { borderRadius: theme.radius.md, backgroundColor: tileBg, overflow: 'hidden' },
          tileBorder,
        ]}>
        {thumbnailSource && !thumbFailed ? (
          <Image
            source={thumbnailSource}
            style={{ width: 42, height: 42 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            allowDownscaling
            decodeFormat="rgb"
            onError={() => setFailedUri(thumbnailSource.uri)}
          />
        ) : resolvedPreset ? (
          <DefaultFileThumbnail preset={resolvedPreset} size={42} compact />
        ) : kind === 'folder' ? (
          <FolderIcon size={20} color={iconColor} strokeWidth={1.8} />
        ) : (
          <Lock size={20} color={iconColor} strokeWidth={1.8} />
        )}
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
    </ActionPressable>
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
