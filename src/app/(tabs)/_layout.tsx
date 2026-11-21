import { Tabs } from 'expo-router';
import React from 'react';

import { FloatingTabBar } from '@/components/ui/FloatingTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        animation: 'shift',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Berkas' }} />
      <Tabs.Screen name="foto" options={{ title: 'File' }} />
      <Tabs.Screen name="privat" options={{ title: 'Privat' }} />
      <Tabs.Screen name="backup" options={{ title: 'Pengaturan' }} />
    </Tabs>
  );
}
