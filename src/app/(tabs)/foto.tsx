import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Check, CloudUpload, Download, Play, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile } from '@/lib/api';
import { formatBytes, formatDateGroup, formatShortTime } from '@/lib/format';

type MediaTab = 'all' | 'video' | 'album';

const DEMO_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#FCD9A8', '#8B5CF6'],
  ['#9AD7F5', '#1E3A6E'],
  ['#B8F0D0', '#14532D'],
  ['#FFE3B3', '#B4386A'],
  ['#E0E7FF', '#4338CA'],
  ['#CFFAFE', '#0E5E78'],
];

export default function FotoScreen() {
  const { palette, theme } = useAppTheme();
  const { api, queue } = useApp();

  const [tab, setTab] = useState<MediaTab>('all');
  const [items, setItems] = useState<DriveFile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [limitedAccess, setLimitedAccess] = useState(false);

  const loadMedia = useCallback(async () => {
    if (Platform.OS !== 'web') {
      const perm = await MediaLibrary.getPermissionsAsync().catch(() => null);
      setLimitedAccess(perm?.accessPrivileges === 'limited');
    }
    if (!api) return;
    setLoading(true);
    try {
      const res = await api.listMedia(tab === 'video' ? 'video' : 'all');
      setItems(res.items);
      setTotalCount(res.total_count);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, [api, tab]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (Platform.OS !== 'web') {
        const perm = await MediaLibrary.getPermissionsAsync().catch(() => null);
        if (active) {
          setLimitedAccess(perm?.accessPrivileges === 'limited');
        }
      }
      if (!api) return;
      try {
        const res = await api.listMedia(tab === 'video' ? 'video' : 'all');
        if (!active) return;
        setItems(res.items);
        setTotalCount(res.total_count);
      } catch {
        // Offline fallback
      }
    })();
    return () => {
      active = false;
    };
  }, [api, tab]);

  const groups = useMemo(() => {
    const map = new Map<string, DriveFile[]>();
    for (const item of items) {
      const key = formatDateGroup(item.media_taken_at ?? item.created_at);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const pendingCount = queue.filter(
    (q) => q.sourceType === 'gallery' && (q.status === 'pending' || q.status === 'uploading'),
  ).length;

  const handleRestoreOriginal = async (file: DriveFile) => {
    if (!api) return;
    setRestoring(true);
    try {
      const { localUri } = await api.downloadAndVerify(file);
      if (Platform.OS !== 'web') {
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (perm.granted) {
          await MediaLibrary.Asset.create(localUri);
          Alert.alert('Berhasil dipulihkan', `"${file.name}" diverifikasi SHA-256 dan disimpan ke galeri perangkat.`);
        } else if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(localUri);
        }
      }
    } catch (err) {
      Alert.alert('Gagal memulihkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollPad}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void loadMedia()}
              tintColor={palette.accent}
            />
          }>
          <ScreenHeader
            title="Foto"
            subtitle={`${(api ? totalCount : 2431).toLocaleString('id-ID')} item`}
          />

          <View style={styles.section}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all', label: 'Semua' },
                { value: 'video', label: 'Video' },
                { value: 'album', label: 'Album' },
              ]}
            />

            {limitedAccess ? (
              <Surface solid style={styles.limitedBanner}>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={13}>
                    Akses foto terbatas
                  </AppText>
                  <AppText size={12} color="secondary">
                    Hanya foto pilihan Anda yang dapat dicadangkan otomatis.
                  </AppText>
                </View>
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== 'web') {
                      void MediaLibrary.presentPermissionsPicker();
                    }
                  }}>
                  <AppText weight="bold" size={13} color="accent">
                    Ubah pilihan
                  </AppText>
                </Pressable>
              </Surface>
            ) : null}

            {!api || groups.length === 0 ? (
              <View style={{ marginTop: 14 }}>
                <View style={styles.groupHead}>
                  <AppText weight="bold" size={15}>
                    {api ? 'Belum ada media tercadang' : 'Hari ini (contoh)'}
                  </AppText>
                  <View style={styles.okRow}>
                    <Check size={14} color={palette.success} strokeWidth={2.5} />
                    <AppText weight="semibold" size={12} color="success">
                      {pendingCount > 0 ? `${pendingCount} antre` : 'Tersimpan'}
                    </AppText>
                  </View>
                </View>

                {!api ? (
                  <View style={[styles.grid, { borderRadius: theme.radius.lg }]}>
                    {DEMO_GRADIENTS.map((colors, idx) => (
                      <View key={idx} style={styles.cell}>
                        <LinearGradient
                          colors={[colors[0], colors[1]]}
                          style={StyleSheet.absoluteFill}
                        />
                        {idx === 1 ? (
                          <View style={styles.durPill}>
                            <Play size={10} color="#fff" fill="#fff" />
                            <AppText weight="bold" size={11} style={{ color: '#fff' }} tabular>
                              0:42
                            </AppText>
                          </View>
                        ) : null}
                        {idx === 5 ? (
                          <View style={styles.queueBadge}>
                            <CloudUpload size={13} color="#fff" strokeWidth={2.2} />
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Surface style={styles.emptyBox}>
                    <AppText weight="semibold" size={14}>
                      Galeri server masih kosong
                    </AppText>
                    <AppText size={12.5} color="secondary" style={{ marginTop: 4, textAlign: 'center' }}>
                      Aktifkan Backup Galeri di tab Backup atau unggah foto dari tab Berkas.
                    </AppText>
                  </Surface>
                )}
              </View>
            ) : (
              groups.map(([dateLabel, list]) => (
                <View key={dateLabel} style={{ marginTop: 16 }}>
                  <View style={styles.groupHead}>
                    <AppText weight="bold" size={15}>
                      {dateLabel}
                    </AppText>
                    <View style={styles.okRow}>
                      <Check size={14} color={palette.success} strokeWidth={2.5} />
                      <AppText weight="semibold" size={12} color="success">
                        Tersimpan · {list.length}
                      </AppText>
                    </View>
                  </View>

                  <View style={[styles.grid, { borderRadius: theme.radius.lg }]}>
                    {list.map((file) => (
                      <Pressable
                        key={file.id}
                        style={styles.cell}
                        onPress={() => setSelected(file)}
                        accessibilityRole="button"
                        accessibilityLabel={`Buka ${file.name}`}>
                        {file.has_thumbnail ? (
                          <Image
                            source={{
                              uri: api.thumbnailUrl(file.id),
                              headers: api.authHeaders(),
                            }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={[
                              StyleSheet.absoluteFill,
                              styles.fallbackCell,
                              { backgroundColor: palette.surface },
                            ]}>
                            <AppText size={11} color="secondary" numberOfLines={1}>
                              {file.category === 'video' ? 'VIDEO' : 'FOTO'}
                            </AppText>
                          </View>
                        )}
                        {file.category === 'video' ? (
                          <View style={styles.durPill}>
                            <Play size={10} color="#fff" fill="#fff" />
                            <AppText weight="bold" size={10} style={{ color: '#fff' }}>
                              Video
                            </AppText>
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        {/* Fullscreen media preview modal */}
        <Modal
          visible={selected !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSelected(null)}>
          <View style={styles.previewOverlay}>
            <SafeAreaView style={styles.previewInner}>
              <View style={styles.previewTop}>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={15} style={{ color: '#FFFFFF' }} numberOfLines={1}>
                    {selected?.name}
                  </AppText>
                  <AppText size={12} style={{ color: 'rgba(255,255,255,0.75)' }} tabular>
                    {formatShortTime(selected?.media_taken_at ?? selected?.created_at)} ·{' '}
                    {formatBytes(selected?.size_bytes)} · Tersimpan di server
                  </AppText>
                </View>
                <Pressable
                  onPress={() => setSelected(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Tutup pratinjau"
                  style={styles.closeBtn}>
                  <X size={20} color="#FFFFFF" />
                </Pressable>
              </View>

              <View style={styles.previewCenter}>
                {selected && api && selected.category === 'image' ? (
                  <Image
                    source={{
                      uri: api.contentUrl(selected.id, true),
                      headers: api.authHeaders(),
                    }}
                    style={styles.fullImg}
                    contentFit="contain"
                  />
                ) : (
                  <View style={styles.noPreview}>
                    <AppText weight="bold" size={16} style={{ color: '#FFFFFF' }}>
                      {selected?.name}
                    </AppText>
                    <AppText size={13} style={{ color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>
                      {selected?.mime_type} · {formatBytes(selected?.size_bytes)}
                    </AppText>
                  </View>
                )}
              </View>

              {selected ? (
                <Pressable
                  disabled={restoring}
                  onPress={() => void handleRestoreOriginal(selected)}
                  style={[styles.restoreBtn, { backgroundColor: palette.accent }]}>
                  {restoring ? (
                    <ActivityIndicator color={palette.onAccent} />
                  ) : (
                    <>
                      <Download size={18} color={palette.onAccent} strokeWidth={2.2} />
                      <AppText weight="bold" size={14} color="onAccent">
                        Simpan salinan asli (cek SHA-256)
                      </AppText>
                    </>
                  )}
                </Pressable>
              ) : null}
            </SafeAreaView>
          </View>
        </Modal>
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingBottom: 140 },
  section: { paddingHorizontal: Spacing.screen },
  limitedBanner: {
    marginTop: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  okRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
    gap: 3,
  },
  cell: {
    width: '32.6%',
    aspectRatio: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  fallbackCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  durPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  queueBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(15,18,40,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: { padding: 24, alignItems: 'center' },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 16, 0.96)',
  },
  previewInner: {
    flex: 1,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImg: {
    width: '100%',
    height: '100%',
  },
  noPreview: {
    alignItems: 'center',
    padding: 24,
  },
  restoreBtn: {
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
