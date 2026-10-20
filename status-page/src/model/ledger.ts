import type { OracleDatapoint, PoolBoxSnapshot, PoolParameters } from '../types/datapoint';

/**
 * - included: consumed by the refresh that closed its epoch
 * - reposted: the same oracle posted again in the same epoch, superseding this box
 * - late: posted at or after the refresh block
 * - rejected: posted in time but not consumed by the refresh
 * - pending: epoch still open
 */
export type DatapointStatus = 'included' | 'reposted' | 'late' | 'rejected' | 'pending';

/** Per oracle and epoch; `absent` (closed) and `awaiting` (open) mean no datapoint. */
export type CellStatus = DatapointStatus | 'absent' | 'awaiting';

export interface LedgerDatapoint extends OracleDatapoint {
  status: DatapointStatus;
  /** Blocks since the epoch's pool box. */
  offset: number;
  /** Percent deviation from the rate published by the closing refresh. */
  deviation: number | null;
}

export interface LedgerCell {
  status: CellStatus;
  reposts: number;
  datapoints: LedgerDatapoint[];
}

export interface LedgerEpoch {
  epochId: number;
  startHeight: number;
  endHeight: number | null;
  /** Blocks from the pool box to the refresh (or to the current height while open). */
  duration: number;
  closed: boolean;
  refreshTxId: string | null;
  /** Rate published by the refresh that closed this epoch. */
  rate: number | null;
  /** Rate in force during this epoch. */
  previousRate: number;
  /** Percent change of the quote price (1e9 / rate) caused by this epoch's refresh. */
  quoteChange: number | null;
  /** (max − min) / min of included values, in percent. */
  spread: number | null;
  includedCount: number;
  datapoints: LedgerDatapoint[];
  cells: Map<string, LedgerCell>;
  overrun: boolean;
  /** Oracle whose first datapoint arrived last in an overrun epoch. */
  bottleneck: string | null;
}

export interface OracleStats {
  address: string;
  included: number;
  epochs: number;
  medianFirstPostOffset: number | null;
  stalls: number;
  /** Posted at least once in the listed epochs. */
  active: boolean;
}

export interface Ledger {
  epochs: LedgerEpoch[];
  /**
   * Every known oracle (registered or seen posting): those that posted in the listed epochs
   * first, then idle ones, each group sorted by address so columns stay put.
   */
  oracles: string[];
  stats: Map<string, OracleStats>;
}

export interface LedgerInput {
  datapoints: OracleDatapoint[];
  poolBoxes: PoolBoxSnapshot[];
  params: PoolParameters | null;
  height: number | null;
  /** Lowest inclusion height of the loaded oracle boxes; everything above it is loaded. */
  datapointsLoadedFromHeight: number | null;
  allDatapointsLoaded: boolean;
  epochLimit: number;
  /** Addresses currently holding an oracle token. */
  registeredOracles: string[];
}

const CELL_PRIORITY: CellStatus[] = ['included', 'pending', 'late', 'rejected', 'reposted'];

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const byHeightThenIndex = (a: OracleDatapoint, b: OracleDatapoint) =>
  a.blockHeight - b.blockHeight || (a.globalIndex ?? 0) - (b.globalIndex ?? 0);

export const buildLedger = ({
  datapoints,
  poolBoxes,
  params,
  height,
  datapointsLoadedFromHeight,
  allDatapointsLoaded,
  epochLimit,
  registeredOracles,
}: LedgerInput): Ledger => {
  // A contract update can recreate the pool box within an epoch; the first box marks its start.
  const poolBoxByEpoch = new Map<number, PoolBoxSnapshot>();
  for (const box of poolBoxes) {
    const existing = poolBoxByEpoch.get(box.epochId);
    if (!existing || box.blockHeight < existing.blockHeight) {
      poolBoxByEpoch.set(box.epochId, box);
    }
  }

  const datapointsByEpoch = new Map<number, OracleDatapoint[]>();
  for (const dp of datapoints) {
    const list = datapointsByEpoch.get(dp.epochId);
    if (list) list.push(dp);
    else datapointsByEpoch.set(dp.epochId, [dp]);
  }

  // Newest first; stop at the first closed epoch whose datapoints may be only partly loaded.
  const epochIds = [...poolBoxByEpoch.keys()].sort((a, b) => b - a);
  const listedIds: number[] = [];
  for (const epochId of epochIds) {
    if (listedIds.length >= epochLimit) break;
    const start = poolBoxByEpoch.get(epochId)!.blockHeight;
    const complete =
      allDatapointsLoaded ||
      (datapointsLoadedFromHeight !== null && datapointsLoadedFromHeight < start);
    const isOpen = listedIds.length === 0 && !poolBoxByEpoch.has(epochId + 1);
    if (!complete && !isOpen) break;
    listedIds.push(epochId);
  }

  const posted = new Set<string>();
  for (const epochId of listedIds) {
    datapointsByEpoch.get(epochId)?.forEach((dp) => posted.add(dp.oracleAddress));
  }
  const oracles = [
    ...[...posted].sort(),
    ...[...new Set(registeredOracles)].filter((address) => !posted.has(address)).sort(),
  ];

  const epochs = listedIds.map((epochId): LedgerEpoch => {
    const poolBox = poolBoxByEpoch.get(epochId)!;
    const nextPoolBox = poolBoxByEpoch.get(epochId + 1);
    const closed = Boolean(nextPoolBox);
    const startHeight = poolBox.blockHeight;
    const endHeight = nextPoolBox?.blockHeight ?? null;
    const rate = nextPoolBox?.rate ?? null;
    const sorted = [...(datapointsByEpoch.get(epochId) ?? [])].sort(byHeightThenIndex);

    const lastIndexByOracle = new Map<string, number>();
    sorted.forEach((dp, index) => lastIndexByOracle.set(dp.oracleAddress, index));

    const ledgerDatapoints = sorted.map((dp, index): LedgerDatapoint => {
      const supersededInEpoch = lastIndexByOracle.get(dp.oracleAddress) !== index;
      let status: DatapointStatus;
      if (!closed) {
        status = supersededInEpoch ? 'reposted' : 'pending';
      } else if (dp.spentTransactionId === nextPoolBox!.txId) {
        status = 'included';
      } else if (dp.blockHeight >= endHeight!) {
        status = 'late';
      } else {
        status = supersededInEpoch ? 'reposted' : 'rejected';
      }
      return {
        ...dp,
        status,
        offset: dp.blockHeight - startHeight,
        deviation: rate ? ((dp.value - rate) / rate) * 100 : null,
      };
    });

    const cells = new Map<string, LedgerCell>();
    for (const address of oracles) {
      const own = ledgerDatapoints.filter((dp) => dp.oracleAddress === address);
      const status: CellStatus = own.length
        ? CELL_PRIORITY.find((candidate) => own.some((dp) => dp.status === candidate))!
        : closed
          ? 'absent'
          : 'awaiting';
      cells.set(address, {
        status,
        reposts: own.filter((dp) => dp.status === 'reposted').length,
        datapoints: own,
      });
    }

    const included = ledgerDatapoints.filter((dp) => dp.status === 'included');
    const includedValues = included.map((dp) => dp.value);
    const minValue = Math.min(...includedValues);
    const duration = (endHeight ?? height ?? startHeight) - startHeight;
    // Epochs running past epoch length + buffer are flagged as overrun.
    const overrun = Boolean(params && closed && duration > params.epochLength + params.bufferLength);

    let bottleneck: string | null = null;
    if (overrun && params) {
      const firstOffsets = [...cells]
        .filter(([, cell]) => cell.datapoints.length)
        .map(([address, cell]) => ({ address, offset: cell.datapoints[0].offset }))
        .sort((a, b) => b.offset - a.offset);
      const [latest, runnerUp] = firstOffsets;
      if (latest && latest.offset > params.epochLength && latest.offset !== runnerUp?.offset) {
        bottleneck = latest.address;
      }
    }

    return {
      epochId,
      startHeight,
      endHeight,
      duration,
      closed,
      refreshTxId: nextPoolBox?.txId ?? null,
      rate,
      previousRate: poolBox.rate,
      quoteChange: rate ? (poolBox.rate / rate - 1) * 100 : null,
      spread: includedValues.length
        ? ((Math.max(...includedValues) - minValue) / minValue) * 100
        : null,
      includedCount: included.length,
      datapoints: [...ledgerDatapoints].reverse(),
      cells,
      overrun,
      bottleneck,
    };
  });

  const closedEpochs = epochs.filter((epoch) => epoch.closed);
  const stats = new Map<string, OracleStats>(
    oracles.map((address) => {
      const cells = closedEpochs.map((epoch) => epoch.cells.get(address)!);
      return [
        address,
        {
          address,
          included: cells.filter((cell) => cell.status === 'included').length,
          epochs: cells.length,
          medianFirstPostOffset: median(
            cells.filter((cell) => cell.datapoints.length).map((cell) => cell.datapoints[0].offset),
          ),
          stalls: closedEpochs.filter((epoch) => epoch.bottleneck === address).length,
          active: posted.has(address),
        },
      ];
    }),
  );

  return { epochs, oracles, stats };
};
