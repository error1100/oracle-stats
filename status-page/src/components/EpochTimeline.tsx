import type { RefreshBoxMarker } from '../services/datapointService';
import type { OracleDatapoint } from '../types/datapoint';
import { formatDateTime, formatNumber, formatRelativeTime, shortenAddress } from '../utils/format';

export interface TimelineEpochRange {
  epochId: number;
  startIndex: number;
  endIndex: number;
  postedAt?: number;
  refreshHeight?: number;
  refreshTxId?: string;
}

interface EpochTimelineProps {
  epochRanges: TimelineEpochRange[];
  refreshMarkers: RefreshBoxMarker[];
  epochDatapoints: Record<number, (OracleDatapoint & { refreshStatus?: 'included' | 'excluded' | 'pending' })[]>;
}

const EpochTimeline = ({ epochRanges, refreshMarkers, epochDatapoints }: EpochTimelineProps) => {
  if (!epochRanges.length) {
    return null;
  }

  const refreshByEpoch = new Map<number, RefreshBoxMarker>();
  refreshMarkers.forEach((marker) => {
    const range = epochRanges.find((epoch) => epoch.refreshTxId === marker.txId || epoch.refreshHeight === marker.blockHeight);
    if (range) {
      refreshByEpoch.set(range.epochId, marker);
    }
  });

  return (
    <section className="timeline-section">
      <header className="timeline-header">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2>Epoch datapoint progression</h2>
        </div>
        <p className="muted">
          Epochs are displayed left to right. Each container shows datapoints (ordered by time) followed by the refresh box.
          Included datapoints and the refresh box are green; excluded ones are faded.
        </p>
      </header>
      <div className="timeline-track epochs-inline">
        {epochRanges.map((range) => {
          const datapoints = epochDatapoints[range.epochId] ?? [];
          const refreshMarker = refreshByEpoch.get(range.epochId);
          return (
            <div key={range.epochId} className="epoch-card timeline">
              <div className="epoch-card-header">
                <div>
                  <p className="eyebrow">Epoch</p>
                  <h3>#{range.epochId}</h3>
                </div>
                <div className="epoch-meta">
                  <span>{range.postedAt ? formatRelativeTime(range.postedAt) : 'unknown timing'}</span>
                  {range.refreshHeight && (
                    <span className="refresh-chip">Refresh #{range.refreshHeight}</span>
                  )}
                </div>
              </div>
              <div className="epoch-points">
                {datapoints.map((dp) => (
                  <div
                    key={`${dp.boxId}-${dp.oracleAddress}`}
                    className={`datapoint-dot ${dp.source} ${dp.refreshStatus ?? ''}`}
                    title={`Oracle ${shortenAddress(dp.oracleAddress, 6)} • ${formatNumber(dp.value)} • ${
                      dp.source === 'datapointBox' ? 'datapoint NFT' : 'oracle NFT'
                    }\n${formatDateTime(dp.timestamp)}`}
                  />
                ))}
                {refreshMarker && (
                  <div
                    className="refresh-marker refresh-dot"
                    title={`Refresh block #${refreshMarker.blockHeight}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default EpochTimeline;
