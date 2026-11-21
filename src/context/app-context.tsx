import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as MediaLibrary from 'expo-media-library';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';

import { configuredServer, GunyDriveApi, MeResponse, UsageSummary } from '@/lib/api';
import {
  checkGitHubReleaseUpdate,
  getInstalledAppVersion,
  type GitHubReleaseInfo,
  skipReleaseVersion,
} from '@/lib/app-updater';
import {
  backupCycleActive,
  BackupRules,
  DEFAULT_BACKUP_RULES,
  loadBackupRules,
  runBackupCycle,
  runInstantNewFileBackup,
  saveBackupRules,
} from '@/lib/backup-engine';
import {
  clearCredentials,
  clearStoredPasskey,
  DEFAULT_NOTIFICATION_PREFS,
  loadCredentials,
  loadNotificationPrefs,
  loadStoredPasskey,
  NotificationPrefs,
  saveCredentials,
  saveNotificationPrefs,
  saveStoredPasskey,
  StoredCredentials,
  StoredPasskey,
} from '@/lib/credentials';
import { isExpoGoEnvironment } from '@/lib/device-files';
import { formatBytes, formatShortTime } from '@/lib/format';
import { listQueueItems, QueueItem } from '@/lib/storage';

export type AppNotificationItem = {
  id: string;
  category: 'backup' | 'quota' | 'security' | 'update';
  level: 'info' | 'success' | 'warning';
  title: string;
  body: string;
  timeLabel: string;
};

export type AppContextValue = {
  hydrated: boolean;
  appVersion: string;
  availableUpdate: GitHubReleaseInfo | null;
  updateModalOpen: boolean;
  checkingUpdate: boolean;
  lastUpdateCheckAt: number | null;
  updateCheckError: string | null;
  credentials: StoredCredentials | null;
  api: GunyDriveApi | null;
  me: MeResponse | null;
  usage: UsageSummary | null;
  authRevoked: boolean;
  backupRules: BackupRules;
  queue: QueueItem[];
  vaultToken: string | null;
  vaultExpiresAt: number | null;
  vaultUnlocked: boolean;
  passkeyInfo: StoredPasskey | null;
  notificationPrefs: NotificationPrefs;
  notifications: AppNotificationItem[];
  connectServer: (deviceToken: string) => Promise<MeResponse>;
  disconnectServer: () => Promise<void>;
  refreshServerInfo: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  updateBackupRules: (patch: Partial<BackupRules>) => Promise<void>;
  triggerBackupNow: () => Promise<void>;
  setupVault: (pin: string, pinConfirmation: string) => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: (notifyServer?: boolean) => Promise<void>;
  touchVaultActivity: () => void;
  activatePasskeyBiometric: () => Promise<void>;
  deactivatePasskeyBiometric: () => Promise<void>;
  updateNotificationPrefs: (patch: Partial<NotificationPrefs>) => Promise<void>;
  checkForAppUpdate: (manual?: boolean) => Promise<GitHubReleaseInfo | null>;
  openUpdateModal: () => void;
  closeUpdateModal: () => void;
  skipAvailableUpdate: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const appVersion = useMemo(() => getInstalledAppVersion(), []);
  const [availableUpdate, setAvailableUpdate] = useState<GitHubReleaseInfo | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [lastUpdateCheckAt, setLastUpdateCheckAt] = useState<number | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const updatePromptedVersionRef = useRef<string | null>(null);
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [authRevoked, setAuthRevoked] = useState(false);
  const [backupRules, setBackupRules] = useState<BackupRules>(DEFAULT_BACKUP_RULES);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [passkeyInfo, setPasskeyInfo] = useState<StoredPasskey | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );

  // Vault token lives strictly in memory — never written to disk!
  const [vaultToken, setVaultToken] = useState<string | null>(null);
  const [vaultExpiresAt, setVaultExpiresAt] = useState<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAuthRevoked = useCallback(() => {
    setAuthRevoked(true);
    setVaultToken(null);
    setVaultExpiresAt(null);
  }, []);

  const api = useMemo(
    () => (credentials ? new GunyDriveApi(credentials, handleAuthRevoked) : null),
    [credentials, handleAuthRevoked],
  );

  const refreshQueue = useCallback(async () => {
    const [items, rules] = await Promise.all([listQueueItems(), loadBackupRules()]);
    setQueue(items);
    setBackupRules(rules);
  }, []);

  const refreshServerInfo = useCallback(async () => {
    if (!api) return;
    try {
      const info = await api.getMe();
      setMe(info);
      setUsage(info.usage);
      setAuthRevoked(false);
    } catch {
      // Offline or unreachable — keep last known state.
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    async function init() {
      const creds = await loadCredentials();
      if (!active) return;
      setCredentials(creds);
      setHydrated(true);
      const [rules, items, savedPasskey, savedNotifs] = await Promise.all([
        loadBackupRules(),
        listQueueItems(),
        loadStoredPasskey(),
        loadNotificationPrefs(),
      ]);
      if (!active) return;
      setBackupRules(rules);
      setQueue(items);
      setPasskeyInfo(savedPasskey);
      setNotificationPrefs(savedNotifs);
      if (creds && rules.enabled && !rules.paused) {
        // Defer automatic background check until initial UI frames & taps settle completely
        setTimeout(() => {
          if (!active) return;
          if (rules.autoBackupOnNewFile) {
            void runInstantNewFileBackup(() => {
              if (active) void refreshQueue();
            });
          } else {
            void runBackupCycle(
              () => {
                if (active) void refreshQueue();
              },
              true,
              'app_open',
            );
          }
        }, 3500);
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [refreshQueue]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .getMe()
      .then((info) => {
        if (!active) return;
        setMe(info);
        setUsage(info.usage);
        setAuthRevoked(false);
      })
      .catch(() => {
        // Offline or unreachable — keep last known state.
      });
    return () => {
      active = false;
    };
  }, [api]);

  const checkForAppUpdate = useCallback(async (manual = false): Promise<GitHubReleaseInfo | null> => {
    setCheckingUpdate(true);
    if (manual) {
      setUpdateCheckError(null);
    }
    try {
      const result = await checkGitHubReleaseUpdate({ force: manual });
      if (result.checkedAt > 0) {
        setLastUpdateCheckAt(result.checkedAt);
      }
      if (result.error) {
        if (manual) setUpdateCheckError(result.error);
        return null;
      }
      if (result.updateAvailable && result.release) {
        setAvailableUpdate(result.release);
        if (manual || (!result.skipped && updatePromptedVersionRef.current !== result.release.version)) {
          updatePromptedVersionRef.current = result.release.version;
          setUpdateModalOpen(true);
        }
        return result.release;
      }
      setAvailableUpdate(null);
      return null;
    } catch (err) {
      if (manual) {
        setUpdateCheckError(
          err instanceof Error ? err.message : 'Gagal memeriksa pembaruan GitHub.',
        );
      }
      return null;
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const openUpdateModal = useCallback(() => {
    if (availableUpdate) {
      setUpdateModalOpen(true);
    }
  }, [availableUpdate]);

  const closeUpdateModal = useCallback(() => {
    setUpdateModalOpen(false);
  }, []);

  const skipAvailableUpdate = useCallback(async () => {
    if (availableUpdate) {
      await skipReleaseVersion(availableUpdate.version);
    }
    setUpdateModalOpen(false);
  }, [availableUpdate]);

  // Automatic silent check against GitHub Releases shortly after launch (never blocks startup UI)
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void checkForAppUpdate(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [checkForAppUpdate, hydrated]);

  const lockVault = useCallback(
    async (notifyServer = true) => {
      const current = vaultToken;
      setVaultToken(null);
      setVaultExpiresAt(null);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (notifyServer && current && api) {
        try {
          await api.lockVault(current);
        } catch {
          // Server session expires automatically after idle timeout if offline.
        }
      }
    },
    [api, vaultToken],
  );

  const scheduleVaultAutoLock = useCallback(
    (timeoutMs: number) => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = setTimeout(() => {
        void lockVault(true);
      }, timeoutMs);
    },
    [lockVault],
  );

  const touchVaultActivity = useCallback(() => {
    if (!vaultToken) return;
    const ttlMs = 5 * 60 * 1000;
    setVaultExpiresAt(Date.now() + ttlMs);
    scheduleVaultAutoLock(ttlMs);
  }, [scheduleVaultAutoLock, vaultToken]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' && vaultToken) {
        void lockVault(true);
      }
      if (nextState === 'active') {
        void checkForAppUpdate(false);
      }
      if (nextState === 'active' && credentials && backupRules.enabled && !backupRules.paused) {
        setTimeout(() => {
          if (backupRules.autoBackupOnNewFile) {
            void runInstantNewFileBackup(() => {
              void refreshQueue();
            });
          } else {
            void runBackupCycle(
              () => {
                void refreshQueue();
              },
              true,
              'app_open',
            );
          }
        }, 3000);
      }
    });
    return () => sub.remove();
  }, [
    backupRules.autoBackupOnNewFile,
    backupRules.enabled,
    backupRules.paused,
    checkForAppUpdate,
    credentials,
    lockVault,
    refreshQueue,
    vaultToken,
  ]);

  // Google-Photos-style real-time OS media observer: ONLY active when user turns on autoBackupOnNewFile
  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      !credentials ||
      !backupRules.enabled ||
      backupRules.paused ||
      !backupRules.autoBackupOnNewFile
    ) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = MediaLibrary.addListener(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void runInstantNewFileBackup(() => {
          void refreshQueue();
        }).then((res) => {
          if (res.uploaded > 0) {
            void refreshServerInfo();
          }
        });
      }, 2500);
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      subscription.remove();
    };
  }, [
    backupRules.autoBackupOnNewFile,
    backupRules.enabled,
    backupRules.paused,
    credentials,
    refreshQueue,
    refreshServerInfo,
  ]);

  const connectServer = useCallback(
    async (deviceToken: string) => {
      const normalized: StoredCredentials = {
        serverUrl: configuredServer(),
        deviceToken: deviceToken.trim(),
      };
      const testApi = new GunyDriveApi(normalized);
      const info = await testApi.getMe();
      if (backupCycleActive()) {
        throw Error('Tunggu proses backup saat ini selesai sebelum mengganti akun.');
      }
      normalized.accountKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        normalized.serverUrl + '|' + info.owner.id,
      );
      await lockVault(true);
      await saveCredentials(normalized);
      await refreshQueue();
      setCredentials(normalized);
      setMe(info);
      setUsage(info.usage);
      setAuthRevoked(false);
      return info;
    },
    [lockVault, refreshQueue],
  );

  const disconnectServer = useCallback(async () => {
    await lockVault(true);
    if (backupCycleActive()) throw Error('Tunggu backup selesai sebelum keluar.');
    if (api) {
      try {
        await fetch(api.serverUrl + '/api/v1/auth/session', {
          method: 'DELETE',
          headers: api.authHeaders(),
        });
      } catch {
        // Offline logout still clears local credentials.
      }
    }
    await clearCredentials();
    await refreshQueue();
    setCredentials(null);
    setMe(null);
    setUsage(null);
    setAuthRevoked(false);
  }, [api, lockVault, refreshQueue]);

  const updateBackupRules = useCallback(
    async (patch: Partial<BackupRules>) => {
      const next = { ...backupRules, ...patch };
      setBackupRules(next);
      await saveBackupRules(next);
    },
    [backupRules],
  );

  const triggerBackupNow = useCallback(async () => {
    await runBackupCycle(
      () => {
        void refreshQueue();
      },
      false,
      'manual',
    );
    await refreshQueue();
    await refreshServerInfo();
  }, [refreshQueue, refreshServerInfo]);

  const setupVault = useCallback(
    async (pin: string, pinConfirmation: string) => {
      if (!api) {
        throw new Error('Masuk ke akun terlebih dahulu sebelum membuat Folder Privat.');
      }
      const res = await api.setupVault(pin, pinConfirmation);
      const ttlMs = (res.idle_timeout_seconds || 300) * 1000;
      setVaultToken(res.vault_token);
      setVaultExpiresAt(Date.now() + ttlMs);
      scheduleVaultAutoLock(ttlMs);
      setMe((prev) => (prev ? { ...prev, vault_configured: true } : prev));
      await refreshServerInfo();
    },
    [api, refreshServerInfo, scheduleVaultAutoLock],
  );

  const unlockVault = useCallback(
    async (passphrase: string) => {
      if (!api) {
        throw new Error('Masuk ke akun terlebih dahulu sebelum membuka Folder Privat.');
      }
      const res = await api.unlockVault(passphrase);
      const ttlMs = (res.idle_timeout_seconds || 300) * 1000;
      setVaultToken(res.vault_token);
      setVaultExpiresAt(Date.now() + ttlMs);
      scheduleVaultAutoLock(ttlMs);
    },
    [api, scheduleVaultAutoLock],
  );

  const activatePasskeyBiometric = useCallback(async () => {
    if (!api || !me) {
      throw new Error('Masuk terlebih dahulu untuk mengaktifkan Passkey.');
    }

    if (Platform.OS !== 'web') {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        throw new Error(
          'Perangkat ini belum memiliki sidik jari, Face ID, atau kunci layar biometrik yang terdaftar di pengaturan OS.',
        );
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Pindai sidik jari atau wajah untuk mengaktifkan Passkey GunyDrive',
        cancelLabel: 'Batal',
        fallbackLabel: 'Gunakan PIN Perangkat',
      });

      if (!authResult.success) {
        throw new Error('Pemindaian biometrik dibatalkan atau gagal.');
      }
    }

    const res = await api.enrollPasskey();
    const stored: StoredPasskey = {
      passkeyToken: res.passkey_token,
      email: res.email || me.owner.email,
      username: res.username ?? me.owner.username,
      activatedAt: new Date().toISOString(),
    };
    await saveStoredPasskey(stored);
    setPasskeyInfo(stored);
    setMe((prev) =>
      prev
        ? {
            ...prev,
            owner: { ...prev.owner, passkey_enabled: true },
          }
        : prev,
    );
  }, [api, me]);

  const deactivatePasskeyBiometric = useCallback(async () => {
    if (api) {
      try {
        await api.disablePasskey();
      } catch {
        // Still clear local passkey
      }
    }
    await clearStoredPasskey();
    setPasskeyInfo(null);
    setMe((prev) =>
      prev
        ? {
            ...prev,
            owner: { ...prev.owner, passkey_enabled: false },
          }
        : prev,
    );
  }, [api]);

  const updateNotificationPrefs = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      const next = { ...notificationPrefs, ...patch };
      setNotificationPrefs(next);
      await saveNotificationPrefs(next);
    },
    [notificationPrefs],
  );

  const notifications = useMemo<AppNotificationItem[]>(() => {
    const list: AppNotificationItem[] = [];

    if (availableUpdate) {
      list.push({
        id: `app-update-${availableUpdate.version}`,
        category: 'update',
        level: 'info',
        title: `Pembaruan Aplikasi Tersedia: v${availableUpdate.version}`,
        body: `Versi baru GunyDrive (${availableUpdate.tagName}) tersedia di GitHub Releases. Ketuk untuk mengunduh dan memperbarui langsung.`,
        timeLabel: 'Rilis Baru',
      });
    }

    const uploading = queue.filter((i) => i.status === 'uploading');
    const pending = queue.filter((i) => i.status === 'pending');
    const completed = queue.filter((i) => i.status === 'completed');
    const failed = queue.filter((i) => i.status === 'failed');

    const ignoreStalePermDelay =
      backupRules.lastDelayAction === 'permissions' &&
      (!backupRules.enabled || (Platform.OS === 'android' && isExpoGoEnvironment()));
    const effectiveDelayReason = ignoreStalePermDelay ? null : backupRules.lastDelayReason;

    if (notificationPrefs.backupMonitoring) {
      if (uploading.length > 0 || pending.length > 0) {
        list.push({
          id: 'backup-progress',
          category: 'backup',
          level: 'info',
          title: `Monitoring Backup: ${uploading.length + pending.length} berkas dalam antrean`,
          body: uploading[0]
            ? `Sedang mengunggah "${uploading[0].filename}" (${formatBytes(uploading[0].sizeBytes)}) dengan verifikasi SHA-256.`
            : `${pending.length} berkas menunggu giliran pencadangan otomatis.`,
          timeLabel: 'Sekarang',
        });
      } else if (effectiveDelayReason) {
        list.push({
          id: 'backup-delayed',
          category: 'backup',
          level: 'warning',
          title: 'Monitoring Backup: Pencadangan Tertunda',
          body: effectiveDelayReason,
          timeLabel: 'Terbaru',
        });
      } else {
        list.push({
          id: 'backup-ok',
          category: 'backup',
          level: 'success',
          title: 'Monitoring Backup: Semua Berkas Tercadang Aman',
          body:
            completed.length > 0
              ? `${completed.length} berkas terakhir berhasil diunggah dan diverifikasi SHA-256.`
              : `Jadwal backup ${backupRules.enabled ? 'aktif' : 'nonaktif'} · Terakhir diperiksa ${backupRules.lastSuccessAt ? formatShortTime(backupRules.lastSuccessAt) : 'hari ini'}.`,
          timeLabel: backupRules.lastSuccessAt
            ? formatShortTime(backupRules.lastSuccessAt)
            : 'Hari ini',
        });
      }

      if (failed.length > 0) {
        list.push({
          id: 'backup-failed',
          category: 'backup',
          level: 'warning',
          title: `${failed.length} Berkas Perlu Diulang`,
          body: `Berkas "${failed[0].filename}" akan dicoba ulang dari offset terakhir.`,
          timeLabel: 'Antrean',
        });
      }
    }

    if (notificationPrefs.quotaAlerts && usage) {
      const pct =
        usage.quota_bytes > 0
          ? Math.round((usage.used_bytes / usage.quota_bytes) * 100)
          : 0;
      list.push({
        id: 'quota-status',
        category: 'quota',
        level: pct >= 85 ? 'warning' : 'info',
        title:
          pct >= 85
            ? `Peringatan Kuota: ${pct}% Terpakai`
            : `Status Penyimpanan: ${pct}% Terpakai`,
        body: `${formatBytes(usage.used_bytes)} dari ${formatBytes(usage.quota_bytes)} (${usage.total_files.toLocaleString('id-ID')} berkas).`,
        timeLabel: 'Kuota',
      });
    }

    if (notificationPrefs.securityAlerts) {
      const hasPasskey = Boolean(passkeyInfo || me?.owner.passkey_enabled);
      list.push({
        id: 'security-passkey',
        category: 'security',
        level: hasPasskey ? 'success' : 'info',
        title: hasPasskey
          ? 'Keamanan: Passkey Biometrik Aktif'
          : 'Tips Keamanan: Aktifkan Passkey Biometrik',
        body: hasPasskey
          ? 'Login cepat dengan sidik jari atau wajah telah aktif di perangkat ini.'
          : 'Aktifkan Passkey di halaman Profil untuk masuk cukup dengan pindai sidik jari atau wajah.',
        timeLabel: 'Keamanan',
      });
    }

    return list;
  }, [availableUpdate, backupRules, me?.owner.passkey_enabled, notificationPrefs, passkeyInfo, queue, usage]);

  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
      appVersion,
      availableUpdate,
      updateModalOpen,
      checkingUpdate,
      lastUpdateCheckAt,
      updateCheckError,
      credentials,
      api,
      me,
      usage,
      authRevoked,
      backupRules,
      queue,
      vaultToken,
      vaultExpiresAt,
      vaultUnlocked: vaultToken !== null,
      passkeyInfo,
      notificationPrefs,
      notifications,
      connectServer,
      disconnectServer,
      refreshServerInfo,
      refreshQueue,
      updateBackupRules,
      triggerBackupNow,
      setupVault,
      unlockVault,
      lockVault,
      touchVaultActivity,
      activatePasskeyBiometric,
      deactivatePasskeyBiometric,
      updateNotificationPrefs,
      checkForAppUpdate,
      openUpdateModal,
      closeUpdateModal,
      skipAvailableUpdate,
    }),
    [
      activatePasskeyBiometric,
      api,
      appVersion,
      authRevoked,
      availableUpdate,
      backupRules,
      checkForAppUpdate,
      checkingUpdate,
      closeUpdateModal,
      connectServer,
      credentials,
      deactivatePasskeyBiometric,
      disconnectServer,
      hydrated,
      lastUpdateCheckAt,
      lockVault,
      me,
      notificationPrefs,
      notifications,
      openUpdateModal,
      passkeyInfo,
      queue,
      refreshQueue,
      refreshServerInfo,
      setupVault,
      skipAvailableUpdate,
      touchVaultActivity,
      triggerBackupNow,
      unlockVault,
      updateBackupRules,
      updateCheckError,
      updateModalOpen,
      updateNotificationPrefs,
      usage,
      vaultExpiresAt,
      vaultToken,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
