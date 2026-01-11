export type DatapointSource = 'oracleBox' | 'datapointBox';

export interface OracleDatapoint {
  boxId: string;
  txId: string;
  blockId?: string;
  blockHeight: number;
  timestamp?: number;
  value: number;
  ergValue: number;
  epochId: number;
  oracleAddress: string;
  oraclePublicKeyHex: string;
  spentTransactionId?: string | null;
  source: DatapointSource;
  tokenId: string;
  poolId: string;
  globalIndex?: number;
}

export interface EpochGroup {
  epochId: number;
  postedAt?: number;
  blockHeight: number;
  datapoints: OracleDatapoint[];
}
