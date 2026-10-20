import type { Ledger } from '../model/ledger';
import { buildExplorerLinks } from '../services/datapointService';
import { shortenAddress } from '../utils/format';

interface OracleRosterProps {
  ledger: Ledger;
}

export const OracleRoster = ({ ledger }: OracleRosterProps) => {
  // Oldest → newest so each strip reads left to right.
  const closedEpochs = ledger.epochs.filter((epoch) => epoch.closed).reverse();

  return (
    <section className="panel roster">
      <header className="panel-header">
        <h3>Oracles · last {closedEpochs.length} epochs</h3>
      </header>
      {ledger.oracles.map((address) => {
        const stats = ledger.stats.get(address)!;
        const inclusion = stats.epochs ? Math.round((100 * stats.included) / stats.epochs) : 0;
        return (
          <div className={`roster-row ${stats.active ? '' : 'idle'}`} key={address}>
            <a
              className={`mono ${stats.stalls ? 'warn' : ''}`}
              href={buildExplorerLinks.address(address)}
              target="_blank"
              rel="noreferrer"
              title={address}
            >
              {shortenAddress(address, 4)}
            </a>
            <div className="strip">
              {closedEpochs.map((epoch) => {
                const cell = epoch.cells.get(address)!;
                const kind =
                  epoch.bottleneck === address
                    ? 'bottleneck'
                    : cell.status !== 'included'
                      ? cell.status
                      : cell.reposts
                        ? 'repost'
                        : 'included';
                return (
                  <i
                    key={epoch.epochId}
                    className={kind}
                    title={`epoch ${epoch.epochId}: ${cell.status}${cell.reposts ? ` (${cell.reposts} repost)` : ''}`}
                  />
                );
              })}
            </div>
            <span
              className="mono muted"
              title="included share · median blocks to first post · overrun epochs it held up"
            >
              {stats.active ? (
                <>
                  {inclusion}%{stats.medianFirstPostOffset !== null ? ` · +${stats.medianFirstPostOffset}` : ''}
                  {stats.stalls > 0 && <span className="warn"> · {stats.stalls}⚑</span>}
                </>
              ) : (
                'idle'
              )}
            </span>
          </div>
        );
      })}
    </section>
  );
};
