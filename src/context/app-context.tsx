import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { GunyDriveApi, MeResponse, UsageSummary } from '@/lib/api';
import {
  BackupRules,
  DEFAULT_BACKUP_RULES,
  loadBackupRules,
  runBackupCycle,
  saveBackupRules,
} from '@/lib/backup-engine';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  StoredCredentials,
} from '@/lib/credentials';
import { listQueueItems, QueueItem } from '@/lib/storage';

export type AppContextValue = {
  hydrated: boolean;
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
  connectServer: (serverUrl: string, deviceToken: string) => Promise<MeResponse>;
  disconnectServer: () => Promise<void>;
  refreshServerInfo: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  updateBackupRules: (patch: Partial<BackupRules>) => Promise<void>;
  triggerBackupNow: () => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: (notifyServer?: boolean) => Promise<void>;
  touchVaultActivity: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [authRevoked, setAuthRevoked] = useState(false);
  const [backupRules, setBackupRules] = useState<BackupRules>(DEFAULT_BACKUP_RULES);
  const [queue, setQueue] = useState<QueueItem[]>([]);

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
      const [creds, rules, items] = await Promise.all([
        loadCredentials(),
        loadBackupRules(),
        listQueueItems(),
      ]);
      if (!active) return;
      setCredentials(creds);
      setBackupRules(rules);
      setQueue(items);
      setHydrated(true);
      if (creds && rules.enabled && !rules.paused) {
        await runBackupCycle(() => { if (active) void refreshQueue(); }, true, 'app_open');
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

  // Lock Folder Privat on background, and re-check due backup rules when returning to foreground (T10).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' && vaultToken) {
        void lockVault(true);
      }
      if (nextState === 'active' && credentials && backupRules.enabled && !backupRules.paused) {
        void runBackupCycle(() => {
          void refreshQueue();
        }, true, 'app_open');
      }
    });
    return () => sub.remove();
  }, [backupRules.enabled, backupRules.paused, credentials, lockVault, refreshQueue, vaultToken]);

  const connectServer = useCallback(async (serverUrl: string, deviceToken: string) => {
    const normalized: StoredCredentials = {
      serverUrl: serverUrl.trim().replace(/\/+$/, ''),
      deviceToken: deviceToken.trim(),
    };
    const testApi = new GunyDriveApi(normalized);
    const info = await testApi.getMe();
    await saveCredentials(normalized);
    setCredentials(normalized);
    setMe(info);
    setUsage(info.usage);
    setAuthRevoked(false);
    return info;
  }, []);

  const disconnectServer = useCallback(async () => {
    await lockVault(true);
    await clearCredentials();
    setCredentials(null);
    setMe(null);
    setUsage(null);
    setAuthRevoked(false);
  }, [lockVault]);

  const updateBackupRules = useCallback(
    async (patch: Partial<BackupRules>) => {
      const next = { ...backupRules, ...patch };
      setBackupRules(next);
      await saveBackupRules(next);
    },
    [backupRules],
  );

  const triggerBackupNow = useCallback(async () => {
    await runBackupCycle(() => {
      void refreshQueue();
    }, true);
    await refreshQueue();
    await refreshServerInfo();
  }, [refreshQueue, refreshServerInfo]);

  const unlockVault = useCallback(
    async (passphrase: string) => {
      if (!api) {
        throw new Error('Hubungkan server terlebih dahulu sebelum membuka Folder Privat.');
      }
      const res = await api.unlockVault(passphrase);
      const ttlMs = (res.idle_timeout_seconds || 300) * 1000;
      setVaultToken(res.vault_token);
      setVaultExpiresAt(Date.now() + ttlMs);
      scheduleVaultAutoLock(ttlMs);
    },
    [api, scheduleVaultAutoLock],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
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
      connectServer,
      disconnectServer,
      refreshServerInfo,
      refreshQueue,
      updateBackupRules,
      triggerBackupNow,
      unlockVault,
      lockVault,
      touchVaultActivity,
    }),
    [
      api,
      authRevoked,
      backupRules,
      connectServer,
      credentials,
      disconnectServer,
      hydrated,
      lockVault,
      me,
      queue,
      refreshQueue,
      refreshServerInfo,
      touchVaultActivity,
      triggerBackupNow,
      unlockVault,
      updateBackupRules,
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
