import { ActionPressable } from '@/components/ui/ActionPressable';
import { AppText } from '@/components/ui/AppText';
import {
  DefaultFileThumbnail,
  resolveClientThumbnailPreset,
} from '@/components/ui/DefaultFileThumbnail';
import { Surface } from '@/components/ui/Surface';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile, GunyDriveApi } from '@/lib/api';
import { formatBytes, formatShortTime } from '@/lib/format';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  Download,
  ExternalLink,
  FileCode2,
  Headphones,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

type ViewerKind = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'document';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'log',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
  'env',
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
  'css',
  'html',
  'htm',
  'sh',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'avif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
  '3gp',
  'm4v',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'flac',
  'opus',
  'amr',
  'wma',
]);

function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
}

function resolveViewerKind(file: DriveFile): ViewerKind {
  const ext = getFileExtension(file.name);
  const mime = (file.mime_type || '').toLowerCase();

  if (file.category === 'image' || mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (file.category === 'video' || mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  if (file.category === 'audio' || mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return 'text';
  }
  return 'document';
}

function OnlineStreamPlayer({
  uri,
  headers,
  isAudio,
  filename,
  subtitle,
}: {
  uri: string;
  headers: Record<string, string>;
  isAudio: boolean;
  filename: string;
  subtitle: string;
}) {
  const { palette } = useAppTheme();
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.play();
  });

  if (isAudio) {
    return (
      <View style={styles.audioWrapper}>
        <Surface solid style={styles.audioCard}>
          <View style={[styles.audioIconCircle, { backgroundColor: palette.activeBg }]}>
            <Headphones size={40} color={palette.accent} strokeWidth={2} />
          </View>
          <AppText weight="extrabold" size={17} style={{ textAlign: 'center', marginTop: 10 }}>
            {filename}
          </AppText>
          <AppText size={12.5} color="secondary" style={{ textAlign: 'center', marginTop: 2 }}>
            {subtitle}
          </AppText>
          <View style={styles.audioPlayerBar}>
            <VideoView
              player={player}
              nativeControls
              contentFit="contain"
              style={{ width: '100%', height: 68 }}
            />
          </View>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.videoFrame}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

type Props = {
  file: DriveFile | null;
  api: GunyDriveApi | null;
  vaultToken?: string | null;
  onClose: () => void;
  onDownload?: (file: DriveFile) => Promise<void> | void;
  onMoveToPrivate?: (file: DriveFile) => Promise<void> | void;
  onTrash?: (file: DriveFile) => Promise<void> | void;
  onRestore?: (file: DriveFile) => Promise<void> | void;
  onPurge?: (file: DriveFile) => Promise<void> | void;
};

function OnlineFileViewerContent({
  file,
  api,
  vaultToken,
  onClose,
  onDownload,
  onMoveToPrivate,
  onTrash,
  onRestore,
  onPurge,
}: Omit<Props, 'file' | 'api'> & { file: DriveFile; api: GunyDriveApi }) {
  const { palette } = useAppTheme();

  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(
    () => resolveViewerKind(file) === 'text',
  );
  const [textError, setTextError] = useState<string | null>(null);

  const [openingNative, setOpeningNative] = useState(false);
  const [cachedLocalUri, setCachedLocalUri] = useState<string | null>(null);

  const viewerKind = resolveViewerKind(file);
  const ext = getFileExtension(file.name).toUpperCase() || 'FILE';

  const loadOnlineText = useCallback(async () => {
    setTextLoading(true);
    setTextError(null);
    setTextContent(null);
    try {
      const response = await fetch(api.contentUrl(file.id, true, Boolean(file.deleted_at)), {
        method: 'GET',
        headers: {
          ...api.authHeaders(vaultToken),
          Accept: '*/*',
        },
      });
      if (!response.ok) {
        throw new Error(`Server merespons status ${response.status} saat memuat isi berkas.`);
      }
      const rawText = await response.text();
      if (getFileExtension(file.name) === 'json') {
        try {
          setTextContent(JSON.stringify(JSON.parse(rawText), null, 2));
        } catch {
          setTextContent(rawText);
        }
      } else {
        setTextContent(rawText);
      }
    } catch (err) {
      setTextError(
        err instanceof Error ? err.message : 'Gagal memuat pratinjau teks secara online.',
      );
    } finally {
      setTextLoading(false);
    }
  }, [api, file, vaultToken]);

  useEffect(() => {
    if (viewerKind !== 'text') return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(api.contentUrl(file.id, true), {
          method: 'GET',
          headers: {
            ...api.authHeaders(vaultToken),
            Accept: '*/*',
          },
        });
        if (!response.ok) {
          throw new Error(`Server merespons status ${response.status} saat memuat isi berkas.`);
        }
        const rawText = await response.text();
        if (!active) return;
        if (getFileExtension(file.name) === 'json') {
          try {
            setTextContent(JSON.stringify(JSON.parse(rawText), null, 2));
          } catch {
            setTextContent(rawText);
          }
        } else {
          setTextContent(rawText);
        }
      } catch (err) {
        if (!active) return;
        setTextError(
          err instanceof Error ? err.message : 'Gagal memuat pratinjau teks secara online.',
        );
      } finally {
        if (active) {
          setTextLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, file, vaultToken, viewerKind]);

  const handleOpenInNativeReader = async () => {
    setOpeningNative(true);
    try {
      let localUri = cachedLocalUri;
      if (!localUri) {
        const downloaded = await api.downloadAndVerify(file, vaultToken);
        localUri = downloaded.localUri;
        setCachedLocalUri(localUri);
      }

      if (Platform.OS !== 'web') {
        const localFile = new File(localUri);
        try {
          await localFile.preview({
            title: file.name,
            mimeType: file.mime_type || undefined,
          });
          return;
        } catch {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(localUri, {
              dialogTitle: `Buka ${file.name}`,
              mimeType: file.mime_type || undefined,
            });
            return;
          }
        }
      }

      Alert.alert(
        'Berkas Siap Dibuka',
        `Berkas terverifikasi SHA-256 disimpan di: ${localUri}`,
      );
    } catch (err) {
      Alert.alert(
        'Gagal Membuka Pembaca Berkas',
        err instanceof Error
          ? err.message
          : 'Pastikan aplikasi pembaca dokumen (seperti PDF Viewer / Office) tersedia di perangkat.',
      );
    } finally {
      setOpeningNative(false);
    }
  };

  const streamUrl = api.contentUrl(file.id, true, Boolean(file.deleted_at));
  const headers = api.authHeaders(vaultToken);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: palette.background }]}
      edges={['top', 'bottom']}>
        {/* Top Viewer Bar */}
        <View
          style={[
            styles.topBar,
            {
              backgroundColor: palette.surface,
              borderBottomColor: palette.divider,
            },
          ]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <AppText weight="extrabold" size={16} numberOfLines={1}>
              {file.name}
            </AppText>
            <AppText size={12} color="secondary" numberOfLines={1} tabular>
              {ext} · {formatBytes(file.size_bytes)} · {formatShortTime(file.created_at)}
            </AppText>
          </View>
          <ActionPressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Tutup pratinjau berkas"
            style={[styles.iconCircle, { backgroundColor: palette.activeBg }]}>
            <X size={20} color={palette.accent} />
          </ActionPressable>
        </View>

        {/* Main Viewer / Reader Area */}
        <View style={styles.viewerBody}>
          {viewerKind === 'image' ? (
            <View style={styles.mediaDarkStage}>
              <Image
                source={{ uri: streamUrl, headers }}
                style={styles.fullImage}
                contentFit="contain"
                onLoadEnd={() => setImageLoading(false)}
                onError={() => {
                  setImageLoading(false);
                  setImageFailed(true);
                }}
              />
              {imageLoading ? (
                <View style={styles.centerOverlay}>
                  <ActivityIndicator size="large" color={palette.accent} />
                  <AppText size={12.5} style={{ color: '#FFFFFF', marginTop: 8 }}>
                    Memuat gambar dari server…
                  </AppText>
                </View>
              ) : null}
              {imageFailed ? (
                <View style={styles.centerOverlay}>
                  <AppText weight="bold" size={14} style={{ color: '#FFFFFF' }}>
                    Pratinjau gambar langsung gagal dimuat
                  </AppText>
                  <ActionPressable
                    onPress={() => void handleOpenInNativeReader()}
                    style={[styles.primaryPill, { backgroundColor: palette.accent, marginTop: 12 }]}>
                    <ExternalLink size={16} color={palette.onAccent} />
                    <AppText weight="bold" size={13.5} color="onAccent">
                      Buka dengan Galeri Perangkat
                    </AppText>
                  </ActionPressable>
                </View>
              ) : null}
            </View>
          ) : viewerKind === 'video' || viewerKind === 'audio' ? (
            <OnlineStreamPlayer
              key={file.id}
              uri={streamUrl}
              headers={headers}
              isAudio={viewerKind === 'audio'}
              filename={file.name}
              subtitle={`${ext} · ${formatBytes(file.size_bytes)} · Streaming Online`}
            />
          ) : viewerKind === 'text' ? (
            <View style={styles.readerContainer}>
              {textLoading ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="large" color={palette.accent} />
                  <AppText size={13} color="secondary" style={{ marginTop: 10 }}>
                    Membaca isi dokumen online…
                  </AppText>
                </View>
              ) : textError ? (
                <View style={styles.centerBox}>
                  <AppText weight="bold" size={14} color="danger" style={{ textAlign: 'center' }}>
                    {textError}
                  </AppText>
                  <ActionPressable
                    onPress={() => void loadOnlineText()}
                    style={[styles.primaryPill, { backgroundColor: palette.accent, marginTop: 12 }]}>
                    <RefreshCw size={15} color={palette.onAccent} />
                    <AppText weight="bold" size={13} color="onAccent">
                      Muat Ulang
                    </AppText>
                  </ActionPressable>
                </View>
              ) : (
                <ScrollView
                  style={styles.textScroll}
                  contentContainerStyle={styles.textScrollPad}>
                  <Surface solid style={styles.textPaper}>
                    <View style={styles.readerBadgeRow}>
                      <FileCode2 size={15} color={palette.accent} />
                      <AppText weight="bold" size={12} color="accent">
                        Pembaca Dokumen Online · {ext}
                      </AppText>
                    </View>
                    <AppText
                      selectable
                      size={13.5}
                      style={[
                        styles.codeText,
                        {
                          color: palette.text,
                          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        },
                      ]}>
                      {textContent && textContent.length > 0
                        ? textContent
                        : '(Dokumen kosong)'}
                    </AppText>
                  </Surface>
                </ScrollView>
              )}
            </View>
          ) : viewerKind === 'pdf' && Platform.OS === 'ios' ? (
            <WebView
              source={{ uri: streamUrl, headers }}
              style={{ flex: 1 }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.centerOverlayLight}>
                  <ActivityIndicator size="large" color={palette.accent} />
                  <AppText size={13} color="secondary" style={{ marginTop: 8 }}>
                    Membuka dokumen PDF online…
                  </AppText>
                </View>
              )}
            />
          ) : (
            /* PDF on Android & Office / Archive / Binary Document Viewer Card */
            <ScrollView contentContainerStyle={styles.docCardScroll}>
              <Surface solid style={styles.docReaderCard}>
                <View style={styles.docHeroIcon}>
                  <DefaultFileThumbnail
                    preset={resolveClientThumbnailPreset(
                      file.name,
                      file.mime_type,
                      file.category,
                      file.thumbnail_preset,
                    )}
                    size={90}
                    borderRadius={22}
                  />
                </View>
                <AppText weight="extrabold" size={18} style={{ textAlign: 'center' }}>
                  {file.name}
                </AppText>
                <AppText size={13} color="secondary" style={{ textAlign: 'center' }}>
                  {file.mime_type || 'Dokumen'} · {formatBytes(file.size_bytes)}
                </AppText>

                <View
                  style={[
                    styles.metaBox,
                    { backgroundColor: palette.background, borderColor: palette.border },
                  ]}>
                  <View style={styles.metaRow}>
                    <ShieldCheck size={15} color={palette.success} />
                    <AppText size={12} color="secondary" style={{ flex: 1 }}>
                      Terverifikasi SHA-256:{' '}
                      <AppText weight="bold" size={12} tabular>
                        {file.sha256.slice(0, 16)}…
                      </AppText>
                    </AppText>
                  </View>
                  <AppText size={12} color="secondary">
                    {viewerKind === 'pdf'
                      ? 'Ketuk tombol di bawah untuk membuka dokumen PDF ini langsung di pembaca PDF perangkat Anda secara aman.'
                      : 'Ketuk tombol di bawah untuk membuka berkas ini langsung menggunakan aplikasi pembaca dokumen (Office / PDF / Viewer) pada perangkat Anda.'}
                  </AppText>
                </View>

                <ActionPressable
                  disabled={openingNative}
                  onPress={() => void handleOpenInNativeReader()}
                  style={[styles.openReaderBtn, { backgroundColor: palette.accent }]}>
                  {openingNative ? (
                    <>
                      <ActivityIndicator color={palette.onAccent} size="small" />
                      <AppText weight="bold" size={14.5} color="onAccent">
                        Menyiapkan Pembaca Berkas…
                      </AppText>
                    </>
                  ) : (
                    <>
                      <ExternalLink size={18} color={palette.onAccent} strokeWidth={2.2} />
                      <AppText weight="bold" size={14.5} color="onAccent">
                        {viewerKind === 'pdf'
                          ? 'Buka di Pembaca PDF'
                          : 'Buka di Pembaca Dokumen / Viewer'}
                      </AppText>
                    </>
                  )}
                </ActionPressable>
              </Surface>
            </ScrollView>
          )}
        </View>

        {/* Bottom Action Toolbar */}
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: palette.surface,
              borderTopColor: palette.divider,
            },
          ]}>
          <ActionPressable
            disabled={openingNative}
            onPress={() => void handleOpenInNativeReader()}
            style={styles.toolBtn}>
            <ExternalLink size={18} color={palette.accent} />
            <AppText weight="bold" size={11.5} color="accent">
              Buka App
            </AppText>
          </ActionPressable>

          {onDownload ? (
            <ActionPressable onPress={() => void onDownload(file)} style={styles.toolBtn}>
              <Download size={18} color={palette.accent} />
              <AppText weight="bold" size={11.5} color="accent">
                Unduh
              </AppText>
            </ActionPressable>
          ) : null}

          {onMoveToPrivate && file.space === 'regular' ? (
            <ActionPressable onPress={() => void onMoveToPrivate(file)} style={styles.toolBtn}>
              <Lock size={18} color={palette.accent} />
              <AppText weight="bold" size={11.5} color="accent">
                Ke Privat
              </AppText>
            </ActionPressable>
          ) : null}

          {onRestore && file.deleted_at ? (
            <ActionPressable onPress={() => void onRestore(file)} style={styles.toolBtn}>
              <RotateCcw size={18} color={palette.success} />
              <AppText weight="bold" size={11.5} color="success">
                Pulihkan
              </AppText>
            </ActionPressable>
          ) : null}

          {onPurge && file.deleted_at ? (
            <ActionPressable onPress={() => void onPurge(file)} style={styles.toolBtn}>
              <Trash2 size={18} color={palette.danger} />
              <AppText weight="bold" size={11.5} color="danger">
                Hapus
              </AppText>
            </ActionPressable>
          ) : null}

          {onTrash && !file.deleted_at ? (
            <ActionPressable onPress={() => void onTrash(file)} style={styles.toolBtn}>
              <Trash2 size={18} color={palette.danger} />
              <AppText weight="bold" size={11.5} color="danger">
                Sampah
              </AppText>
            </ActionPressable>
          ) : null}
        </View>
      </SafeAreaView>
  );
}

export function OnlineFileViewerModal(props: Props) {
  if (!props.file || !props.api) return null;

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={props.onClose}>
      <OnlineFileViewerContent
        key={props.file.id}
        file={props.file}
        api={props.api}
        vaultToken={props.vaultToken}
        onClose={props.onClose}
        onDownload={props.onDownload}
        onMoveToPrivate={props.onMoveToPrivate}
        onTrash={props.onTrash}
        onRestore={props.onRestore}
        onPurge={props.onPurge}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBody: {
    flex: 1,
  },
  mediaDarkStage: {
    flex: 1,
    backgroundColor: '#070A16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  videoFrame: {
    flex: 1,
    backgroundColor: '#070A16',
    justifyContent: 'center',
  },
  audioWrapper: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  audioCard: {
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  audioIconCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioPlayerBar: {
    width: '100%',
    marginTop: 18,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0D1226',
  },
  readerContainer: {
    flex: 1,
  },
  textScroll: {
    flex: 1,
  },
  textScrollPad: {
    padding: 16,
    paddingBottom: 32,
  },
  textPaper: {
    padding: 16,
    gap: 12,
  },
  readerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeText: {
    lineHeight: 20,
    fontFamily: FontFamily.regular,
  },
  docCardScroll: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },
  docReaderCard: {
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  docHeroIcon: {
    width: 82,
    height: 82,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  metaBox: {
    width: '100%',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    marginTop: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  openReaderBtn: {
    width: '100%',
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  primaryPill: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centerOverlayLight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  toolBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 68,
    paddingVertical: 4,
  },
});
