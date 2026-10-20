import {
  DEFAULT_AUTO_REFRESH,
  DEFAULT_ERGO_NODE_URL,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  MIN_REFRESH_INTERVAL_SECONDS,
} from './config';

export interface Settings {
  nodeUrl: string;
  autoRefresh: boolean;
  refreshIntervalSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  nodeUrl: DEFAULT_ERGO_NODE_URL,
  autoRefresh: DEFAULT_AUTO_REFRESH,
  refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
};

const STORAGE_KEYS = {
  nodeUrl: 'oracle-stats.nodeUrl',
  autoRefresh: 'oracle-stats.autoRefresh',
  refreshIntervalSeconds: 'oracle-stats.refreshIntervalSeconds',
} as const;

/** Trims, strips trailing slashes, clamps the interval; empty or invalid values fall back to defaults. */
export const normalizeSettings = (settings: Settings): Settings => {
  const interval = Math.round(settings.refreshIntervalSeconds);
  return {
    nodeUrl: settings.nodeUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.nodeUrl,
    autoRefresh: settings.autoRefresh,
    refreshIntervalSeconds: Number.isFinite(interval)
      ? Math.max(MIN_REFRESH_INTERVAL_SECONDS, interval)
      : DEFAULT_SETTINGS.refreshIntervalSeconds,
  };
};

export const loadSettings = (): Settings => {
  try {
    const storage = window.localStorage;
    const autoRefresh = storage.getItem(STORAGE_KEYS.autoRefresh);
    const interval = storage.getItem(STORAGE_KEYS.refreshIntervalSeconds);
    return normalizeSettings({
      nodeUrl: storage.getItem(STORAGE_KEYS.nodeUrl) ?? '',
      autoRefresh: autoRefresh === null ? DEFAULT_SETTINGS.autoRefresh : autoRefresh === 'true',
      refreshIntervalSeconds: interval === null ? DEFAULT_SETTINGS.refreshIntervalSeconds : Number(interval),
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: Settings) => {
  try {
    const storage = window.localStorage;
    storage.setItem(STORAGE_KEYS.nodeUrl, settings.nodeUrl);
    storage.setItem(STORAGE_KEYS.autoRefresh, String(settings.autoRefresh));
    storage.setItem(STORAGE_KEYS.refreshIntervalSeconds, String(settings.refreshIntervalSeconds));
  } catch (error) {
    console.error('Failed to persist settings', error);
  }
};
