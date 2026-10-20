import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DATAPOINT_PAGE_SIZE,
  EPOCH_LOAD_STEP,
  INITIAL_EPOCH_COUNT,
  POOL_BOX_PAGE_SIZE,
  type OraclePoolConfig,
} from '../config';
import { buildLedger, type Ledger } from '../model/ledger';
import {
  fetchDatapointPage,
  fetchNodeInfo,
  fetchOperatorAddresses,
  fetchPoolBoxPage,
  fetchPoolParameters,
  type DatapointPage,
  type PoolBoxPage,
} from '../services/datapointService';
import { loadPoolCache, savePoolCache, type PoolCache } from '../services/poolCache';
import type { OracleDatapoint, PoolBoxSnapshot, PoolParameters } from '../types/datapoint';

interface PagedState {
  /** Bumped whenever loaded history is discarded; stale page responses are ignored. */
  generation: number;
  datapoints: Map<string, OracleDatapoint>;
  datapointPages: number;
  datapointTotal: number | null;
  lastDatapointPageCount: number;
  datapointsFromHeight: number | null;
  poolBoxes: Map<string, PoolBoxSnapshot>;
  poolPages: number;
  poolTotal: number | null;
  lastPoolPageCount: number;
}

type PagedAction =
  | { type: 'datapoints'; generation: number; pageIndex: number; page: DatapointPage }
  | { type: 'poolBoxes'; generation: number; pageIndex: number; page: PoolBoxPage };

const emptyState: PagedState = {
  generation: 0,
  datapoints: new Map(),
  datapointPages: 0,
  datapointTotal: null,
  lastDatapointPageCount: 0,
  datapointsFromHeight: null,
  poolBoxes: new Map(),
  poolPages: 0,
  poolTotal: null,
  lastPoolPageCount: 0,
};

/** Cap on persisted history so the cache stays well inside the localStorage quota. */
const MAX_CACHED_DATAPOINTS = 3000;
const MAX_CACHED_POOL_BOXES = 1000;

const stateFromCache = (cache: PoolCache | null): PagedState =>
  cache
    ? {
        ...emptyState,
        datapoints: new Map(cache.datapoints.map((dp) => [dp.boxId, dp])),
        datapointPages: cache.datapointPages,
        datapointTotal: cache.datapointTotal,
        lastDatapointPageCount: cache.lastDatapointPageCount,
        datapointsFromHeight: cache.datapointsFromHeight,
        poolBoxes: new Map(cache.poolBoxes.map((box) => [box.boxId, box])),
        poolPages: cache.poolPages,
        poolTotal: cache.poolTotal,
        lastPoolPageCount: cache.lastPoolPageCount,
      }
    : emptyState;

/**
 * Keeps the newest history only. After trimming, coverage starts above the cutoff height and the
 * page counters are lowered to the kept count: resuming at a smaller offset re-fetches some boxes
 * (merged by box id) but can never skip any.
 */
const cacheFromState = (
  state: PagedState,
  params: PoolParameters | null,
  operators: string[],
): PoolCache => {
  let datapoints = [...state.datapoints.values()].sort((a, b) => b.blockHeight - a.blockHeight);
  let { datapointPages, lastDatapointPageCount, datapointsFromHeight } = state;
  if (datapoints.length > MAX_CACHED_DATAPOINTS) {
    const cutoff = datapoints[MAX_CACHED_DATAPOINTS].blockHeight;
    datapoints = datapoints.filter((dp) => dp.blockHeight > cutoff);
    datapointsFromHeight = cutoff;
    datapointPages = Math.floor(datapoints.length / DATAPOINT_PAGE_SIZE);
    lastDatapointPageCount = DATAPOINT_PAGE_SIZE;
  }
  let poolBoxes = [...state.poolBoxes.values()].sort((a, b) => b.blockHeight - a.blockHeight);
  let { poolPages, lastPoolPageCount } = state;
  if (poolBoxes.length > MAX_CACHED_POOL_BOXES) {
    poolBoxes = poolBoxes.slice(0, MAX_CACHED_POOL_BOXES);
    poolPages = Math.floor(poolBoxes.length / POOL_BOX_PAGE_SIZE);
    lastPoolPageCount = POOL_BOX_PAGE_SIZE;
  }
  return {
    datapoints,
    datapointPages,
    datapointTotal: state.datapointTotal,
    lastDatapointPageCount,
    datapointsFromHeight,
    poolBoxes,
    poolPages,
    poolTotal: state.poolTotal,
    lastPoolPageCount,
    params,
    operators,
  };
};

/** A box only ever moves from unspent to spent, so keep whichever copy knows the spender. */
const mergeDatapoint = (existing: OracleDatapoint | undefined, incoming: OracleDatapoint) =>
  existing?.spentTransactionId ? existing : incoming;

const reducer = (state: PagedState, action: PagedAction): PagedState => {
  if (action.generation !== state.generation) {
    return state;
  }
  // A refreshed first page that doesn't reach down to the newest loaded datapoint means boxes in
  // between were never seen: drop the history and continue paging from the fresh page.
  if (action.type === 'datapoints') {
    const { page, pageIndex } = action;
    let newestLoaded: number | null = null;
    for (const dp of state.datapoints.values()) {
      if (newestLoaded === null || dp.blockHeight > newestLoaded) newestLoaded = dp.blockHeight;
    }
    const gap =
      pageIndex === 0 &&
      newestLoaded !== null &&
      page.count === DATAPOINT_PAGE_SIZE &&
      page.oldestHeight !== null &&
      page.oldestHeight > newestLoaded;
    const datapoints = gap ? new Map<string, OracleDatapoint>() : new Map(state.datapoints);
    page.datapoints.forEach((dp) => datapoints.set(dp.boxId, mergeDatapoint(datapoints.get(dp.boxId), dp)));
    const fromHeights = [gap ? null : state.datapointsFromHeight, page.oldestHeight].filter(
      (height): height is number => height !== null,
    );
    return {
      ...state,
      generation: gap ? state.generation + 1 : state.generation,
      datapoints,
      datapointPages: gap ? 1 : Math.max(state.datapointPages, pageIndex + 1),
      datapointTotal: page.total,
      // Only the deepest page tells whether history is exhausted.
      lastDatapointPageCount:
        gap || pageIndex + 1 >= state.datapointPages ? page.count : state.lastDatapointPageCount,
      datapointsFromHeight: fromHeights.length ? Math.min(...fromHeights) : null,
    };
  }
  const { page, pageIndex } = action;
  const gap =
    pageIndex === 0 &&
    state.poolBoxes.size > 0 &&
    !page.snapshots.some((snapshot) => state.poolBoxes.has(snapshot.boxId));
  const poolBoxes = gap ? new Map<string, PoolBoxSnapshot>() : new Map(state.poolBoxes);
  page.snapshots.forEach((snapshot) => poolBoxes.set(snapshot.boxId, snapshot));
  return {
    ...state,
    generation: gap ? state.generation + 1 : state.generation,
    poolBoxes,
    poolPages: gap ? 1 : Math.max(state.poolPages, pageIndex + 1),
    poolTotal: page.total,
    lastPoolPageCount: gap || pageIndex + 1 >= state.poolPages ? page.count : state.lastPoolPageCount,
  };
};

export interface PoolData {
  ledger: Ledger;
  params: PoolParameters | null;
  operators: string[];
  height: number | null;
  secondsUntilNextCheck: number | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Loads and live-updates one pool's history. Mount with a `key` per pool + node to reset.
 * `refreshIntervalSeconds` sets how often the node is checked for a new block; `null` disables
 * auto-refresh (the node is still queried once for the current height).
 */
export const usePoolData = (
  pool: OraclePoolConfig,
  nodeUrl: string,
  refreshIntervalSeconds: number | null,
): PoolData => {
  const [cached] = useState(() => loadPoolCache(nodeUrl, pool.id));
  const [state, dispatch] = useReducer(reducer, cached, stateFromCache);
  const [params, setParams] = useState<PoolParameters | null>(cached?.params ?? null);
  const [operators, setOperators] = useState<string[]>(cached?.operators ?? []);
  const [height, setHeight] = useState<number | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState<number | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [epochLimit, setEpochLimit] = useState(INITIAL_EPOCH_COUNT);
  const generationRef = useRef(state.generation);
  useLayoutEffect(() => {
    generationRef.current = state.generation;
  }, [state.generation]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setInFlight((count) => count + 1);
    try {
      await task();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pool data');
    } finally {
      setInFlight((count) => count - 1);
    }
  }, []);

  const loadDatapoints = useCallback(
    (pageIndex: number) =>
      run(async () => {
        const generation = generationRef.current;
        const page = await fetchDatapointPage(nodeUrl, pool, pageIndex);
        dispatch({ type: 'datapoints', generation, pageIndex, page });
      }),
    [nodeUrl, pool, run],
  );

  const loadPoolBoxes = useCallback(
    (pageIndex: number) =>
      run(async () => {
        const generation = generationRef.current;
        const page = await fetchPoolBoxPage(nodeUrl, pool, pageIndex);
        dispatch({ type: 'poolBoxes', generation, pageIndex, page });
      }),
    [nodeUrl, pool, run],
  );

  // Initial load.
  useEffect(() => {
    loadPoolBoxes(0);
    loadDatapoints(0);
    run(async () => setParams(await fetchPoolParameters(nodeUrl, pool)));
    run(async () => setOperators(await fetchOperatorAddresses(nodeUrl, pool)));
  }, [loadDatapoints, loadPoolBoxes, nodeUrl, pool, run]);

  // Persist loaded history (debounced) so the next visit starts from it.
  useEffect(() => {
    if (!state.datapointPages && !state.poolPages) return;
    const timer = window.setTimeout(
      () => savePoolCache(nodeUrl, pool.id, cacheFromState(state, params, operators)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [nodeUrl, operators, params, pool.id, state]);

  // Poll the node; on every new block re-fetch the newest pages and merge them in.
  useEffect(() => {
    const autoRefresh = refreshIntervalSeconds !== null;
    let cancelled = false;
    let lastHeight: number | null = null;
    let pollTimer: number | undefined;
    let nextPollAt = Date.now();
    const countdown = autoRefresh
      ? window.setInterval(() => {
          setSecondsUntilNextCheck(Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000)));
        }, 1000)
      : undefined;

    const poll = async () => {
      try {
        const info = await fetchNodeInfo(nodeUrl);
        if (cancelled) return;
        setHeight(info.fullHeight);
        if (lastHeight !== null && info.fullHeight !== lastHeight) {
          loadPoolBoxes(0);
          loadDatapoints(0);
        }
        lastHeight = info.fullHeight;
      } catch (err) {
        console.error('Failed to poll ergo node info', err);
      } finally {
        if (!cancelled && autoRefresh) {
          nextPollAt = Date.now() + refreshIntervalSeconds * 1000;
          pollTimer = window.setTimeout(poll, refreshIntervalSeconds * 1000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
      window.clearInterval(countdown);
    };
  }, [loadDatapoints, loadPoolBoxes, nodeUrl, refreshIntervalSeconds]);

  const allDatapointsLoaded =
    state.datapointTotal !== null &&
    (state.datapointPages * DATAPOINT_PAGE_SIZE >= state.datapointTotal ||
      state.lastDatapointPageCount < DATAPOINT_PAGE_SIZE);
  const allPoolBoxesLoaded =
    state.poolTotal !== null &&
    (state.poolPages * POOL_BOX_PAGE_SIZE >= state.poolTotal ||
      state.lastPoolPageCount < POOL_BOX_PAGE_SIZE);

  const ledger = useMemo(
    () =>
      buildLedger({
        datapoints: [...state.datapoints.values()],
        poolBoxes: [...state.poolBoxes.values()],
        params,
        height,
        datapointsLoadedFromHeight: state.datapointsFromHeight,
        allDatapointsLoaded,
        epochLimit,
        registeredOracles: operators,
      }),
    [state, params, height, allDatapointsLoaded, epochLimit, operators],
  );

  const oldestPoolBoxHeight = useMemo(() => {
    let min: number | null = null;
    state.poolBoxes.forEach((box) => {
      if (min === null || box.blockHeight < min) min = box.blockHeight;
    });
    return min;
  }, [state.poolBoxes]);

  // Datapoints older than the oldest loaded pool box can't be placed in an epoch yet.
  const needsPoolBoxes =
    !allPoolBoxesLoaded &&
    oldestPoolBoxHeight !== null &&
    state.datapointsFromHeight !== null &&
    state.datapointsFromHeight < oldestPoolBoxHeight;
  const hasMore = !allDatapointsLoaded || needsPoolBoxes;
  const isLoading = inFlight > 0;

  // Page further back until the ledger holds `epochLimit` epochs.
  useEffect(() => {
    if (isLoading || error || state.datapointPages === 0 || state.poolPages === 0) return;
    if (ledger.epochs.length >= epochLimit) return;
    if (needsPoolBoxes) loadPoolBoxes(state.poolPages);
    else if (!allDatapointsLoaded) loadDatapoints(state.datapointPages);
  }, [
    allDatapointsLoaded,
    epochLimit,
    error,
    isLoading,
    ledger.epochs.length,
    loadDatapoints,
    loadPoolBoxes,
    needsPoolBoxes,
    state.datapointPages,
    state.poolPages,
  ]);

  const loadMore = useCallback(() => {
    if (ledger.epochs.length >= epochLimit) setEpochLimit((limit) => limit + EPOCH_LOAD_STEP);
  }, [epochLimit, ledger.epochs.length]);

  return {
    ledger,
    params,
    operators,
    height,
    secondsUntilNextCheck: refreshIntervalSeconds !== null ? secondsUntilNextCheck : null,
    isLoading,
    error,
    hasMore,
    loadMore,
  };
};
