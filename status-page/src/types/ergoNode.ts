export interface IndexedTokenAmount {
  tokenId: string;
  amount: number;
}

export interface IndexedErgoBox {
  boxId: string;
  transactionId: string;
  value: number;
  index: number;
  creationHeight: number;
  inclusionHeight?: number;
  address: string;
  globalIndex?: number;
  spentTransactionId?: string | null;
  spendingHeight?: number | null;
  ergoTree: string;
  assets: IndexedTokenAmount[];
  additionalRegisters?: Record<string, string>;
}

export interface IndexedErgoBoxResponse {
  items: IndexedErgoBox[];
  total: number;
}

export interface BlockHeader {
  id: string;
  timestamp: number;
  height: number;
}
