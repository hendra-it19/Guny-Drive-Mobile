import { ActionPressable } from '@/components/ui/ActionPressable';
import { Image } from 'expo-image';
import { Check, Play } from 'lucide-react-native';
import React, { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/context/theme-context';
import type { DriveFile, GunyDriveApi } from '@/lib/api';
import { formatBytes } from '@/lib/format';

import { AppText } from './AppText';
import { DefaultFileThumbnail, resolveClientThumbnailPreset } from './DefaultFileThumbnail';
import type { FileGridLayout } from './FileViewToolbar';

export function getFileExtensionBadge(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'FILE').toUpperCase().slice(0, 5) : 'FILE';
}

/**
 * Returns the lightweight resized/optimized <=320px WebP/JPEG thumbnail endpoint strictly for Photos & Videos.
 * Documents (PDF, Word, Excel, PowerPoint, Text, Code, Audio, Archive) return null so they immediately render
 * the shared vector DefaultFileThumbnail with ZERO network requests and ZERO per-file disk overhead.
 */
export function getDriveFileThumbnailSource(
  api: GunyDriveApi | null,
  file: DriveFile,
  vaultToken?: string | null,
): { uri: string; headers: Record<string, string> } | null {
  if (!api) return null;
  const isMedia = file.category === 'image' || file.category === 'video';
  if (!isMedia && !file.has_custom_thumbnail) return null;
  if (file.thumbnail_status === 'failed' && !file.has_custom_thumbnail) return null;

  const raw = api.authHeaders(vaultToken);
  const headers: Record<string, string> = { Authorization: raw.Authorization };
  if (raw['X-Vault-Token']) {
    headers['X-Vault-Token'] = raw['X-Vault-Token'];
  }
  return {
    uri: api.thumbnailUrl(file.id, Boolean(file.deleted_at)),
    headers,
  };
}

type Props = {
  file: DriveFile;
  api: GunyDriveApi | null;
  size: number;
  layout: FileGridLayout;
  vaultToken?: string | null;
  selectable?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export const DriveFileGridTile = memo(function DriveFileGridTile({
  file,
  api,
  size,
  layout,
  vaultToken,
  selectable = false,
  selected = false,
  onPress,
  onLongPress,
}: Props) {
  const { palette } = useAppTheme();
  const isImage = file.category === 'image';
  const isVideo = file.category === 'video';
  const ext = getFileExtensionBadge(file.name);
  const isDense = layout === 'grid4';
  const isLarge = layout === 'grid2';

  const preset = useMemo(
    () =>
      resolveClientThumbnailPreset(
        file.name,
        file.mime_type,
        file.category,
        file.thumbnail_preset,
      ),
    [file.category, file.mime_type, file.name, file.thumbnail_preset],
  );

  // Photos & Videos load resized/optimized <=320px WebP/JPEG thumbnails from original; documents use shared SVG
  const [failedId, setFailedId] = useState<string | null>(null);
  const thumbFailed = failedId === file.id;

  const imageSource = useMemo(() => {
    if (thumbFailed) return null;
    return getDriveFileThumbnailSource(api, file, vaultToken);
  }, [api, file, thumbFailed, vaultToken]);

  const radius = isLarge ? 14 : isDense ? 8 : 12;

  return (
    <ActionPressable
      style={[
        styles.cell,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: palette.surface,
          borderColor: selected ? palette.accent : palette.border,
          borderWidth: selected ? 2.5 : 1,
        },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Buka ${file.name}`}>
      {imageSource ? (
        <Image
          source={imageSource}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={file.id}
          allowDownscaling
          decodeFormat="rgb"
          transition={80}
          onError={() => setFailedId(file.id)}
        />
      ) : (
        <DefaultFileThumbnail preset={preset} size={size} compact={isDense} />
      )}

      {isVideo && imageSource ? (
        <View
          style={[
            styles.durPill,
            { bottom: isDense ? 4 : isLarge ? 36 : 24 },
          ]}>
          <Play size={isDense ? 8 : 10} color="#fff" fill="#fff" />
          {!isDense ? (
            <AppText weight="bold" size={10} style={{ color: '#fff' }}>
              Video
            </AppText>
          ) : null}
        </View>
      ) : null}

      {selectable ? (
        <View
          style={[
            styles.selectBadge,
            {
              backgroundColor: selected ? palette.accent : 'rgba(8,11,26,0.52)',
              borderColor: selected ? palette.accent : 'rgba(255,255,255,0.85)',
            },
          ]}>
          {selected ? <Check size={12} color={palette.onAccent} strokeWidth={3} /> : null}
        </View>
      ) : null}

      {!isDense || (!isImage && !isVideo) ? (
        <View
          style={[
            styles.cellCaption,
            isLarge && { paddingHorizontal: 8, paddingVertical: 5 },
          ]}>
          <AppText
            weight="semibold"
            size={isLarge ? 11.5 : isDense ? 9 : 10}
            style={{ color: '#FFFFFF' }}
            numberOfLines={1}>
            {file.name}
          </AppText>
          {isLarge ? (
            <AppText
              weight="medium"
              size={10}
              style={{ color: 'rgba(255,255,255,0.78)', marginTop: 1 }}
              numberOfLines={1}>
              {ext} · {formatBytes(file.size_bytes)}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </ActionPressable>
  );
});

const styles = StyleSheet.create({
  cell: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
  },
  durPill: {
    position: 'absolute',
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  cellCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,11,26,0.62)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  selectBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
