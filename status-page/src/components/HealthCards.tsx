import type { Ledger } from '../model/ledger';
import type { PoolParameters } from '../types/datapoint';

interface HealthCardsProps {
  ledger: Ledger;
  params: PoolParameters | null;
  registeredCount: number;
}

const SPARK_WIDTH = 110;
const SPARK_HEIGHT = 26;

export const HealthCards = ({ ledger, params, registeredCount }: HealthCardsProps) => {
  const openEpoch = ledger.epochs[0] && !ledger.epochs[0].closed ? ledger.epochs[0] : null;
  const closedEpochs = ledger.epochs.filter((epoch) => epoch.closed);
  const lastClosed = closedEpochs[0];

  const active = lastClosed
    ? new Set(lastClosed.datapoints.map((dp) => dp.oracleAddress)).size
    : 0;
  const required = params?.minDataPoints ?? null;
  const spare = required !== null ? active - required : null;
  const slots = Math.max(registeredCount, active);

  const submitted = openEpoch
    ? new Set(openEpoch.datapoints.map((dp) => dp.oracleAddress)).size
    : 0;
  const progress = openEpoch && params ? openEpoch.duration / params.epochLength : 0;

  const durations = closedEpochs.map((epoch) => epoch.duration).reverse();
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)];
  const maxDuration = sortedDurations.at(-1);
  const slowest = closedEpochs.find((epoch) => epoch.duration === maxDuration);
  const sparkMax = Math.max(maxDuration ?? 1, (params?.epochLength ?? 0) * 2);
  const sparkY = (duration: number) => SPARK_HEIGHT - 2 - (duration / sparkMax) * (SPARK_HEIGHT - 4);

  const spread = lastClosed?.spread ?? null;
  const spreadShare = spread !== null && params ? spread / params.maxDeviationPercent : 0;

  return (
    <section className="kpis">
      <div className={`kpi ${spare !== null && spare <= 0 ? 'alert' : ''}`}>
        <h4>Quorum</h4>
        <div className="kpi-value">
          {active} active{required !== null ? ` / ${required} required` : ''}
        </div>
        <div className="kpi-sub">
          {spare !== null ? `${spare} spare · ` : ''}
          {registeredCount} registered
        </div>
        <svg className="kpi-viz" width={slots * 6} height="22" aria-hidden="true">
          {Array.from({ length: slots }, (_, index) => (
            <rect
              key={index}
              x={index * 6}
              y="4"
              width="4"
              height="14"
              rx="1"
              fill={index < active ? 'var(--success)' : 'var(--border)'}
            />
          ))}
          {required !== null && (
            <line x1={required * 6 - 1} x2={required * 6 - 1} y1="0" y2="22" stroke="var(--warning)" strokeWidth="1.5" />
          )}
        </svg>
      </div>

      <div className="kpi">
        <h4>Epoch {openEpoch?.epochId ?? '—'}</h4>
        <div className="kpi-value">
          {openEpoch ? `block ${openEpoch.duration}` : '—'}
          {params ? ` of ${params.epochLength}` : ''}
        </div>
        <div className="kpi-sub">
          {submitted}
          {required !== null ? ` / ${required}` : ''} oracles posted
        </div>
        <svg className="kpi-viz" width="110" height="10" aria-hidden="true">
          <rect width="110" height="8" y="1" rx="4" fill="var(--border)" />
          <rect
            width={Math.max(4, Math.min(1, progress) * 110)}
            height="8"
            y="1"
            rx="4"
            fill={progress > 1 ? 'var(--warning)' : 'var(--accent)'}
          />
        </svg>
      </div>

      <div className="kpi">
        <h4>Refresh cadence</h4>
        <div className="kpi-value">{medianDuration !== undefined ? `median ${medianDuration} blk` : '—'}</div>
        <div className="kpi-sub">
          {slowest ? `max ${maxDuration} (epoch ${slowest.epochId})` : 'no closed epochs yet'}
        </div>
        {durations.length > 1 && (
          <svg className="kpi-viz" width={SPARK_WIDTH} height={SPARK_HEIGHT} aria-hidden="true">
            {params && (
              <line
                x1="0"
                x2={SPARK_WIDTH}
                y1={sparkY(params.epochLength)}
                y2={sparkY(params.epochLength)}
                stroke="var(--faint)"
                strokeDasharray="2 2"
              />
            )}
            <polyline
              fill="none"
              stroke="var(--violet)"
              strokeWidth="1.5"
              points={durations
                .map((d, i) => `${((i * SPARK_WIDTH) / (durations.length - 1)).toFixed(1)},${sparkY(d).toFixed(1)}`)
                .join(' ')}
            />
          </svg>
        )}
      </div>

      <div className="kpi">
        <h4>Spread · epoch {lastClosed?.epochId ?? '—'}</h4>
        <div className="kpi-value">
          {spread !== null ? `${spread.toFixed(2)}%` : '—'}
          {params ? ` of ${params.maxDeviationPercent}% max` : ''}
        </div>
        <div className="kpi-sub">
          {params ? `buffer ${params.bufferLength} blk · min ${params.minDataPoints} datapoints` : 'pool parameters unavailable'}
        </div>
        <svg className="kpi-viz" width="110" height="10" aria-hidden="true">
          <rect width="110" height="8" y="1" rx="4" fill="var(--border)" />
          <rect
            width={Math.max(4, Math.min(1, spreadShare) * 110)}
            height="8"
            y="1"
            rx="4"
            fill={spreadShare > 0.8 ? 'var(--warning)' : 'var(--success)'}
          />
        </svg>
      </div>
    </section>
  );
};
