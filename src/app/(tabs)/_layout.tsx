import { Tabs } from 'expo-router';
import React from 'react';

import { FloatingTabBar } from '@/components/ui/FloatingTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Berkas' }} />
      <Tabs.Screen name="foto" options={{ title: 'Foto' }} />
      <Tabs.Screen name="backup" options={{ title: 'Backup' }} />
      <Tabs.Screen name="privat" options={{ title: 'Privat' }} />
    </Tabs>
  );
}
