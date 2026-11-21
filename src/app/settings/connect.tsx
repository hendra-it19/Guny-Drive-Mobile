import { useRouter } from 'expo-router';
import { CheckCircle2, ChevronLeft, Link2, ShieldAlert } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Surface } from '@/components/ui/Surface';
import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';

export default function ConnectServerScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const { credentials, me, connectServer } = useApp();

  const [serverUrl, setServerUrl] = useState(credentials?.serverUrl ?? 'http://localhost:8000');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [verifiedInfo, setVerifiedInfo] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!serverUrl.trim() || !token.trim()) {
      setErrorText('Isi alamat server dan token perangkat dari dashboard Akses API.');
      return;
    }
    setConnecting(true);
    setErrorText(null);
    setVerifiedInfo(null);
    try {
      const info = await connectServer(serverUrl, token);
      setVerifiedInfo(
        `Terhubung ke ${info.server.name} sebagai ${info.owner.name} (${info.device?.name ?? 'Perangkat'}).`,
      );
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 900);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Gagal terhubung ke server. Periksa alamat dan token.',
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => router.back()}
            style={styles.backRow}
            accessibilityRole="button">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Pengaturan
            </AppText>
          </Pressable>

          <AppText weight="extrabold" size={30} style={styles.title}>
            Hubungkan Server
          </AppText>
          <AppText size={13} color="secondary" style={{ marginBottom: 18 }}>
            Salin alamat server dan token perangkat dari menu Akses API pada dashboard Laravel Anda.
          </AppText>

          <Surface solid style={styles.formCard}>
            {me ? (
              <View style={[styles.connectedNote, { backgroundColor: palette.activeBg }]}>
                <CheckCircle2 size={17} color={palette.success} />
                <AppText weight="semibold" size={12.5} style={{ flex: 1 }}>
                  Saat ini terhubung ke {me.server.name} ({me.device?.name ?? 'Perangkat'})
                </AppText>
              </View>
            ) : null}

            <View style={styles.field}>
              <AppText weight="semibold" size={13}>
                Alamat Server (HTTPS)
              </AppText>
              <TextInput
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="https://drive.domain-anda.example"
                placeholderTextColor={palette.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.input,
                  {
                    borderColor: palette.border,
                    backgroundColor: palette.background,
                    color: palette.text,
                    fontFamily: FontFamily.medium,
                  },
                ]}
              />
            </View>

            <View style={styles.field}>
              <AppText weight="semibold" size={13}>
                Token Perangkat
              </AppText>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="gd_dev_..."
                placeholderTextColor={palette.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[
                  styles.input,
                  {
                    borderColor: palette.border,
                    backgroundColor: palette.background,
                    color: palette.text,
                    fontFamily: FontFamily.medium,
                  },
                ]}
              />
            </View>

            {errorText ? (
              <View style={styles.statusRow}>
                <ShieldAlert size={16} color={palette.danger} />
                <AppText weight="semibold" size={12.5} color="danger" style={{ flex: 1 }}>
                  {errorText}
                </AppText>
              </View>
            ) : null}

            {verifiedInfo ? (
              <View style={styles.statusRow}>
                <CheckCircle2 size={16} color={palette.success} />
                <AppText weight="semibold" size={12.5} color="success" style={{ flex: 1 }}>
                  {verifiedInfo}
                </AppText>
              </View>
            ) : null}

            <Pressable
              disabled={connecting}
              onPress={() => void handleConnect()}
              accessibilityRole="button"
              style={[styles.submitBtn, { backgroundColor: palette.accent }]}>
              {connecting ? (
                <ActivityIndicator color={palette.onAccent} />
              ) : (
                <>
                  <Link2 size={17} color={palette.onAccent} strokeWidth={2.2} />
                  <AppText weight="bold" size={15} color="onAccent">
                    Periksa &amp; Simpan Koneksi
                  </AppText>
                </>
              )}
            </Pressable>
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
  title: { letterSpacing: -0.8, marginTop: 2, marginBottom: 6 },
  formCard: { padding: 18, gap: 14 },
  connectedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  field: { gap: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtn: {
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
});
