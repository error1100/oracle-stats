import type { OracleDatapoint, PoolBoxSnapshot, PoolParameters } from '../types/datapoint';

/** Bump when the cached shape or its meaning changes; older entries are ignored. */
const CACHE_VERSION = 1;
const KEY_PREFIX = 'oracle-stats.cache';

/** Loaded history for one pool on one node, persisted so reloads and tab switches start warm. */
export interface PoolCache {
  datapoints: OracleDatapoint[];
  datapointPages: number;
  datapointTotal: number | null;
  lastDatapointPageCount: number;
  datapointsFromHeight: number | null;
  poolBoxes: PoolBoxSnapshot[];
  poolPages: number;
  poolTotal: number | null;
  lastPoolPageCount: number;
  params: PoolParameters | null;
  operators: string[];
}

const cacheKey = (nodeUrl: string, poolId: string) => `${KEY_PREFIX}.v${CACHE_VERSION}:${poolId}:${nodeUrl}`;

export const loadPoolCache = (nodeUrl: string, poolId: string): PoolCache | null => {
  try {
    const raw = window.localStorage.getItem(cacheKey(nodeUrl, poolId));
    return raw ? (JSON.parse(raw) as PoolCache) : null;
  } catch (error) {
    console.error('Failed to read pool cache', error);
    return null;
  }
};

export const savePoolCache = (nodeUrl: string, poolId: string, cache: PoolCache) => {
  const key = cacheKey(nodeUrl, poolId);
  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch (error) {
    // Most likely the storage quota; a stale entry is worse than none.
    console.error('Failed to write pool cache', error);
    window.localStorage.removeItem(key);
  }
};

/** Removes every cached pool history (all pools, all nodes, all cache versions). */
export const clearPoolCaches = () => {
  try {
    const storage = window.localStorage;
    Object.keys(storage)
      .filter((key) => key.startsWith(`${KEY_PREFIX}.`))
      .forEach((key) => storage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear pool cache', error);
  }
};
