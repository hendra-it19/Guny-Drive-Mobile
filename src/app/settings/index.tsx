import { useRouter } from 'expo-router';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Palette,
  Server,
  Trash2,
} from 'lucide-react-native';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Surface } from '@/components/ui/Surface';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';

export default function SettingsScreen() {
  const router = useRouter();
  const { palette, summaryText } = useAppTheme();
  const { credentials, me, disconnectServer } = useApp();

  const handleDisconnect = () => {
    Alert.alert(
      'Lepas perangkat ini?',
      'Token perangkat akan dihapus dari penyimpanan aman ponsel ini. Berkas yang sudah dicadangkan di server tetap aman.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Lepas perangkat',
          style: 'destructive',
          onPress: () => {
            void disconnectServer();
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
            accessibilityRole="button"
            accessibilityLabel="Kembali">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Kembali
            </AppText>
          </Pressable>

          <AppText weight="extrabold" size={32} style={styles.title}>
            Pengaturan
          </AppText>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            PERSONALISASI
          </AppText>

          <Surface>
            <Pressable
              onPress={() => router.push('/settings/appearance')}
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`Tampilan, saat ini ${summaryText}`}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Palette size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Tampilan
                </AppText>
                <AppText size={12.5} color="secondary">
                  {summaryText}
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </Pressable>
          </Surface>

          <AppText weight="bold" size={12} color="secondary" style={styles.groupLabel}>
            SERVER &amp; PENYIMPANAN
          </AppText>

          <Surface>
            <Pressable
              onPress={() => router.push('/settings/connect')}
              style={styles.row}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Server size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  {credentials ? 'Server Terhubung' : 'Hubungkan Server'}
                </AppText>
                <AppText size={12.5} color="secondary" numberOfLines={1}>
                  {credentials
                    ? `${me?.server.name ?? 'GunyDrive'} · ${credentials.serverUrl}`
                    : 'Masukkan alamat server & token dari dashboard'}
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push('/trash')}
              style={[styles.row, { borderTopWidth: 1, borderTopColor: palette.divider }]}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Trash2 size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Sampah Server
                </AppText>
                <AppText size={12.5} color="secondary">
                  Pulihkan atau hapus permanen (retensi 30 hari)
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push('/settings/diagnostics')}
              style={[styles.row, { borderTopWidth: 1, borderTopColor: palette.divider }]}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Activity size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Diagnostik Backup &amp; Uji T02/T10
                </AppText>
                <AppText size={12.5} color="secondary">
                  Log worker OS, pemicu debug, dan folder eksperimental T18
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </Pressable>
          </Surface>

          {credentials ? (
            <View style={{ marginTop: 18 }}>
              <Surface solid>
                <Pressable
                  onPress={handleDisconnect}
                  style={styles.row}
                  accessibilityRole="button">
                  <View style={[styles.iconBox, { backgroundColor: `${palette.danger}1C` }]}>
                    <LogOut size={19} color={palette.danger} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={15} color="danger">
                      Lepas perangkat dari server
                    </AppText>
                    <AppText size={12.5} color="secondary">
                      Hapus token dari penyimpanan aman ponsel ini
                    </AppText>
                  </View>
                </Pressable>
              </Surface>
            </View>
          ) : null}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 60,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
