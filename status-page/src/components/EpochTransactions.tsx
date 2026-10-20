import type { LedgerEpoch } from '../model/ledger';
import { buildExplorerLinks } from '../services/datapointService';
import { formatQuote, formatSignedPercent, shortenAddress } from '../utils/format';

interface EpochTransactionsProps {
  epoch: LedgerEpoch;
  quoteTicker: string;
}

export const EpochTransactions = ({ epoch, quoteTicker }: EpochTransactionsProps) => (
  <table className="tx-table">
    <thead>
      <tr>
        <th>oracle</th>
        <th className="num">value</th>
        <th className="num">{quoteTicker}/ERG</th>
        <th className="num">Δ vs published</th>
        <th className="num">block</th>
        <th className="num">offset</th>
        <th>status</th>
        <th />
      </tr>
    </thead>
    <tbody>
      {epoch.refreshTxId && epoch.endHeight !== null && (
        <tr className="refresh-row">
          <td>refresh</td>
          <td className="num">{epoch.rate}</td>
          <td className="num">{formatQuote(epoch.rate)}</td>
          <td className="num">—</td>
          <td className="num">{epoch.endHeight}</td>
          <td className="num">+{epoch.duration}</td>
          <td>
            <span className="pill included">{epoch.includedCount} included</span>
          </td>
          <td>
            <a href={buildExplorerLinks.transaction(epoch.refreshTxId)} target="_blank" rel="noreferrer">
              tx
            </a>
          </td>
        </tr>
      )}
      {epoch.datapoints.map((dp) => (
        <tr key={dp.boxId} className={dp.status === 'included' || dp.status === 'pending' ? '' : 'dim'}>
          <td className="mono">
            <a href={buildExplorerLinks.address(dp.oracleAddress)} target="_blank" rel="noreferrer">
              {shortenAddress(dp.oracleAddress, 4)}
            </a>
            {epoch.bottleneck === dp.oracleAddress && (
              <span className="warn" title="Quorum bottleneck: first datapoint arrived last">
                {' '}
                ◆
              </span>
            )}
          </td>
          <td className="num">{dp.value}</td>
          <td className="num">{formatQuote(dp.value)}</td>
          <td className="num">{dp.deviation !== null ? formatSignedPercent(dp.deviation, 3) : '—'}</td>
          <td className="num">{dp.blockHeight}</td>
          <td className="num">+{dp.offset}</td>
          <td>
            <span className={`pill ${dp.status}`}>{dp.status}</span>
          </td>
          <td>
            <a href={buildExplorerLinks.transaction(dp.txId)} target="_blank" rel="noreferrer">
              tx
            </a>
          </td>
        </tr>
      ))}
      {!epoch.datapoints.length && (
        <tr>
          <td colSpan={8} className="muted">
            No datapoints yet.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);
