import type { OraclePoolConfig } from '../config';
import {
  DATAPOINT_PAGE_SIZE,
  DEFAULT_ERGO_NODE_URL,
  EXPLORER_UI_URL,
} from '../config';
import { decodeI32Register, decodeI64Register, decodeOraclePublicKey } from '../lib/ergo';
import type { OracleDatapoint } from '../types/datapoint';
import type { IndexedErgoBox, IndexedErgoBoxResponse } from '../types/ergoNode';

export interface RefreshBoxMarker {
  boxId: string;
  txId: string;
  blockHeight: number;
  globalIndex?: number;
  value?: number;
}

export interface ErgoNodeInfo {
  name: string;
  version: string;
  fullHeight: number;
  headersHeight: number;
  stateRoot: string;
  previousFullHash: string;
  stateVersion: string;
  network: string;
}

export interface DatapointPageResult {
  datapoints: OracleDatapoint[];
  totals: {
    oracle: number;
    datapoint: number;
  };
  pageCounts: {
    oracle: number;
    datapoint: number;
  };
  refreshBoxes: RefreshBoxMarker[];
  oracleSnapshots: OraclePoolSnapshot[];
}

export interface OraclePoolSnapshot {
  epochId: number;
  value: number;
  blockHeight: number;
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ergo node error (${response.status}): ${response.statusText}`);
  }
  return response.json() as Promise<T>;
};

const buildTokenUrl = (nodeUrl: string, tokenId: string, offset: number, limit: number) => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  return `${nodeUrl}/blockchain/box/byTokenId/${tokenId}?${params.toString()}`;
};

const fetchBoxesByTokenId = async (
  nodeUrl: string,
  tokenId: string,
  offset: number,
  limit: number,
) => fetchJson<IndexedErgoBoxResponse>(buildTokenUrl(nodeUrl, tokenId, offset, limit));

const buildUnspentTokenUrl = (nodeUrl: string, tokenId: string, offset: number, limit: number) => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  return `${nodeUrl}/blockchain/box/unspent/byTokenId/${tokenId}?${params.toString()}`;
};

type UnspentBoxResponse = IndexedErgoBoxResponse | IndexedErgoBox[];

const fetchUnspentBoxesByTokenId = async (
  nodeUrl: string,
  tokenId: string,
  offset: number,
  limit: number,
) => fetchJson<UnspentBoxResponse>(buildUnspentTokenUrl(nodeUrl, tokenId, offset, limit));

const fetchAllUnspentBoxesByTokenId = async (
  nodeUrl: string,
  tokenId: string,
  pageSize = 100,
): Promise<IndexedErgoBox[]> => {
  const items: IndexedErgoBox[] = [];
  let offset = 0;
  while (true) {
    const responseRaw = await fetchUnspentBoxesByTokenId(nodeUrl, tokenId, offset, pageSize);
    const response: IndexedErgoBoxResponse = Array.isArray(responseRaw)
      ? { items: responseRaw, total: responseRaw.length }
      : responseRaw;
    items.push(...response.items);
    const pageLength = response.items.length;
    const total = response.total ?? items.length;
    if (Array.isArray(responseRaw) || pageLength === 0 || items.length >= total) {
      break;
    }
    offset += pageLength;
  }
  return items;
};

const decodeOracleDatapoint = (
  poolId: string,
  tokenId: string,
  source: OracleDatapoint['source'],
  box: IndexedErgoBox,
): OracleDatapoint | undefined => {
  const registers = box.additionalRegisters ?? {};
  const r4 = registers.R4;
  const r5 = registers.R5;
  const r6 = registers.R6;
  if (!r4 || !r5 || !r6) {
    return undefined;
  }

  try {
    const { base58, publicKeyHex } = decodeOraclePublicKey(r4);
    const epochId = decodeI32Register(r5);
    const datapoint = decodeI64Register(r6);
    const blockHeight = box.inclusionHeight ?? box.creationHeight ?? 0;
    return {
      boxId: box.boxId,
      txId: box.transactionId,
      blockHeight,
      value: datapoint,
      ergValue: box.value / 1_000_000_000,
      epochId,
      oracleAddress: base58,
      oraclePublicKeyHex: publicKeyHex,
      spentTransactionId: box.spentTransactionId ?? undefined,
      source,
      tokenId,
      poolId,
      globalIndex: box.globalIndex,
    };
  } catch (error) {
    console.error('Failed to decode oracle datapoint', error, {
      boxId: box.boxId,
      source,
      tokenId,
    });
    return undefined;
  }
};

export const fetchDatapointPage = async (
  pool: OraclePoolConfig,
  page: number,
  pageSize = DATAPOINT_PAGE_SIZE,
): Promise<DatapointPageResult> => {
  const nodeUrl = pool.ergoNodeApiUrl ?? pool.ergoNodeUrl ?? DEFAULT_ERGO_NODE_URL;
  const offset = page * pageSize;
  const refreshTokenId = pool.refreshTokenId;
  const [oracleBoxes, datapointBoxes, refreshBoxesResponse] = await Promise.all([
    fetchBoxesByTokenId(nodeUrl, pool.oraclePoolTokenId, offset, pageSize),
    fetchBoxesByTokenId(nodeUrl, pool.datapointTokenId, offset, pageSize),
    refreshTokenId
      ? fetchBoxesByTokenId(nodeUrl, refreshTokenId, offset, pageSize)
      : Promise.resolve<IndexedErgoBoxResponse>({ items: [], total: 0 }),
  ]);

  const oracleData = oracleBoxes.items
    .map((box) => decodeOracleDatapoint(pool.id, pool.oraclePoolTokenId, 'oracleBox', box))
    .filter((box): box is OracleDatapoint => Boolean(box));
  const datapointData = datapointBoxes.items
    .map((box) => decodeOracleDatapoint(pool.id, pool.datapointTokenId, 'datapointBox', box))
    .filter((box): box is OracleDatapoint => Boolean(box));

  const oracleSnapshots = oracleBoxes.items
    .map((box) => decodeOraclePoolSnapshot(box))
    .filter((snapshot): snapshot is OraclePoolSnapshot => Boolean(snapshot));

  const deduped = new Map<string, OracleDatapoint>();
  [...oracleData, ...datapointData].forEach((dp) => {
    const existing = deduped.get(dp.boxId);
    if (!existing || (existing.source === 'oracleBox' && dp.source === 'datapointBox')) {
      deduped.set(dp.boxId, dp);
    }
  });

  const sorted = Array.from(deduped.values()).sort((a, b) => b.blockHeight - a.blockHeight);

  const refreshMarkersBase: RefreshBoxMarker[] = refreshBoxesResponse.items.map((box) => ({
    boxId: box.boxId,
    txId: box.transactionId,
    blockHeight: box.inclusionHeight ?? box.creationHeight ?? 0,
    globalIndex: box.globalIndex,
    value: box.additionalRegisters?.R4 ? decodeI64Register(box.additionalRegisters.R4) : undefined,
  }));

  return {
    datapoints: sorted,
    totals: {
      oracle: oracleBoxes.total,
      datapoint: datapointBoxes.total,
    },
    pageCounts: {
      oracle: oracleBoxes.items.length,
      datapoint: datapointBoxes.items.length,
    },
    refreshBoxes: refreshMarkersBase,
    oracleSnapshots,
  };
};

export const fetchOperatorAddresses = async (pool: OraclePoolConfig): Promise<string[]> => {
  const nodeUrl = pool.ergoNodeApiUrl ?? pool.ergoNodeUrl ?? DEFAULT_ERGO_NODE_URL;
  const unspentBoxes = await fetchAllUnspentBoxesByTokenId(nodeUrl, pool.datapointTokenId);
  const balancesByAddress = new Map<string, number>();
  unspentBoxes.forEach((box) => {
    const datapointAsset = box.assets.find((asset) => asset.tokenId === pool.datapointTokenId);
    const r4 = box.additionalRegisters?.R4;
    if (!datapointAsset || datapointAsset.amount <= 0 || !r4) {
      return;
    }
    try {
      const { base58 } = decodeOraclePublicKey(r4);
      const currentAmount = balancesByAddress.get(base58) ?? 0;
      balancesByAddress.set(base58, currentAmount + datapointAsset.amount);
    } catch (error) {
      console.error('Failed to decode operator register', { boxId: box.boxId }, error);
    }
  });
  return Array.from(balancesByAddress.entries())
    .filter(([, amount]) => amount === 1)
    .map(([address]) => address);
};

export const fetchLatestOraclePoolValue = async (
  pool: OraclePoolConfig,
): Promise<number | null> => {
  const nodeUrl = pool.ergoNodeApiUrl ?? pool.ergoNodeUrl ?? DEFAULT_ERGO_NODE_URL;
  const boxesRaw = await fetchUnspentBoxesByTokenId(nodeUrl, pool.oraclePoolTokenId, 0, 50);
  const response: IndexedErgoBoxResponse = Array.isArray(boxesRaw)
    ? { items: boxesRaw, total: boxesRaw.length }
    : boxesRaw;
  if (!response.items.length) {
    return null;
  }
  const box = [...response.items].sort(
    (a, b) =>
      (b.inclusionHeight ?? b.creationHeight ?? 0) -
      (a.inclusionHeight ?? a.creationHeight ?? 0),
  )[0];
  const registers = box?.additionalRegisters ?? {};
  if (!registers.R4 || !registers.R5) {
    return null;
  }
  try {
    const value = decodeI64Register(registers.R4);
    return value;
  } catch (error) {
    console.error('Failed to decode oracle pool value', { boxId: box.boxId }, error);
    return null;
  }
};

export const fetchNodeInfo = async (baseUrl: string): Promise<ErgoNodeInfo> =>
  fetchJson<ErgoNodeInfo>(`${baseUrl}/info`);

export const buildExplorerLinks = {
  transaction: (txId: string) => `${EXPLORER_UI_URL}/en/transactions/${txId}`,
  box: (boxId: string) => `${EXPLORER_UI_URL}/en/box/${boxId}`,
  address: (address: string) => `${EXPLORER_UI_URL}/en/addresses/${address}`,
  token: (tokenId: string) => `${EXPLORER_UI_URL}/en/token/${tokenId}`,
};
const decodeOraclePoolSnapshot = (box: IndexedErgoBox): OraclePoolSnapshot | undefined => {
  const registers = box.additionalRegisters ?? {};
  const r4 = registers.R4;
  const r5 = registers.R5;
  if (!r4 || !r5) {
    return undefined;
  }
  try {
    const value = decodeI64Register(r4);
    const epochId = decodeI32Register(r5);
    const blockHeight = box.inclusionHeight ?? box.creationHeight ?? 0;
    return { value, epochId, blockHeight };
  } catch (error) {
    console.error('Failed to decode oracle pool snapshot', { boxId: box.boxId }, error);
    return undefined;
  }
};
