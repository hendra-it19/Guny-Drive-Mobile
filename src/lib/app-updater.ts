import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { Linking, Platform } from 'react-native';

import { deviceCatalog } from './device-catalog';
import { getPref, setPref } from './storage';

export type GitHubReleaseAsset = {
  name: string;
  downloadUrl: string;
  sizeBytes: number;
  contentType: string;
};

export type GitHubReleaseInfo = {
  repo: string;
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt: string | null;
  htmlUrl: string;
  apkAsset: GitHubReleaseAsset | null;
};

export type UpdateDownloadProgress = {
  bytesWritten: number;
  totalBytes: number;
  percent: number;
};

type UpdatePrefState = {
  lastCheckedAt: number;
  skippedVersion: string | null;
  cachedRelease: GitHubReleaseInfo | null;
};

const UPDATE_PREF_KEY = 'app_update_pref_v1';
const AUTO_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_GITHUB_REPOS = [
  'hendra-it19/Guny-Drive-Mobile',
  'hendra-it19/Guny-Drive',
];

const DEFAULT_PREF: UpdatePrefState = {
  lastCheckedAt: 0,
  skippedVersion: null,
  cachedRelease: null,
};

export function getInstalledAppVersion(): string {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '1.0.0';
  return normalizeVersion(version) || '1.0.0';
}

export function getConfiguredReleaseRepos(): string[] {
  const envRepo = process.env.EXPO_PUBLIC_GITHUB_REPO?.trim();
  const extraRepos = (Constants.expoConfig?.extra as { githubReleaseRepos?: unknown } | undefined)
    ?.githubReleaseRepos;

  const list: string[] = [];
  if (envRepo && /^[^/\s]+\/[^/\s]+$/.test(envRepo)) {
    list.push(envRepo);
  }
  if (Array.isArray(extraRepos)) {
    for (const item of extraRepos) {
      if (typeof item === 'string' && /^[^/\s]+\/[^/\s]+$/.test(item.trim())) {
        const clean = item.trim();
        if (!list.includes(clean)) list.push(clean);
      }
    }
  }
  for (const fallback of DEFAULT_GITHUB_REPOS) {
    if (!list.includes(fallback)) list.push(fallback);
  }
  return list;
}

export function normalizeVersion(raw: string): string {
  const cleaned = raw.trim().replace(/^[vV]+/, '');
  const match = cleaned.match(/^(\d+(?:\.\d+){0,2})(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return cleaned;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

/**
 * Compares two semver strings (`a` vs `b`).
 * Returns > 0 if `a > b`, < 0 if `a < b`, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (input: string) => {
    const clean = normalizeVersion(input);
    const [core, pre = ''] = clean.split('-', 2);
    const parts = core.split('.').map((n) => {
      const parsed = Number.parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    while (parts.length < 3) parts.push(0);
    return { parts, pre };
  };

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    if (pa.parts[i] !== pb.parts[i]) {
      return pa.parts[i] - pb.parts[i];
    }
  }

  // Stable release is newer than a prerelease of the same core version
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre);
}

type RawGitHubAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
  content_type?: string;
};

type RawGitHubRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: RawGitHubAsset[];
};

function pickBestApkAsset(assets: RawGitHubAsset[] | undefined): GitHubReleaseAsset | null {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const apks = assets.filter(
    (asset): asset is Required<Pick<RawGitHubAsset, 'name' | 'browser_download_url'>> & RawGitHubAsset =>
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.startsWith('https://'),
  );
  if (apks.length === 0) return null;

  // Prefer universal or arm64 release APK if multiple variants are uploaded
  const scored = [...apks].sort((a, b) => {
    const score = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('universal') || lower.includes('release')) return 3;
      if (lower.includes('arm64')) return 2;
      if (lower.includes('gunydrive')) return 1;
      return 0;
    };
    return score(b.name) - score(a.name);
  });

  const chosen = scored[0];
  return {
    name: chosen.name,
    downloadUrl: chosen.browser_download_url,
    sizeBytes: typeof chosen.size === 'number' && chosen.size > 0 ? chosen.size : 0,
    contentType: chosen.content_type ?? 'application/vnd.android.package-archive',
  };
}

async function fetchLatestReleaseFromRepo(repo: string): Promise<GitHubReleaseInfo | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `GunyDrive-Mobile/${getInstalledAppVersion()}`,
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`GitHub API merespons status ${response.status}.`);
    }

    const raw = (await response.json()) as RawGitHubRelease;
    if (raw.draft || raw.prerelease || !raw.tag_name) {
      return null;
    }

    const version = normalizeVersion(raw.tag_name);
    if (!version) return null;

    return {
      repo,
      tagName: raw.tag_name,
      version,
      name: (raw.name?.trim() || `GunyDrive v${version}`),
      body: (raw.body ?? '').trim(),
      publishedAt: raw.published_at ?? null,
      htmlUrl: raw.html_url ?? `https://github.com/${repo}/releases/latest`,
      apkAsset: pickBestApkAsset(raw.assets),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadUpdatePrefs(): Promise<UpdatePrefState> {
  return getPref<UpdatePrefState>(UPDATE_PREF_KEY, DEFAULT_PREF);
}

export async function skipReleaseVersion(version: string): Promise<void> {
  const prev = await loadUpdatePrefs();
  await setPref<UpdatePrefState>(UPDATE_PREF_KEY, {
    ...prev,
    skippedVersion: normalizeVersion(version),
  });
}

export type UpdateCheckResult = {
  installedVersion: string;
  updateAvailable: boolean;
  release: GitHubReleaseInfo | null;
  skipped: boolean;
  checkedAt: number;
  fromCache: boolean;
  error: string | null;
};

/**
 * Checks GitHub Releases across configured repositories and compares against the installed app version.
 * Automatic startup checks are throttled to once every 3 hours; manual checks always hit GitHub live.
 */
export async function checkGitHubReleaseUpdate(options?: {
  force?: boolean;
}): Promise<UpdateCheckResult> {
  const force = Boolean(options?.force);
  const installedVersion = getInstalledAppVersion();
  const pref = await loadUpdatePrefs();
  const now = Date.now();

  if (!force && pref.lastCheckedAt > 0 && now - pref.lastCheckedAt < AUTO_CHECK_INTERVAL_MS) {
    const cached = pref.cachedRelease;
    const isNewer = Boolean(cached && compareSemver(cached.version, installedVersion) > 0);
    const skipped = Boolean(
      isNewer && cached && pref.skippedVersion === normalizeVersion(cached.version),
    );
    return {
      installedVersion,
      updateAvailable: isNewer,
      release: isNewer ? cached : null,
      skipped,
      checkedAt: pref.lastCheckedAt,
      fromCache: true,
      error: null,
    };
  }

  const repos = getConfiguredReleaseRepos();
  const candidates: GitHubReleaseInfo[] = [];
  let lastError: string | null = null;

  for (const repo of repos) {
    try {
      const release = await fetchLatestReleaseFromRepo(repo);
      if (release) {
        candidates.push(release);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Gagal menghubungi GitHub Releases.';
    }
  }

  if (candidates.length === 0) {
    // Only update timestamp when no network error occurred (i.e. repos simply have no published release yet)
    if (!lastError) {
      await setPref<UpdatePrefState>(UPDATE_PREF_KEY, {
        ...pref,
        lastCheckedAt: now,
        cachedRelease: null,
      });
    }
    return {
      installedVersion,
      updateAvailable: false,
      release: null,
      skipped: false,
      checkedAt: lastError ? pref.lastCheckedAt : now,
      fromCache: false,
      error: lastError,
    };
  }

  // Pick the newest version (preferring one with an APK asset on tie)
  candidates.sort((a, b) => {
    const cmp = compareSemver(b.version, a.version);
    if (cmp !== 0) return cmp;
    return Number(Boolean(b.apkAsset)) - Number(Boolean(a.apkAsset));
  });

  const best = candidates[0];
  const isNewer = compareSemver(best.version, installedVersion) > 0;
  const skipped = Boolean(
    isNewer && !force && pref.skippedVersion === normalizeVersion(best.version),
  );

  await setPref<UpdatePrefState>(UPDATE_PREF_KEY, {
    ...pref,
    lastCheckedAt: now,
    cachedRelease: best,
  });

  return {
    installedVersion,
    updateAvailable: isNewer,
    release: isNewer ? best : null,
    skipped,
    checkedAt: now,
    fromCache: false,
    error: null,
  };
}

export function canInstallApkDirectly(): boolean {
  return Platform.OS === 'android' && typeof deviceCatalog?.installApk === 'function';
}

export function hasInstallPackagesPermission(): boolean {
  if (Platform.OS !== 'android') return false;
  if (typeof deviceCatalog?.canInstallPackages === 'function') {
    try {
      return deviceCatalog.canInstallPackages();
    } catch {
      return false;
    }
  }
  return false;
}

export async function openInstallPermissionSettings(): Promise<void> {
  if (Platform.OS === 'android' && typeof deviceCatalog?.requestInstallPackagesPermission === 'function') {
    await deviceCatalog.requestInstallPackagesPermission();
    return;
  }
  await Linking.openSettings();
}

/**
 * Streams the APK asset from GitHub Releases directly to local cache storage with live progress,
 * cleaning older cached APKs first so phone storage stays clean.
 */
export async function downloadReleaseApk(
  release: GitHubReleaseInfo,
  onProgress?: (progress: UpdateDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (Platform.OS !== 'android') {
    throw new Error('Unduhan APK langsung hanya tersedia di perangkat Android.');
  }
  if (!release.apkAsset) {
    throw new Error('Rilis ini belum melampirkan berkas APK Android.');
  }

  const updatesDir = new Directory(Paths.cache, 'updates');
  if (!updatesDir.exists) {
    updatesDir.create({ intermediates: true, idempotent: true });
  } else {
    // Remove previous cached update APKs so cache never accumulates
    try {
      for (const entry of updatesDir.list()) {
        if (entry instanceof File && entry.name.toLowerCase().endsWith('.apk')) {
          try {
            entry.delete();
          } catch {
            // Ignore locked file
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  const safeName = release.apkAsset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = safeName.toLowerCase().endsWith('.apk') ? safeName : `${safeName}.apk`;
  const target = new File(updatesDir, filename);
  const expectedTotal = release.apkAsset.sizeBytes;

  let lastEmit = 0;
  const downloaded = await File.downloadFileAsync(release.apkAsset.downloadUrl, target, {
    idempotent: true,
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `GunyDrive-Mobile/${getInstalledAppVersion()}`,
    },
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      const now = Date.now();
      const total = totalBytes > 0 ? totalBytes : expectedTotal;
      if (now - lastEmit < 100 && bytesWritten < total) return;
      lastEmit = now;
      const percent = total > 0 ? Math.min(99, Math.round((bytesWritten / total) * 100)) : 0;
      onProgress?.({ bytesWritten, totalBytes: total, percent });
    },
  });

  onProgress?.({
    bytesWritten: expectedTotal || downloaded.size || 0,
    totalBytes: expectedTotal || downloaded.size || 0,
    percent: 100,
  });

  return downloaded.uri;
}

/**
 * Triggers Android's native Package Installer UI for the downloaded APK.
 * Returns:
 * - `'installing'`: Android Package Installer opened successfully
 * - `'permission_required'`: Opened Android Settings -> "Install unknown apps" for GunyDrive
 * - `'opened_browser'`: Fallback when native module isn't present (e.g. Expo Go / iOS / Web)
 */
export async function installDownloadedReleaseApk(
  localApkUri: string,
  fallbackReleaseUrl: string,
): Promise<'installing' | 'permission_required' | 'opened_browser'> {
  if (Platform.OS === 'android' && typeof deviceCatalog?.installApk === 'function') {
    return deviceCatalog.installApk(localApkUri);
  }

  if (Platform.OS === 'android') {
    try {
      await new File(localApkUri).preview({
        title: 'Pasang Pembaruan GunyDrive',
        mimeType: 'application/vnd.android.package-archive',
      });
      return 'installing';
    } catch {
      // Fall through to browser release page
    }
  }

  await Linking.openURL(fallbackReleaseUrl);
  return 'opened_browser';
}

export async function openReleaseInBrowser(url: string): Promise<void> {
  await Linking.openURL(url);
}
