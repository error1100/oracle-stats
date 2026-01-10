export interface ExplorerTransactionListResponse {
  total: number;
  items: ExplorerTransaction[];
}

export interface ExplorerTransaction {
  id: string;
  blockId: string;
  inclusionHeight: number;
  timestamp: number;
  index: number;
  globalIndex: number;
  numConfirmations: number;
  outputs: ExplorerBox[];
}

export interface ExplorerBox {
  boxId: string;
  transactionId?: string;
  address: string;
  value: number;
  index: number;
  creationHeight?: number;
  settlementHeight?: number;
  spentTransactionId?: string | null;
  additionalRegisters?: Record<string, ExplorerRegister>;
}

export interface ExplorerRegister {
  serializedValue: string;
  sigmaType: string;
  renderedValue?: string;
}
