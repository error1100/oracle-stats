import { Fragment, useEffect, useRef, useState } from 'react';
import type { Ledger, LedgerCell, LedgerEpoch } from '../model/ledger';
import type { PoolParameters } from '../types/datapoint';
import { formatQuote, formatSignedPercent, shortenAddress } from '../utils/format';
import { EpochTransactions } from './EpochTransactions';
import { StatusLegend } from './StatusLegend';

interface EpochLedgerProps {
  ledger: Ledger;
  params: PoolParameters | null;
  quoteTicker: string;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}

const DURATION_BAR_WIDTH = 90;
/** Spread bars show ±0.5% around the published rate; wider deviations are clamped. */
const SPREAD_RANGE_PERCENT = 0.5;

const cellTitle = (address: string, epoch: LedgerEpoch, cell: LedgerCell) => {
  const header = `${shortenAddress(address, 6)} · epoch ${epoch.epochId}`;
  if (!cell.datapoints.length) {
    return `${header}\n${epoch.closed ? 'no datapoint' : 'not posted yet'}`;
  }
  const lines = cell.datapoints.map(
    (dp) =>
      `${dp.status} · ${formatQuote(dp.value)} · block ${dp.blockHeight} (+${dp.offset})` +
      (dp.deviation !== null ? ` · ${formatSignedPercent(dp.deviation, 3)}` : ''),
  );
  const bottleneck = epoch.bottleneck === address ? ['quorum bottleneck: first datapoint arrived last'] : [];
  return [header, ...lines, ...bottleneck].join('\n');
};

const DurationBar = ({ epoch, params, maxDuration }: { epoch: LedgerEpoch; params: PoolParameters | null; maxDuration: number }) => {
  const scale = DURATION_BAR_WIDTH / maxDuration;
  const base = params ? Math.min(epoch.duration, params.epochLength) : epoch.duration;
  const excess = params ? Math.max(0, epoch.duration - params.epochLength) : 0;
  return (
    <div className="duration">
      <svg width={DURATION_BAR_WIDTH} height="10" aria-hidden="true">
        <rect width={DURATION_BAR_WIDTH} height="8" y="1" rx="2" fill="var(--surface-2)" />
        <rect
          width={Math.max(2, Math.min(base, maxDuration) * scale)}
          height="8"
          y="1"
          rx="2"
          fill={epoch.closed ? 'var(--violet)' : 'var(--accent)'}
          opacity="0.8"
        />
        {excess > 0 && params && (
          <rect
            x={params.epochLength * scale}
            width={Math.min(excess, maxDuration - params.epochLength) * scale}
            height="8"
            y="1"
            rx="2"
            fill={epoch.overrun ? 'var(--warning)' : 'var(--violet)'}
            opacity={epoch.overrun ? 1 : 0.45}
          />
        )}
        {params && (
          <line
            x1={params.epochLength * scale}
            x2={params.epochLength * scale}
            y1="0"
            y2="10"
            stroke="var(--fg)"
          />
        )}
      </svg>
      <span className={`mono ${epoch.overrun ? 'warn' : ''}`}>{epoch.duration}</span>
    </div>
  );
};

const SpreadBar = ({ epoch }: { epoch: LedgerEpoch }) => {
  const deviations = epoch.datapoints
    .filter((dp) => dp.status === 'included' && dp.deviation !== null)
    .map((dp) => dp.deviation!);
  if (!deviations.length || epoch.spread === null) {
    return <span className="muted">—</span>;
  }
  const min = Math.min(...deviations);
  const max = Math.max(...deviations);
  const toPercentX = (deviation: number) =>
    50 + (Math.max(-SPREAD_RANGE_PERCENT, Math.min(SPREAD_RANGE_PERCENT, deviation)) / SPREAD_RANGE_PERCENT) * 50;
  const left = toPercentX(min);
  return (
    <span
      className="spread"
      title={`Spread ${epoch.spread.toFixed(2)}% · included values span ${formatSignedPercent(min, 3)} … ${formatSignedPercent(max, 3)} around the published rate`}
    >
      <span className="spread-track">
        <b style={{ left: `${left}%`, width: `${Math.max(3, toPercentX(max) - left)}%` }} />
        <i />
      </span>
    </span>
  );
};

const epochNote = (epoch: LedgerEpoch) => {
  if (epoch.bottleneck) {
    return <span className="warn">waited on {shortenAddress(epoch.bottleneck, 4)}</span>;
  }
  const count = (status: string) => epoch.datapoints.filter((dp) => dp.status === status).length;
  const parts = [
    [count('rejected'), 'rejected'],
    [count('late'), 'late'],
    [count('reposted'), 'reposts'],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return parts.join(' · ');
};

export const EpochLedger = ({ ledger, params, quoteTicker, hasMore, isLoading, onLoadMore }: EpochLedgerProps) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  const maxDuration = Math.max(
    ...ledger.epochs.map((epoch) => epoch.duration),
    (params?.epochLength ?? 1) * 2,
  );
  const activeOracleCount = ledger.oracles.filter((address) => ledger.stats.get(address)!.active).length;

  const toggle = (epochId: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(epochId)) next.add(epochId);
      return next;
    });

  return (
    <section className="panel">
      <header className="panel-header">
        <h3>Epochs</h3>
        <StatusLegend />
      </header>
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>epoch</th>
              <th>blocks{params ? ` (| = ${params.epochLength})` : ''}</th>
              <th className="num">{quoteTicker}/ERG</th>
              <th className="num">Δ</th>
              <th>spread (±{SPREAD_RANGE_PERCENT}%)</th>
              <th title="Every registered oracle; idle ones (no datapoint in the listed epochs) are dimmed on the right">
                oracles · {activeOracleCount} active · {ledger.oracles.length - activeOracleCount} idle
              </th>
              <th className="num">incl.</th>
              <th className="num">refresh</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>
            {ledger.epochs.map((epoch) => {
              const isOpen = expanded.has(epoch.epochId);
              const rowClass = [
                'ledger-row',
                isOpen ? 'open' : '',
                epoch.overrun ? 'overrun' : '',
                epoch.closed ? '' : 'current',
              ].join(' ');
              const submitted = new Set(epoch.datapoints.map((dp) => dp.oracleAddress)).size;
              return (
                <Fragment key={epoch.epochId}>
                  <tr
                    className={rowClass}
                    onClick={() => toggle(epoch.epochId)}
                    aria-expanded={isOpen}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle(epoch.epochId);
                      }
                    }}
                  >
                    <td className="mono">
                      <span className="caret">{isOpen ? '▾' : '▸'}</span> {epoch.epochId}
                    </td>
                    <td>
                      <DurationBar epoch={epoch} params={params} maxDuration={maxDuration} />
                    </td>
                    <td className="num">{epoch.closed ? formatQuote(epoch.rate) : <span className="muted">pending</span>}</td>
                    <td className={`num ${epoch.quoteChange === null ? '' : epoch.quoteChange >= 0 ? 'up' : 'down'}`}>
                      {epoch.quoteChange !== null ? formatSignedPercent(epoch.quoteChange) : ''}
                    </td>
                    <td>
                      <SpreadBar epoch={epoch} />
                    </td>
                    <td>
                      <div className="chips">
                        {ledger.oracles.map((address, index) => {
                          const cell = epoch.cells.get(address)!;
                          const active = ledger.stats.get(address)!.active;
                          const firstIdle = !active && index > 0 && ledger.stats.get(ledger.oracles[index - 1])!.active;
                          const classes = [
                            'glyph',
                            cell.status,
                            cell.reposts && cell.status === 'included' ? 'repost' : '',
                            epoch.bottleneck === address ? 'bottleneck' : '',
                            active ? '' : 'idle',
                            firstIdle ? 'idle-start' : '',
                          ].join(' ');
                          return <span key={address} className={classes} title={cellTitle(address, epoch, cell)} />;
                        })}
                      </div>
                    </td>
                    <td
                      className={`num ${
                        params && epoch.closed && epoch.includedCount < params.minDataPoints ? 'warn' : ''
                      }`}
                    >
                      {epoch.closed ? epoch.includedCount : submitted}
                      {params ? `/${params.minDataPoints}` : ''}
                    </td>
                    <td className="num muted">{epoch.endHeight ?? '—'}</td>
                    <td className="muted note-cell">{epochNote(epoch)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="ledger-expand">
                      <td colSpan={9}>
                        <EpochTransactions epoch={epoch} quoteTicker={quoteTicker} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div ref={sentinelRef} className="sentinel">
        {isLoading ? 'Loading epochs…' : hasMore ? 'Scroll for older epochs' : 'All available epochs loaded'}
      </div>
    </section>
  );
};
