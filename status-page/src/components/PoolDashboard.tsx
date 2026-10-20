import type { OraclePoolConfig } from '../config';
import type { Settings } from '../settings';
import { usePoolData } from '../hooks/usePoolData';
import { EpochLedger } from './EpochLedger';
import { HealthCards } from './HealthCards';
import { OracleRoster } from './OracleRoster';
import { TopBar } from './TopBar';

interface PoolDashboardProps {
  pools: OraclePoolConfig[];
  pool: OraclePoolConfig;
  onSelectPool: (poolId: string) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onClearCache: () => void;
}

/** Mounted with a key per pool + node, so switching either starts from a clean slate. */
export const PoolDashboard = ({
  pools,
  pool,
  onSelectPool,
  settings,
  onSettingsChange,
  onClearCache,
}: PoolDashboardProps) => {
  const data = usePoolData(pool, settings.nodeUrl, settings.autoRefresh ? settings.refreshIntervalSeconds : null);
  const { ledger, params } = data;
  const currentEpoch = ledger.epochs[0];
  const quoteTicker = pool.quoteTicker ?? 'USD';

  return (
    <div className="page">
      <TopBar
        pools={pools}
        selectedPool={pool}
        onSelectPool={onSelectPool}
        rate={currentEpoch?.previousRate ?? null}
        epochId={currentEpoch?.epochId ?? null}
        height={data.height}
        secondsUntilNextCheck={data.secondsUntilNextCheck}
        isLoading={data.isLoading}
        error={data.error}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onClearCache={onClearCache}
      />
      {data.error && <div className="error-banner">{data.error}</div>}
      <HealthCards ledger={ledger} params={params} registeredCount={data.operators.length} />
      {ledger.epochs.length === 0 ? (
        <div className="panel loading">{data.isLoading ? 'Loading epochs…' : 'No epochs found.'}</div>
      ) : (
        <div className="layout">
          <EpochLedger
            ledger={ledger}
            params={params}
            quoteTicker={quoteTicker}
            hasMore={data.hasMore}
            isLoading={data.isLoading}
            onLoadMore={data.loadMore}
          />
          <OracleRoster ledger={ledger} />
        </div>
      )}
    </div>
  );
};
