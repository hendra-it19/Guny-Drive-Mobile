import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { requireOptionalNativeModule } from 'expo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppUpdateModal } from '@/components/ui/AppUpdateModal';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { AppProvider, useApp } from '@/context/app-context';
import { AppThemeProvider, useAppTheme } from '@/context/theme-context';
import { isExpoGoEnvironment, requestFirstLaunchPermissions } from '@/lib/device-files';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready, scheme, palette } = useAppTheme();
  const { hydrated, credentials } = useApp();

  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const canRender = ready && hydrated && (fontsLoaded || Boolean(fontError));

  const [showSplashOverlay, setShowSplashOverlay] = useState(true);
  const [splashOpacity] = useState(() => new Animated.Value(1));
  const [logoScale] = useState(() => new Animated.Value(0.84));

  useEffect(() => {
    Animated.spring(logoScale, {
      toValue: 1,
      damping: 14,
      stiffness: 160,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [logoScale]);

  useEffect(() => {
    if (!canRender) return;
    void SplashScreen.hideAsync();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(splashOpacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1.08,
          damping: 18,
          stiffness: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowSplashOverlay(false);
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [canRender, logoScale, splashOpacity]);

  // Automatically request all required OS permissions (File System, Media, Notifications)
  // on first app launch right after installation (instead of a manual button inside screens).
  useEffect(() => {
    if (!canRender || showSplashOverlay) return;
    void requestFirstLaunchPermissions();
  }, [canRender, showSplashOverlay]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {canRender ? (
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: palette.background },
          }}>
          <Stack.Protected guard={Boolean(credentials)}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings/index" />
            <Stack.Screen name="settings/appearance" />
            <Stack.Screen name="settings/diagnostics" />
            <Stack.Screen name="trash" />
            <Stack.Screen name="explorer" />
          </Stack.Protected>
          <Stack.Screen name="settings/connect" />
        </Stack>
      ) : null}

      {canRender && !showSplashOverlay ? <AppUpdateModal /> : null}

      {showSplashOverlay ? (
        <Animated.View
          pointerEvents={canRender ? 'none' : 'auto'}
          style={[StyleSheet.absoluteFill, { opacity: splashOpacity, zIndex: 999 }]}>
          <AuroraBackdrop>
            <View style={styles.bootSplash}>
              <Animated.View
                style={[
                  styles.splashLogoWrap,
                  {
                    transform: [{ scale: logoScale }],
                  },
                ]}>
                <BrandLogo size={104} radius={28} />
                <Text style={[styles.splashTitle, { color: palette.text }]}>
                  GunyDrive
                </Text>
                <Text
                  style={[
                    styles.splashSubtitle,
                    { color: palette.textSecondary },
                  ]}>
                  Penyimpanan Cloud Pribadi
                </Text>
                <ActivityIndicator
                  color={palette.accent}
                  style={{ marginTop: 18 }}
                />
              </Animated.View>
            </View>
          </AuroraBackdrop>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bootSplash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  splashLogoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    marginTop: 18,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  splashSubtitle: {
    marginTop: 4,
    fontSize: 13.5,
    fontWeight: '600',
  },
});

export default function RootLayout() {
  const storageAvailable = Platform.OS === 'web' || !!requireOptionalNativeModule('ExpoSQLite');
  useEffect(() => {
    if (!storageAvailable) void SplashScreen.hideAsync();
  }, [storageAvailable]);

  if (!storageAvailable) {
    return (
      <View style={styles.bootSplash}>
        <Text accessibilityRole="header" style={styles.splashTitle}>SQLite belum tersedia</Text>
        <Text style={[styles.splashSubtitle, { textAlign: 'center' }]}>
          {isExpoGoEnvironment()
            ? 'Buka proyek dengan Expo Go untuk SDK 58 agar GunyDrive dapat membaca data lokal.'
            : 'Pasang pembaruan GunyDrive yang menyertakan SQLite untuk mengakses data lokal dan antrean backup.'}
        </Text>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <AppProvider>
          <RootNavigator />
        </AppProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
