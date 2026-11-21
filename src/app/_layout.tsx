import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider, useApp } from '@/context/app-context';
import { AppThemeProvider, useAppTheme } from '@/context/theme-context';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready, scheme, palette } = useAppTheme();
  const { hydrated } = useApp();

  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const canRender = ready && hydrated && (fontsLoaded || Boolean(fontError));

  useEffect(() => {
    if (canRender) {
      void SplashScreen.hideAsync();
    }
  }, [canRender]);

  if (!canRender) {
    return null;
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/appearance" />
        <Stack.Screen name="settings/connect" />
        <Stack.Screen name="settings/diagnostics" />
        <Stack.Screen name="trash" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
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
