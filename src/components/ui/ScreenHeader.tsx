import { ActionPressable } from '@/components/ui/ActionPressable';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ArrowUpCircle,
  Bell,
  Check,
  CheckCircle2,
  CloudUpload,
  Moon,
  Palette,
  ShieldCheck,
  Smartphone,
  Sun,
  X,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Spacing, THEME_LIST } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';

import { AppText } from './AppText';
import { BrandLogo } from './BrandLogo';
import { Segmented } from './Segmented';
import { Surface } from './Surface';

type Props = {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, rightElement }: Props) {
  const router = useRouter();
  const { me, notifications, openUpdateModal } = useApp();
  const { palette, themeId, mode, setThemeId, setMode } = useAppTheme();

  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [notifSheetOpen, setNotifSheetOpen] = useState(false);

  const initial = (me?.owner.name?.trim().charAt(0) || 'G').toUpperCase();
  const avatarUrl = me?.owner.avatar_url;
  const hasWarningNotif = notifications.some((n) => n.level === 'warning');

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <BrandLogo size={30} iconSize={17} radius={10} />
          <AppText weight="bold" size={16} style={{ letterSpacing: -0.2 }}>
            GunyDrive
          </AppText>
        </View>

        <View style={styles.actionsRow}>
          {/* Quick Theme Switcher Button next to Profile */}
          <ActionPressable
            onPress={() => setThemeSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Ganti Tema dan Mode Warna"
            hitSlop={6}>
            <Surface pill style={styles.iconCircle}>
              <Palette size={18} color={palette.accent} strokeWidth={2.1} />
            </Surface>
          </ActionPressable>

          {/* Notification & Backup Monitoring Button */}
          <ActionPressable
            onPress={() => setNotifSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Notifikasi dan Monitoring Backup"
            hitSlop={6}>
            <Surface pill style={styles.iconCircle}>
              <Bell size={18} color={palette.text} strokeWidth={2} />
              {notifications.length > 0 ? (
                <View
                  style={[
                    styles.notifDot,
                    {
                      backgroundColor: hasWarningNotif
                        ? palette.warning
                        : palette.accent,
                    },
                  ]}
                />
              ) : null}
            </Surface>
          </ActionPressable>

          {/* Profile Button with Google Avatar -> jumps straight to Pengaturan tab */}
          <Pressable
            onPress={() => router.push('/(tabs)/backup')}
            accessibilityRole="button"
            accessibilityLabel="Buka Akun dan Pengaturan"
            hitSlop={6}>
            <Surface pill style={styles.avatar}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <AppText weight="bold" size={15} color="accent">
                  {initial}
                </AppText>
              )}
            </Surface>
          </Pressable>
        </View>
      </View>

      <View style={styles.titleRow}>
        <AppText
          weight="extrabold"
          size={32}
          numberOfLines={1}
          style={{ letterSpacing: -1, lineHeight: 38, flexShrink: 1 }}
          accessibilityRole="header">
          {title}
        </AppText>
        {rightElement ??
          (subtitle ? (
            <AppText
              weight="medium"
              size={13}
              color="secondary"
              numberOfLines={1}
              style={{ flexShrink: 1, textAlign: 'right' }}
              tabular>
              {subtitle}
            </AppText>
          ) : null)}
      </View>

      {/* Quick Theme Switcher Modal */}
      <Modal
        visible={themeSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setThemeSheetOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setThemeSheetOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <Surface solid style={styles.sheetCard}>
              <View style={styles.sheetHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Palette size={19} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="extrabold" size={18}>
                    Tema &amp; Tampilan Cepat
                  </AppText>
                </View>
                <ActionPressable
                  onPress={() => setThemeSheetOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Tutup menu tema">
                  <X size={20} color={palette.textSecondary} />
                </ActionPressable>
              </View>

              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: 'system',
                    label: 'Sistem',
                    icon: (
                      <Smartphone
                        size={14}
                        color={
                          mode === 'system'
                            ? palette.segActiveFg
                            : palette.textSecondary
                        }
                      />
                    ),
                  },
                  {
                    value: 'light',
                    label: 'Terang',
                    icon: (
                      <Sun
                        size={14}
                        color={
                          mode === 'light'
                            ? palette.segActiveFg
                            : palette.textSecondary
                        }
                      />
                    ),
                  },
                  {
                    value: 'dark',
                    label: 'Gelap',
                    icon: (
                      <Moon
                        size={14}
                        color={
                          mode === 'dark'
                            ? palette.segActiveFg
                            : palette.textSecondary
                        }
                      />
                    ),
                  },
                ]}
              />

              <View style={{ gap: 6, marginTop: 4 }}>
                {THEME_LIST.map((item) => {
                  const selected = item.id === themeId;
                  return (
                    <ActionPressable
                      key={item.id}
                      onPress={() => setThemeId(item.id)}
                      accessibilityRole="button"
                      style={[
                        styles.themeOptionRow,
                        {
                          backgroundColor: selected
                            ? palette.activeBg
                            : palette.background,
                          borderColor: selected ? palette.accent : palette.border,
                        },
                      ]}>
                      <View style={{ flex: 1 }}>
                        <AppText
                          weight="bold"
                          size={14}
                          color={selected ? 'accent' : 'primary'}>
                          {item.name}
                        </AppText>
                        <AppText size={12} color="secondary">
                          {item.description}
                        </AppText>
                      </View>
                      {selected ? (
                        <Check size={17} color={palette.accent} strokeWidth={2.5} />
                      ) : null}
                    </ActionPressable>
                  );
                })}
              </View>
            </Surface>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Notification & Backup Monitoring Modal */}
      <Modal
        visible={notifSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifSheetOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setNotifSheetOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <Surface solid style={styles.sheetCard}>
              <View style={styles.sheetHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Bell size={19} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="extrabold" size={18}>
                    Notifikasi &amp; Monitoring
                  </AppText>
                </View>
                <ActionPressable
                  onPress={() => setNotifSheetOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Tutup notifikasi">
                  <X size={20} color={palette.textSecondary} />
                </ActionPressable>
              </View>

              <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 10 }}>
                {notifications.length === 0 ? (
                  <AppText size={13} color="secondary" style={{ paddingVertical: 12 }}>
                    Belum ada notifikasi baru.
                  </AppText>
                ) : (
                  notifications.map((item) => {
                    const Icon =
                      item.category === 'update'
                        ? ArrowUpCircle
                        : item.category === 'backup'
                          ? CloudUpload
                          : item.category === 'security'
                            ? ShieldCheck
                            : CheckCircle2;
                    const tint =
                      item.level === 'warning'
                        ? palette.warning
                        : item.level === 'success'
                          ? palette.success
                          : palette.accent;
                    const cardContent = (
                      <>
                        <View
                          style={[
                            styles.notifIconWrap,
                            { backgroundColor: palette.activeBg },
                          ]}>
                          <Icon size={17} color={tint} strokeWidth={2.1} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
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
                      </>
                    );

                    if (item.category === 'update') {
                      return (
                        <ActionPressable
                          key={item.id}
                          onPress={() => {
                            setNotifSheetOpen(false);
                            openUpdateModal();
                          }}
                          style={[
                            styles.notifCard,
                            {
                              backgroundColor: palette.activeBg,
                              borderColor: palette.accent,
                            },
                          ]}>
                          {cardContent}
                        </ActionPressable>
                      );
                    }

                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.notifCard,
                          {
                            backgroundColor: palette.background,
                            borderColor: palette.border,
                          },
                        ]}>
                        {cardContent}
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <ActionPressable
                onPress={() => {
                  setNotifSheetOpen(false);
                  router.push('/(tabs)/backup');
                }}
                style={[styles.manageNotifBtn, { borderColor: palette.border }]}>
                <AppText weight="bold" size={13} color="accent">
                  Atur Preferensi Notifikasi di Pengaturan
                </AppText>
              </ActionPressable>
            </Surface>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.screen,
    paddingTop: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  sheetCard: {
    padding: 18,
    gap: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  themeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  notifIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  manageNotifBtn: {
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
});
