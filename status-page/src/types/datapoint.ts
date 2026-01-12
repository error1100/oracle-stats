export type DatapointSource = 'oracleBox' | 'datapointBox';

export interface OracleDatapoint {
  boxId: string;
  txId: string;
  blockHeight: number;
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
  blockHeight: number;
  datapoints: OracleDatapoint[];
}
