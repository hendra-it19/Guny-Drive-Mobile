import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type StoredCredentials = {
  serverUrl: string;
  deviceToken: string;
};

const KEY_SERVER_URL = 'gunydrive_server_url';
const KEY_DEVICE_TOKEN = 'gunydrive_device_token';

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return null;
      const serverUrl = localStorage.getItem(KEY_SERVER_URL);
      const deviceToken = localStorage.getItem(KEY_DEVICE_TOKEN);
      return serverUrl && deviceToken ? { serverUrl, deviceToken } : null;
    }

    const serverUrl = await SecureStore.getItemAsync(KEY_SERVER_URL);
    const deviceToken = await SecureStore.getItemAsync(KEY_DEVICE_TOKEN);
    return serverUrl && deviceToken ? { serverUrl, deviceToken } : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  const normalizedUrl = creds.serverUrl.trim().replace(/\/+$/, '');
  const token = creds.deviceToken.trim();

  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY_SERVER_URL, normalizedUrl);
      localStorage.setItem(KEY_DEVICE_TOKEN, token);
    }
    return;
  }

  await SecureStore.setItemAsync(KEY_SERVER_URL, normalizedUrl);
  await SecureStore.setItemAsync(KEY_DEVICE_TOKEN, token);
}

export async function clearCredentials(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(KEY_SERVER_URL);
      localStorage.removeItem(KEY_DEVICE_TOKEN);
    }
    return;
  }

  await SecureStore.deleteItemAsync(KEY_SERVER_URL);
  await SecureStore.deleteItemAsync(KEY_DEVICE_TOKEN);
}
