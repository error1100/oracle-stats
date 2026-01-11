import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  DATAPOINT_PAGE_SIZE,
  DEFAULT_ERGO_NODE_URL,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  DEFAULT_POOL_ID,
  ORACLE_POOLS,
  type OraclePoolConfig,
} from './config';
import {
  buildExplorerLinks,
  fetchDatapointPage,
  fetchOperatorAddresses,
  fetchLatestOraclePoolValue,
  fetchNodeInfo,
  type RefreshBoxMarker,
} from './services/datapointService';
import type { EpochGroup, OracleDatapoint } from './types/datapoint';
import {
  formatDateTime,
  formatNumber,
  formatPrice,
  formatRelativeTime,
  shortenAddress,
} from './utils/format';

type DecoratedDatapoint = OracleDatapoint & {
  refreshStatus: 'included' | 'excluded' | 'pending';
};

interface EpochWithStatus {
  epochId: number;
  datapoints: DecoratedDatapoint[];
  blockHeight: number;
  startBlock?: number;
  endBlock?: number;
  blockSpan?: number;
  postedAt?: number;
  refreshTxId?: string;
  refreshMarker?: RefreshBoxMarker;
}

const dedupeByBoxId = (items: OracleDatapoint[]) => {
  const map = new Map<string, OracleDatapoint>();
  items.forEach((item) => {
    const existing = map.get(item.boxId);
    const existingTimestamp = existing?.timestamp ?? 0;
    const itemTimestamp = item.timestamp ?? 0;
    if (!existing || existingTimestamp < itemTimestamp) {
      map.set(item.boxId, item);
    }
  });
  return Array.from(map.values()).sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
  );
};

const groupByEpoch = (datapoints: OracleDatapoint[]): EpochGroup[] => {
  const map = new Map<number, OracleDatapoint[]>();
  datapoints.forEach((dp) => {
    const existing = map.get(dp.epochId) ?? [];
    existing.push(dp);
    map.set(dp.epochId, existing);
  });

  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([epochId, entries]) => {
      const sorted = entries.sort(
        (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
      );
      const blockHeight = sorted.reduce(
        (max, entry) => (entry.blockHeight > max ? entry.blockHeight : max),
        sorted[0]?.blockHeight ?? 0,
      );
      const postedAt = sorted[0]?.timestamp;
      return { epochId, datapoints: sorted, blockHeight, postedAt };
    });
};

const deriveQuotePerErg = (datapoint: number) =>
  datapoint > 0 ? 1_000_000_000 / datapoint : null;

const MIN_VISIBLE_EPOCHS = 3;

function App() {
  const [datapoints, setDatapoints] = useState<OracleDatapoint[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_POOL_ID);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalTransactions, setTotalTransactions] = useState<number | null>(
    null,
  );
  const [latestNodeHeight, setLatestNodeHeight] = useState<number | null>(null);
  const [nextRefreshTimestamp, setNextRefreshTimestamp] = useState<number | null>(null);
  const [secondsUntilNextRefresh, setSecondsUntilNextRefresh] = useState<number | null>(null);
  const [lastFetchedCount, setLastFetchedCount] = useState(0);
  const [refreshMarkers, setRefreshMarkers] = useState<RefreshBoxMarker[]>([]);
  const [desiredEpochs, setDesiredEpochs] = useState(MIN_VISIBLE_EPOCHS);
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
  const [operatorAddresses, setOperatorAddresses] = useState<string[]>([]);
  const [oraclePoolValue, setOraclePoolValue] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const selectedPool: OraclePoolConfig | undefined = useMemo(
    () => ORACLE_POOLS.find((pool) => pool.id === selectedPoolId) ?? ORACLE_POOLS[0],
    [selectedPoolId],
  );
  const quoteTicker = selectedPool?.quoteTicker ?? 'USD';

  const refreshTxMap = useMemo(() => {
    const map = new Map<string, RefreshBoxMarker>();
    refreshMarkers.forEach((marker) => map.set(marker.txId, marker));
    return map;
  }, [refreshMarkers]);

  const groupedEpochs = useMemo(() => groupByEpoch(datapoints), [datapoints]);
  const epochsWithStatus: EpochWithStatus[] = useMemo(() => {
    const base = groupedEpochs.map((epoch) => {
      const refreshTxId =
        epoch.datapoints
          .map((dp) => dp.spentTransactionId)
          .find((txId) => txId && refreshTxMap.has(txId)) ?? undefined;
        const decoratedDatapoints: DecoratedDatapoint[] = epoch.datapoints.map((dp) => {
          let refreshStatus: DecoratedDatapoint['refreshStatus'] = 'pending';
          if (refreshTxId) {
            refreshStatus = dp.spentTransactionId === refreshTxId ? 'included' : 'excluded';
          } else if (dp.spentTransactionId) {
            refreshStatus = 'excluded';
          }
          return { ...dp, refreshStatus };
        });
      return {
        epochId: epoch.epochId,
        blockHeight: epoch.blockHeight,
        postedAt: epoch.postedAt,
        datapoints: decoratedDatapoints,
        refreshTxId,
        refreshMarker: refreshTxId ? refreshTxMap.get(refreshTxId) : undefined,
      };
    });
    return base.map((epoch, index, array) => {
      const previousRefreshBlock = array[index + 1]?.refreshMarker?.blockHeight;
      const startBlock =
        previousRefreshBlock !== undefined && previousRefreshBlock !== null
          ? previousRefreshBlock + 1
          : undefined;
      const endBlock = epoch.refreshMarker?.blockHeight ?? epoch.blockHeight;
      const blockSpan =
        typeof startBlock === 'number' && typeof endBlock === 'number'
          ? Math.max(0, endBlock - startBlock + 1)
          : undefined;
      return {
        ...epoch,
        startBlock,
        endBlock,
        blockSpan,
      };
    });
  }, [groupedEpochs, refreshTxMap]);
  const visibleEpochs = useMemo(
    () => epochsWithStatus.slice(0, desiredEpochs),
    [epochsWithStatus, desiredEpochs],
  );
  const lastClosedEpoch = useMemo(
    () => epochsWithStatus.find((epoch) => epoch.refreshMarker) ?? epochsWithStatus[0],
    [epochsWithStatus],
  );
  const latestEpoch = visibleEpochs[0];
  const latestOracleQuote = useMemo(
    () => (oraclePoolValue !== null ? deriveQuotePerErg(oraclePoolValue) : null),
    [oraclePoolValue],
  );
  const latestEpochTimestamp =
    latestEpoch?.refreshMarker?.timestamp ?? latestEpoch?.postedAt;
  const activeOperatorCount = useMemo(() => {
    if (!lastClosedEpoch || operatorAddresses.length === 0) {
      return 0;
    }
    const activeSet = new Set(lastClosedEpoch.datapoints.map((dp) => dp.oracleAddress));
    return operatorAddresses.filter((address) => activeSet.has(address)).length;
  }, [lastClosedEpoch, operatorAddresses]);
  const totalOperatorCount = operatorAddresses.length;
  const hasMore =
    !error &&
    (totalTransactions === null ||
      (currentPage + 1) * DATAPOINT_PAGE_SIZE < totalTransactions ||
      lastFetchedCount === DATAPOINT_PAGE_SIZE);

  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      setIsLoading(true);
      setError(null);
      try {
        if (!selectedPool) {
          throw new Error('No oracle pools configured');
        }
        const {
          datapoints: pageData,
          totals,
          pageCounts,
          refreshBoxes,
        } = await fetchDatapointPage(selectedPool, nextPage);
        const combinedTotal = Math.max(totals.oracle, totals.datapoint);
        setTotalTransactions(combinedTotal);
        setLastFetchedCount(Math.max(pageCounts.oracle, pageCounts.datapoint));
        setDatapoints((current) => {
          const combined = replace ? pageData : [...current, ...pageData];
          return dedupeByBoxId(combined);
        });
        setRefreshMarkers((current) => {
          const combined = replace ? refreshBoxes : [...current, ...refreshBoxes];
          const map = new Map<string, RefreshBoxMarker>();
          combined.forEach((marker) => {
            const existing = map.get(marker.boxId);
            if (!existing || (marker.timestamp ?? 0) > (existing.timestamp ?? 0)) {
              map.set(marker.boxId, marker);
            }
          });
          return Array.from(map.values()).sort((a, b) => b.blockHeight - a.blockHeight);
        });
        setCurrentPage(nextPage);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load datapoint history',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [selectedPool],
  );

  const refresh = useCallback(() => {
    setDesiredEpochs(MIN_VISIBLE_EPOCHS);
    loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setNextRefreshTimestamp(null);
    if (!selectedPool) {
      return;
    }

    const intervalSeconds =
      selectedPool.REFRESH_INTERVAL_SECONDS ?? DEFAULT_REFRESH_INTERVAL_SECONDS;
    if (intervalSeconds <= 0) {
      return;
    }

    let timer: number | undefined;
    let lastHeight = 0;
    let cancelled = false;
    const intervalMs = intervalSeconds * 1000;

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }
      const nextTime = Date.now() + intervalMs;
      setNextRefreshTimestamp(nextTime);
      timer = window.setTimeout(poll, intervalMs);
    };

    const poll = async () => {
      try {
        const nodeUrl =
          selectedPool.ergoNodeApiUrl ??
          selectedPool.ergoNodeUrl ??
          DEFAULT_ERGO_NODE_URL;
        const info = await fetchNodeInfo(nodeUrl);
        if (info.fullHeight) {
          setLatestNodeHeight(info.fullHeight);
          if (info.fullHeight !== lastHeight) {
            lastHeight = info.fullHeight;
            refresh();
          }
        }
      } catch (error) {
        console.error('Failed to poll ergo node info', error);
      } finally {
        scheduleNextPoll();
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [selectedPool, refresh]);

  useEffect(() => {
    if (nextRefreshTimestamp === null) {
      setSecondsUntilNextRefresh(null);
      return;
    }
    const updateCountdown = () => {
      const remainingMs = nextRefreshTimestamp - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsUntilNextRefresh(remainingSeconds);
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [nextRefreshTimestamp]);

  useEffect(() => {
    if (visibleEpochs.length < desiredEpochs && hasMore && !isLoading) {
      loadPage(currentPage + 1);
    }
  }, [visibleEpochs.length, desiredEpochs, hasMore, isLoading, loadPage, currentPage]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading) {
          return;
        }
        const canLoadMore =
          hasMore || visibleEpochs.length < epochsWithStatus.length;
        if (canLoadMore) {
          setDesiredEpochs((count) => count + 1);
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [isLoading, hasMore, visibleEpochs.length, epochsWithStatus.length]);

  useEffect(() => {
    if (!selectedPool) {
      setOperatorAddresses([]);
      return;
    }
    let isCancelled = false;
    const loadOperators = async () => {
      try {
        const addresses = await fetchOperatorAddresses(selectedPool);
        if (!isCancelled) {
          setOperatorAddresses(addresses);
        }
      } catch (operatorError) {
        console.error('Failed to load operator addresses', operatorError);
        if (!isCancelled) {
          setOperatorAddresses([]);
        }
      }
    };
    loadOperators();
    return () => {
      isCancelled = true;
    };
  }, [selectedPool]);

  useEffect(() => {
    if (!selectedPool) {
      setOraclePoolValue(null);
      return;
    }
    let isCancelled = false;
    const loadOracleValue = async () => {
      try {
        const value = await fetchLatestOraclePoolValue(selectedPool);
        if (!isCancelled) {
          setOraclePoolValue(value);
        }
      } catch (error) {
        console.error('Failed to load oracle pool value', error);
        if (!isCancelled) {
          setOraclePoolValue(null);
        }
      }
    };
    loadOracleValue();
    return () => {
      isCancelled = true;
    };
  }, [selectedPool, refreshMarkers]);


  useEffect(() => {
    if (!visibleEpochs.length) {
      setExpandedEpochs(new Set());
      return;
    }
    setExpandedEpochs((current) => {
      const allowedIds = new Set(visibleEpochs.map((epoch) => epoch.epochId));
      const next = new Set<number>();
      current.forEach((id) => {
        if (allowedIds.has(id)) {
          next.add(id);
        }
      });
      if (next.size === current.size) {
        let identical = true;
        current.forEach((id) => {
          if (!next.has(id)) {
            identical = false;
          }
        });
        if (identical) {
          return current;
        }
      }
      return next;
    });
  }, [visibleEpochs]);

  const explorerLinks = buildExplorerLinks;

  const toggleEpochExpansion = useCallback((epochId: number) => {
    setExpandedEpochs((current) => {
      const next = new Set(current);
      if (next.has(epochId)) {
        next.delete(epochId);
      } else {
        next.add(epochId);
      }
      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <p className="eyebrow">Ergo Oracle Core status</p>
          <h1>Oracle pool stats</h1>
          <p className="subtitle">
            Tracking oracle pool per epoch published datapoint and refresh transactions.
          </p>
        </div>
        <div className="header-actions">
          <div className="pool-select">
            <label htmlFor="pool-select-input" className="label">
              Oracle pool
            </label>
            <select
              id="pool-select-input"
              value={selectedPool?.id ?? ''}
              onChange={(event) => {
                setSelectedPoolId(event.target.value);
                setDatapoints([]);
                setCurrentPage(0);
                setTotalTransactions(null);
                setError(null);
                setRefreshMarkers([]);
                setDesiredEpochs(MIN_VISIBLE_EPOCHS);
                setOperatorAddresses([]);
              }}
              disabled={isLoading}
            >
              {ORACLE_POOLS.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.label}
                </option>
              ))}
            </select>
            {selectedPool?.description && (
              <p className="muted small">{selectedPool.description}</p>
            )}
          </div>
        </div>
      </header>

      <section className="address-panel">
        <div>
          <p className="label">Operators</p>
          <p className="stat">
            {totalOperatorCount > 0
              ? `${formatNumber(activeOperatorCount)} / ${formatNumber(totalOperatorCount)}`
              : '—'}
          </p>
          <p className="muted">
            {totalOperatorCount > 0 && lastClosedEpoch
              ? `Active in last epoch #${lastClosedEpoch.epochId}`
              : 'Loading operator roster…'}
          </p>
        </div>
        <div>
          <p className="label">Current value</p>
          <p className="stat">
            {oraclePoolValue !== null ? oraclePoolValue.toString() : '—'}
          </p>
          <p className="muted">
            {latestOracleQuote !== null
              ? `${formatPrice(latestOracleQuote)} ${quoteTicker}/ERG`
              : 'Awaiting refresh'}
          </p>
        </div>
        <div>
          <p className="label">Latest epoch</p>
          <p className="stat">
            {latestEpoch ? `#${latestEpoch.epochId}` : '—'}
          </p>
          {latestEpoch && (
            <p className="muted">
              {latestEpoch.datapoints.length} datapoints ·{' '}
              {formatRelativeTime(latestEpochTimestamp)}
            </p>
          )}
        </div>
        <div>
          <p className="label">Current block</p>
          <p className="stat">
            {latestNodeHeight !== null ? latestNodeHeight.toString() : '—'}
          </p>
          <p className="muted">
            Next block check in{' '}
            {secondsUntilNextRefresh !== null
              ? `${secondsUntilNextRefresh}s`
              : '—'}
          </p>
        </div>
      </section>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {isLoading && datapoints.length === 0 ? (
        <div className="loading-state">Loading datapoints…</div>
      ) : (
        <section className="epochs">
          {visibleEpochs.map((epoch) => {
            const uniqueOracles = new Set(
              epoch.datapoints.map((dp) => dp.oracleAddress),
            ).size;
            const includedCount = epoch.datapoints.filter(
              (dp) => dp.refreshStatus === 'included',
            ).length;
            const excludedCount = epoch.datapoints.filter(
              (dp) => dp.refreshStatus === 'excluded',
            ).length;
            const pendingCount =
              epoch.datapoints.length - includedCount - excludedCount;
            const datapointsByAddress = new Map<string, DecoratedDatapoint[]>();
            epoch.datapoints.forEach((dp) => {
              const list = datapointsByAddress.get(dp.oracleAddress) ?? [];
              list.push(dp);
              datapointsByAddress.set(dp.oracleAddress, list);
            });
            const datapointAddresses = new Set(datapointsByAddress.keys());
            const operatorUniverse =
              operatorAddresses.length > 0
                ? operatorAddresses
                : Array.from(datapointAddresses.values());
            const operatorAddressSet = new Set(operatorUniverse);
            const inactiveOperators = operatorUniverse.filter(
              (address) => !datapointAddresses.has(address),
            );
            const totalOperators = operatorUniverse.length;
            const activeOperators = Math.max(
              0,
              totalOperators - inactiveOperators.length,
            );
            const inactiveCount = Math.max(0, totalOperators - activeOperators);
            const buildSortedDatapoints = (address: string) =>
              [...(datapointsByAddress.get(address) ?? [])].sort(
                (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
              );
            const chartDots: Array<
              | { type: 'datapoint'; datapoint: DecoratedDatapoint; sortHeight: number }
              | { type: 'inactive'; operator: string; sortHeight: number }
            > = [];
            operatorUniverse.forEach((address) => {
              const operatorDatapoints = buildSortedDatapoints(address);
              if (operatorDatapoints.length === 0) {
                chartDots.push({
                  type: 'inactive',
                  operator: address,
                  sortHeight: 0,
                });
              } else {
                operatorDatapoints.forEach((dp) =>
                  chartDots.push({
                    type: 'datapoint',
                    datapoint: dp,
                    sortHeight: dp.blockHeight ?? 0,
                  }),
                );
              }
            });
            Array.from(datapointAddresses.values())
              .filter((address) => !operatorAddressSet.has(address))
              .forEach((address) => {
                buildSortedDatapoints(address).forEach((dp) =>
                  chartDots.push({
                    type: 'datapoint',
                    datapoint: dp,
                    sortHeight: dp.blockHeight ?? 0,
                  }),
                );
              });
            chartDots.sort((a, b) => {
              if (a.sortHeight !== b.sortHeight) {
                return a.sortHeight - b.sortHeight;
              }
              if (a.type === 'inactive' && b.type !== 'inactive') {
                return -1;
              }
              if (a.type !== 'inactive' && b.type === 'inactive') {
                return 1;
              }
              if (a.type === 'datapoint' && b.type === 'datapoint') {
                return (a.datapoint.timestamp ?? 0) - (b.datapoint.timestamp ?? 0);
              }
              return 0;
            });
            const isExpanded = expandedEpochs.has(epoch.epochId);
            return (
              <article
                key={epoch.epochId}
                className={`epoch-card ${isExpanded ? 'expanded' : 'collapsed'}`}
              >
                <header>
                  <div>
                    <p className="eyebrow">Epoch</p>
                    <h2>#{epoch.epochId}</h2>
                  </div>
                  <div className="epoch-meta">
                    <span>
                      Length{' '}
                      {typeof epoch.blockSpan === 'number'
                        ? `${formatNumber(epoch.blockSpan)} blocks`
                        : '—'}{' '}
                      ·{' '}
                      {formatRelativeTime(epoch.refreshMarker?.timestamp ?? epoch.postedAt)}
                    </span>
                    <span>{uniqueOracles} oracles</span>
                    <span>{epoch.datapoints.length} datapoints</span>
                    {epoch.refreshMarker && (
                      <span className="refresh-chip">
                        Refresh #{epoch.refreshMarker.blockHeight}
                      </span>
                    )}
                  </div>
                </header>
                <div className="epoch-summary">
                  <div className="epoch-summary-stats">
                    <div>
                      <p className="label">Datapoints</p>
                      <p className="stat small">{formatNumber(epoch.datapoints.length)}</p>
                    </div>
                    <div>
                      <p className="label">Included</p>
                      <p className="stat small">{includedCount}</p>
                    </div>
                    <div>
                      <p className="label">Excluded</p>
                      <p className="stat small">{excludedCount}</p>
                    </div>
                    <div>
                      <p className="label">Pending</p>
                      <p className="stat small">{pendingCount}</p>
                    </div>
                    <div>
                      <p className="label">Operators</p>
                      <p className="stat small">
                        {totalOperators > 0
                          ? `${formatNumber(activeOperators)} / ${formatNumber(totalOperators)}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="label">Inactive</p>
                      <p className="stat small">
                        {totalOperators > 0 ? formatNumber(inactiveCount) : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="mini-chart" role="img" aria-label={`Epoch ${epoch.epochId} datapoints`}>
                    {chartDots.map((dot, index) => {
                      if (dot.type === 'inactive') {
                        return (
                          <span
                            key={`inactive-${epoch.epochId}-${dot.operator}-${index}`}
                            className="mini-dot inactive"
                            title={`No datapoint from ${shortenAddress(dot.operator, 6)}`}
                          />
                        );
                      }
                      const datapointRate = deriveQuotePerErg(dot.datapoint.value);
                      const valueLine = dot.datapoint.value.toString();
                      const rateLine = datapointRate
                        ? `${formatPrice(datapointRate)} ${quoteTicker}/ERG`
                        : null;
                      const infoLine = [valueLine, rateLine]
                        .filter(Boolean)
                        .join(' • ');
                      return (
                        <a
                          key={`${dot.datapoint.boxId}-${dot.datapoint.oracleAddress}-${index}`}
                          className={`mini-dot ${dot.datapoint.refreshStatus} ${dot.datapoint.source}`}
                          title={`Oracle ${shortenAddress(dot.datapoint.oracleAddress, 6)} • ${infoLine}\n${formatDateTime(dot.datapoint.timestamp)}`}
                          href={explorerLinks.transaction(dot.datapoint.txId)}
                          target="_blank"
                          rel="noreferrer"
                        />
                      );
                    })}
                    {epoch.refreshMarker && (
                      <a
                        className="mini-refresh-dot"
                        title={`Refresh block #${epoch.refreshMarker.blockHeight}`}
                        href={explorerLinks.transaction(epoch.refreshMarker.txId)}
                        target="_blank"
                        rel="noreferrer"
                      />
                    )}
                  </div>
                </div>
                <div className="epoch-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => toggleEpochExpansion(epoch.epochId)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Hide transactions' : 'Show transactions'}
                  </button>
                </div>
                {isExpanded && (
                  <div className="datapoint-list">
                    {(() => {
                      const transactionRows: Array<
                        | { type: 'datapoint'; datapoint: DecoratedDatapoint }
                        | { type: 'refresh'; refresh: RefreshBoxMarker }
                      > = epoch.datapoints.map((dp) => ({
                        type: 'datapoint',
                        datapoint: dp,
                      }));
                      if (epoch.refreshMarker) {
                        transactionRows.push({
                          type: 'refresh',
                          refresh: epoch.refreshMarker,
                        });
                      }
                      return transactionRows.sort((a, b) => {
                        const aIndex =
                          a.type === 'refresh'
                            ? a.refresh.globalIndex ?? Number.POSITIVE_INFINITY
                            : a.datapoint.globalIndex ?? -Infinity;
                        const bIndex =
                          b.type === 'refresh'
                            ? b.refresh.globalIndex ?? Number.POSITIVE_INFINITY
                            : b.datapoint.globalIndex ?? -Infinity;
                        if (aIndex !== bIndex) {
                          return bIndex - aIndex;
                        }
                        if (a.type === 'refresh') return -1;
                        if (b.type === 'refresh') return 1;
                        return (b.datapoint.timestamp ?? 0) - (a.datapoint.timestamp ?? 0);
                      });
                    })().map((entry) => {
                      if (entry.type === 'refresh') {
                        const refresh = entry.refresh;
                        return (
                          <div key={refresh.txId} className="datapoint-row refresh">
                            <div className="oracle-info">
                              <p className="mono bold">Refresh transaction</p>
                              <p className="muted">
                                Tx {shortenAddress(refresh.txId, 8)}
                              </p>
                            </div>
                            <div className="datapoint-value">
                              <p className="value">—</p>
                              <p className="muted">
                                Includes {includedCount} datapoints
                              </p>
                            </div>
                            <div className="datapoint-meta">
                              <p>
                                Block {refresh.blockHeight} ·{' '}
                                {formatDateTime(refresh.timestamp)}
                              </p>
                              <div className="links">
                                <a
                                  href={explorerLinks.transaction(refresh.txId)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Tx
                                </a>
                              </div>
                            </div>
                            <div className="datapoint-tags">
                              <span className="badge badge-type refresh">Refresh</span>
                            </div>
                          </div>
                        );
                      }
                      const dp = entry.datapoint;
                      const price = deriveQuotePerErg(dp.value);
                      return (
                        <div key={dp.boxId} className={`datapoint-row ${dp.refreshStatus}`}>
                          <div className="oracle-info">
                            <p className="mono bold">
                              {shortenAddress(dp.oracleAddress, 8)}
                            </p>
                          </div>
                          <div className="datapoint-value">
                            <p className="value">{dp.value.toString()}</p>
                            <p className="muted">
                              {price
                                ? `${formatPrice(price)} ${quoteTicker}/ERG`
                                : 'N/A'}
                            </p>
                          </div>
                          <div className="datapoint-meta">
                            <p>
                              Block {dp.blockHeight} ·{' '}
                              {formatDateTime(dp.timestamp)}
                            </p>
                            <div className="links">
                              <a
                                href={explorerLinks.transaction(dp.txId)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Tx
                              </a>
                              <a
                                href={explorerLinks.address(dp.oracleAddress)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Oracle
                              </a>
                            </div>
                          </div>
                          <div className="datapoint-tags">
                            <span className="badge badge-type datapoint">Datapoint</span>
                            <span className={`badge status-badge ${dp.refreshStatus}`}>
                              {dp.refreshStatus === 'included'
                                ? 'Included'
                                : dp.refreshStatus === 'excluded'
                                  ? 'Excluded'
                                  : 'Pending'}
                            </span>
                            {dp.spentTransactionId && (
                              <span className="badge badge-spent">Spent</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div ref={loadMoreRef} className="scroll-sentinel">
        {isLoading
          ? 'Loading more epochs…'
          : hasMore || visibleEpochs.length < epochsWithStatus.length
            ? 'Scroll to load older epochs'
            : 'All available epochs are loaded'}
      </div>

      <footer className="page-footer">
        <div>
          <p className="muted">
            The view automatically loads the latest {MIN_VISIBLE_EPOCHS} epochs. Scroll toward the bottom to load older epochs;
            history is fetched as needed via ergo-node API (page size {DATAPOINT_PAGE_SIZE}).
          </p>
          <p className="muted">
            Deserialization powered by{' '}
            <a href="https://www.npmjs.com/package/ergo-lib-wasm-browser" target="_blank">
              ergo-lib-wasm-browser
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
