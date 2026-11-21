import { ActionPressable } from '@/components/ui/ActionPressable';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  Activity,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Fingerprint,
  Lock,
  LogOut,
  Palette,
  ShieldCheck,
  Trash2,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Surface } from '@/components/ui/Surface';
import { Toggle } from '@/components/ui/Toggle';
import { Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { formatBytes } from '@/lib/format';

export default function SettingsScreen() {
  const router = useRouter();
  const { palette, summaryText } = useAppTheme();
  const {
    credentials,
    me,
    usage,
    passkeyInfo,
    notificationPrefs,
    notifications,
    activatePasskeyBiometric,
    deactivatePasskeyBiometric,
    updateNotificationPrefs,
    disconnectServer,
  } = useApp();

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);

  const isPasskeyActive = Boolean(passkeyInfo || me?.owner.passkey_enabled);
  const initial = (me?.owner.name?.trim().charAt(0) || 'G').toUpperCase();
  const avatarUrl = me?.owner.avatar_url;

  const usedBytes = usage?.used_bytes ?? me?.usage.used_bytes ?? 0;
  const quotaBytes = usage?.quota_bytes ?? me?.usage.quota_bytes ?? 107_374_182_400;
  const usagePct =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  const handleTogglePasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyMessage(null);
    try {
      if (isPasskeyActive) {
        await deactivatePasskeyBiometric();
        setPasskeyMessage('Passkey biometrik telah dinonaktifkan di perangkat ini.');
      } else {
        await activatePasskeyBiometric();
        setPasskeyMessage(
          'Passkey biometrik aktif! Anda kini dapat login cukup dengan sidik jari atau wajah.',
        );
      }
    } catch (err) {
      Alert.alert(
        'Passkey Biometrik',
        err instanceof Error ? err.message : 'Gagal memproses Passkey.',
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Keluar dari Akun GunyDrive?',
      'Sesi perangkat akan ditutup dari ponsel ini. Berkas yang sudah dicadangkan tetap aman.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Keluar',
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
          <ActionPressable
            onPress={() => router.back()}
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="Kembali">
            <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
            <AppText weight="semibold" size={15} color="accent">
              Kembali
            </AppText>
          </ActionPressable>

          <AppText weight="extrabold" size={32} style={styles.title}>
            Profil &amp; Pengaturan
          </AppText>

          {/* User Profile Card (with Google Avatar if available, NO server URL setting) */}
          <Surface solid style={styles.profileCard}>
            <View style={styles.profileTop}>
              <View
                style={[
                  styles.profileAvatarWrap,
                  { backgroundColor: palette.activeBg, borderColor: palette.border },
                ]}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.profileAvatarImg}
                    contentFit="cover"
                  />
                ) : (
                  <AppText weight="extrabold" size={24} color="accent">
                    {initial}
                  </AppText>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="extrabold" size={18} numberOfLines={1}>
                  {me?.owner.name ?? 'Pengguna GunyDrive'}
                </AppText>
                {me?.owner.username ? (
                  <AppText weight="semibold" size={13} color="accent">
                    @{me.owner.username}
                  </AppText>
                ) : null}
                <AppText size={12.5} color="secondary" numberOfLines={1}>
                  {me?.owner.email ?? 'Akun Pribadi'}
                </AppText>
              </View>
            </View>

            <View style={styles.quotaSection}>
              <View style={styles.quotaHeader}>
                <AppText weight="semibold" size={12.5} color="secondary">
                  Penyimpanan Akun
                </AppText>
                <AppText weight="bold" size={12.5} tabular>
                  {formatBytes(usedBytes)} / {formatBytes(quotaBytes)} ({usagePct}%)
                </AppText>
              </View>
              <View style={[styles.quotaTrack, { backgroundColor: palette.track }]}>
                <View
                  style={[
                    styles.quotaFill,
                    {
                      width: `${Math.max(4, usagePct)}%`,
                      backgroundColor: palette.accent,
                    },
                  ]}
                />
              </View>
            </View>
          </Surface>

          {/* KEAMANAN & PASSKEY (Mobile-Banking Style Biometric Passkey) */}
          <AppText
            weight="bold"
            size={12}
            color="secondary"
            style={styles.groupLabel}>
            KEAMANAN &amp; PASSKEY
          </AppText>

          <Surface>
            <View style={styles.passkeyRow}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Fingerprint size={20} color={palette.activeFg} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AppText weight="bold" size={15}>
                    Passkey Biometrik
                  </AppText>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: isPasskeyActive
                          ? `${palette.success}22`
                          : palette.activeBg,
                      },
                    ]}>
                    <AppText
                      weight="bold"
                      size={11}
                      color={isPasskeyActive ? 'success' : 'secondary'}>
                      {isPasskeyActive ? 'Aktif' : 'Nonaktif'}
                    </AppText>
                  </View>
                </View>
                <AppText size={12.5} color="secondary" style={{ marginTop: 2 }}>
                  {isPasskeyActive
                    ? 'Masuk instan dengan sidik jari atau wajah seperti mobile banking.'
                    : 'Aktifkan sekali dengan pindai sidik jari/wajah tanpa perlu keluar aplikasi.'}
                </AppText>
              </View>
              <ActionPressable
                disabled={passkeyBusy}
                onPress={() => void handleTogglePasskey()}
                accessibilityRole="button"
                style={[
                  styles.passkeyActionBtn,
                  {
                    backgroundColor: isPasskeyActive
                      ? palette.background
                      : palette.accent,
                    borderColor: isPasskeyActive ? palette.border : palette.accent,
                    borderWidth: 1,
                  },
                ]}>
                {passkeyBusy ? (
                  <ActivityIndicator
                    size="small"
                    color={isPasskeyActive ? palette.text : palette.onAccent}
                  />
                ) : (
                  <AppText
                    weight="bold"
                    size={12.5}
                    color={isPasskeyActive ? 'primary' : 'onAccent'}>
                    {isPasskeyActive ? 'Matikan' : 'Aktifkan'}
                  </AppText>
                )}
              </ActionPressable>
            </View>

            {passkeyMessage ? (
              <View
                style={[
                  styles.passkeyFeedback,
                  { borderTopColor: palette.divider },
                ]}>
                <CheckCircle2 size={15} color={palette.success} />
                <AppText size={12} color="success" weight="semibold" style={{ flex: 1 }}>
                  {passkeyMessage}
                </AppText>
              </View>
            ) : null}

            <ActionPressable
              onPress={() => router.push('/(tabs)/privat')}
              style={[
                styles.row,
                { borderTopWidth: 1, borderTopColor: palette.divider },
              ]}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Lock size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  PIN Folder Privat
                </AppText>
                <AppText size={12.5} color="secondary">
                  {me?.vault_configured
                    ? 'Folder Privat sudah dibuat dan dilindungi PIN'
                    : 'Belum dibuat · Ketuk untuk membuat PIN Folder Privat'}
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </ActionPressable>
          </Surface>

          {/* NOTIFIKASI & MONITORING BACKUP */}
          <AppText
            weight="bold"
            size={12}
            color="secondary"
            style={styles.groupLabel}>
            NOTIFIKASI &amp; MONITORING BACKUP
          </AppText>

          <Surface>
            <View style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <CloudUpload size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Monitoring Progres Backup
                </AppText>
                <AppText size={12.5} color="secondary">
                  Notifikasi antrean unggah, verifikasi SHA-256, dan jadwal tertunda
                </AppText>
              </View>
              <Toggle
                value={notificationPrefs.backupMonitoring}
                onValueChange={(next) =>
                  void updateNotificationPrefs({ backupMonitoring: next })
                }
                accessibilityLabel="Notifikasi Monitoring Progres Backup"
              />
            </View>

            <View
              style={[
                styles.row,
                { borderTopWidth: 1, borderTopColor: palette.divider },
              ]}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Bell size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Peringatan Kuota Penyimpanan
                </AppText>
                <AppText size={12.5} color="secondary">
                  Pemberitahuan penggunaan ruang penyimpanan akun
                </AppText>
              </View>
              <Toggle
                value={notificationPrefs.quotaAlerts}
                onValueChange={(next) =>
                  void updateNotificationPrefs({ quotaAlerts: next })
                }
                accessibilityLabel="Peringatan Kuota Penyimpanan"
              />
            </View>

            <View
              style={[
                styles.row,
                { borderTopWidth: 1, borderTopColor: palette.divider },
              ]}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <ShieldCheck size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Notifikasi Keamanan &amp; Perangkat
                </AppText>
                <AppText size={12.5} color="secondary">
                  Status Passkey biometrik, sesi perangkat, dan Folder Privat
                </AppText>
              </View>
              <Toggle
                value={notificationPrefs.securityAlerts}
                onValueChange={(next) =>
                  void updateNotificationPrefs({ securityAlerts: next })
                }
                accessibilityLabel="Notifikasi Keamanan dan Perangkat"
              />
            </View>

            {notifications.length > 0 ? (
              <View
                style={[
                  styles.notifListWrap,
                  { borderTopWidth: 1, borderTopColor: palette.divider },
                ]}>
                <AppText weight="bold" size={12.5} color="secondary">
                  STATUS MONITORING AKTIF ({notifications.length})
                </AppText>
                {notifications.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.notifItem,
                      {
                        backgroundColor: palette.background,
                        borderColor: palette.border,
                      },
                    ]}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}>
                      <AppText weight="bold" size={13} style={{ flex: 1 }}>
                        {item.title}
                      </AppText>
                      <AppText size={11} color="secondary">
                        {item.timeLabel}
                      </AppText>
                    </View>
                    <AppText size={12} color="secondary">
                      {item.body}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </Surface>

          {/* PERSONALISASI & PENYIMPANAN */}
          <AppText
            weight="bold"
            size={12}
            color="secondary"
            style={styles.groupLabel}>
            TAMPILAN &amp; PENYIMPANAN
          </AppText>

          <Surface>
            <ActionPressable
              onPress={() => router.push('/settings/appearance')}
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`Tampilan, saat ini ${summaryText}`}>
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Palette size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Tema &amp; Tampilan
                </AppText>
                <AppText size={12.5} color="secondary">
                  {summaryText}
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </ActionPressable>

            <ActionPressable
              onPress={() => router.push('/trash')}
              style={[
                styles.row,
                { borderTopWidth: 1, borderTopColor: palette.divider },
              ]}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Trash2 size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Sampah Penyimpanan
                </AppText>
                <AppText size={12.5} color="secondary">
                  Pulihkan atau hapus permanen berkas (retensi 30 hari)
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </ActionPressable>

            <ActionPressable
              onPress={() => router.push('/settings/diagnostics')}
              style={[
                styles.row,
                { borderTopWidth: 1, borderTopColor: palette.divider },
              ]}
              accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: palette.activeBg }]}>
                <Activity size={19} color={palette.activeFg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>
                  Log &amp; Diagnostik Backup
                </AppText>
                <AppText size={12.5} color="secondary">
                  Riwayat worker background, pemicu uji, dan folder pantauan
                </AppText>
              </View>
              <ChevronRight size={18} color={palette.textSecondary} />
            </ActionPressable>
          </Surface>

          {credentials ? (
            <View style={{ marginTop: 18 }}>
              <Surface solid>
                <ActionPressable
                  onPress={handleDisconnect}
                  style={styles.row}
                  accessibilityRole="button">
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: `${palette.danger}1C` },
                    ]}>
                    <LogOut size={19} color={palette.danger} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={15} color="danger">
                      Keluar dari Akun
                    </AppText>
                    <AppText size={12.5} color="secondary">
                      Akhiri sesi akun pada perangkat ini
                    </AppText>
                  </View>
                </ActionPressable>
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
  title: { letterSpacing: -1, marginTop: 2, marginBottom: 12 },
  profileCard: {
    padding: 16,
    gap: 14,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileAvatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImg: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  quotaSection: {
    gap: 6,
  },
  quotaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quotaTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  quotaFill: {
    height: '100%',
    borderRadius: 999,
  },
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
  passkeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  passkeyActionBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passkeyFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  notifListWrap: {
    padding: 14,
    gap: 8,
  },
  notifItem: {
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
