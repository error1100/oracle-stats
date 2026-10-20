import type { OraclePoolConfig } from '../config';
import { usePoolData } from '../hooks/usePoolData';
import { EpochLedger } from './EpochLedger';
import { HealthCards } from './HealthCards';
import { OracleRoster } from './OracleRoster';
import { TopBar } from './TopBar';

interface PoolDashboardProps {
  pools: OraclePoolConfig[];
  pool: OraclePoolConfig;
  onSelectPool: (poolId: string) => void;
  nodeUrl: string;
  onNodeUrlChange: (url: string) => void;
}

/** Mounted with a key per pool + node, so switching either starts from a clean slate. */
export const PoolDashboard = ({ pools, pool, onSelectPool, nodeUrl, onNodeUrlChange }: PoolDashboardProps) => {
  const data = usePoolData(pool, nodeUrl);
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
        nodeUrl={nodeUrl}
        onNodeUrlChange={onNodeUrlChange}
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
