import { configuredServer } from './api';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type StoredCredentials = {
  accountKey?: string;
  serverUrl: string;
  deviceToken: string;
};

export type StoredPasskey = {
  passkeyToken: string;
  email: string;
  username?: string | null;
  activatedAt: string;
};

export type NotificationPrefs = {
  backupMonitoring: boolean;
  quotaAlerts: boolean;
  securityAlerts: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  backupMonitoring: true,
  quotaAlerts: true,
  securityAlerts: true,
};

const KEY_SESSION = 'gunydrive_session_v2';
const KEY_SERVER_URL = 'gunydrive_server_url';
const KEY_DEVICE_TOKEN = 'gunydrive_device_token';
const KEY_PASSKEY = 'gunydrive_passkey_v1';
const KEY_NOTIF_PREFS = 'gunydrive_notif_prefs_v1';
const KEY_PENDING_OAUTH_VERIFIER = 'gunydrive_pending_oauth_verifier_v1';

async function readItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function readStoredSession(): Promise<StoredCredentials | null> {
  try {
    const session = await readItem(KEY_SESSION);
    if (session) return JSON.parse(session) as StoredCredentials;

    const serverUrl = await readItem(KEY_SERVER_URL);
    const deviceToken = await readItem(KEY_DEVICE_TOKEN);
    return serverUrl && deviceToken ? { serverUrl, deviceToken } : null;
  } catch {
    return null;
  }
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const session = await readStoredSession();
  if (!session) return null;
  try {
    return session.serverUrl.replace(/\/+$/, '') === configuredServer() ? session : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await writeItem(KEY_SESSION, JSON.stringify(creds));
}

export async function clearCredentials(): Promise<void> {
  await deleteItem(KEY_SESSION);
  await deleteItem(KEY_SERVER_URL);
  await deleteItem(KEY_DEVICE_TOKEN);
}

export async function loadStoredPasskey(): Promise<StoredPasskey | null> {
  const raw = await readItem(KEY_PASSKEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPasskey;
    return parsed?.passkeyToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveStoredPasskey(passkey: StoredPasskey): Promise<void> {
  await writeItem(KEY_PASSKEY, JSON.stringify(passkey));
}

export async function clearStoredPasskey(): Promise<void> {
  await deleteItem(KEY_PASSKEY);
}

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const raw = await readItem(KEY_NOTIF_PREFS);
  if (!raw) return DEFAULT_NOTIFICATION_PREFS;
  try {
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await writeItem(KEY_NOTIF_PREFS, JSON.stringify(prefs));
}

export async function savePendingOAuthVerifier(verifier: string): Promise<void> {
  await writeItem(KEY_PENDING_OAUTH_VERIFIER, verifier);
}

export async function consumePendingOAuthVerifier(): Promise<string | null> {
  const verifier = await readItem(KEY_PENDING_OAUTH_VERIFIER);
  if (verifier) {
    await deleteItem(KEY_PENDING_OAUTH_VERIFIER);
  }
  return verifier;
}
