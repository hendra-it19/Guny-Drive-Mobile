import { useRouter } from 'expo-router';
import { ChevronLeft, RotateCcw, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { DriveFile } from '@/lib/api';
import { formatBytes, formatShortTime } from '@/lib/format';

export default function TrashScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { api, refreshServerInfo } = useApp();

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTrash = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const res = await api.listTrash();
      setFiles(res.files);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .listTrash()
      .then((res) => {
        if (active) {
          setFiles(res.files);
        }
      })
      .catch(() => {
        // Keep last loaded trash items when offline.
      });
    return () => {
      active = false;
    };
  }, [api]);

  const handleRestore = async (file: DriveFile) => {
    if (!api) return;
    try {
      await api.restoreTrash(file.id);
      await Promise.all([loadTrash(), refreshServerInfo()]);
    } catch (err) {
      Alert.alert('Gagal memulihkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    }
  };

  const handlePurge = (file: DriveFile) => {
    if (!api) return;
    Alert.alert(
      'Hapus permanen?',
      `"${file.name}" (${formatBytes(file.size_bytes)}) akan dihapus permanen dari server dan kuota langsung dilepaskan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus permanen',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.purgeTrash(file.id);
              await Promise.all([loadTrash(), refreshServerInfo()]);
            } catch (err) {
              Alert.alert('Gagal', err instanceof Error ? err.message : 'Terjadi kesalahan.');
            }
          },
        },
      ],
    );
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backRow}
            accessibilityRole="button">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Pengaturan
            </AppText>
          </Pressable>

          <AppText weight="extrabold" size={32} style={styles.title}>
            Sampah
          </AppText>
          <AppText size={13} color="secondary" style={{ marginBottom: 16 }}>
            Berkas di Sampah tetap dihitung pada kuota hingga dihapus permanen atau melewati retensi 30 hari.
          </AppText>

          <Surface>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={palette.accent} />
              </View>
            ) : files.length === 0 ? (
              <View style={styles.center}>
                <AppText weight="bold" size={14}>
                  Sampah kosong
                </AppText>
                <AppText size={12.5} color="secondary" style={{ marginTop: 4 }}>
                  Tidak ada berkas yang menunggu penghapusan.
                </AppText>
              </View>
            ) : (
              files.map((file, idx) => (
                <View
                  key={file.id}
                  style={[
                    styles.row,
                    idx > 0 && { borderTopWidth: 1, borderTopColor: palette.divider },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={14.5} numberOfLines={1}>
                      {file.name}
                    </AppText>
                    <AppText size={12} color="secondary" tabular>
                      {formatBytes(file.size_bytes)} · Dibuang {formatShortTime(file.deleted_at)}
                    </AppText>
                  </View>
                  <Pressable
                    onPress={() => void handleRestore(file)}
                    accessibilityLabel={`Pulihkan ${file.name}`}
                    style={[styles.iconBtn, { backgroundColor: palette.activeBg }]}>
                    <RotateCcw size={17} color={palette.activeFg} />
                  </Pressable>
                  <Pressable
                    onPress={() => handlePurge(file)}
                    accessibilityLabel={`Hapus permanen ${file.name}`}
                    style={[styles.iconBtn, { backgroundColor: `${palette.danger}1C` }]}>
                    <Trash2 size={17} color={palette.danger} />
                  </Pressable>
                </View>
              ))
            )}
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
  center: { padding: 28, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
