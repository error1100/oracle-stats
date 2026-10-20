/** An oracle box carrying a datapoint (R4 oracle key, R5 epoch id, R6 rate). */
export interface OracleDatapoint {
  boxId: string;
  txId: string;
  blockHeight: number;
  globalIndex?: number;
  value: number;
  epochId: number;
  oracleAddress: string;
  spentTransactionId?: string | null;
}

/** A pool box: created by the refresh that started `epochId`, publishing `rate`. */
export interface PoolBoxSnapshot {
  boxId: string;
  txId: string;
  blockHeight: number;
  epochId: number;
  rate: number;
}

export interface PoolParameters {
  epochLength: number;
  minDataPoints: number;
  maxDeviationPercent: number;
  bufferLength: number;
}
