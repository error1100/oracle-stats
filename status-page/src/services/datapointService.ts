import type { OraclePoolConfig } from '../config';
import {
  DATAPOINT_PAGE_SIZE,
  DEFAULT_REFRESH_CONTRACT_CONSTANT_INDICES,
  EXPLORER_UI_URL,
  POOL_BOX_PAGE_SIZE,
} from '../config';
import {
  decodeErgoTreeIntConstants,
  decodeI32Register,
  decodeI64Register,
  decodeOraclePublicKey,
} from '../lib/ergo';
import type { OracleDatapoint, PoolBoxSnapshot, PoolParameters } from '../types/datapoint';
import type { IndexedErgoBox, IndexedErgoBoxResponse } from '../types/ergoNode';

export interface ErgoNodeInfo {
  name: string;
  version: string;
  fullHeight: number;
  headersHeight: number;
  network: string;
}

export interface DatapointPage {
  datapoints: OracleDatapoint[];
  /** Number of raw boxes returned (including non-datapoint oracle boxes). */
  count: number;
  total: number;
  /** Lowest inclusion height among the raw boxes of this page. */
  oldestHeight: number | null;
  /** Box id of the oldest raw box; used to detect gaps when merging a fresh first page. */
  oldestBoxId: string | null;
}

export interface PoolBoxPage {
  snapshots: PoolBoxSnapshot[];
  count: number;
  total: number;
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ergo node error (${response.status}): ${response.statusText}`);
  }
  return response.json() as Promise<T>;
};

const tokenUrl = (
  nodeUrl: string,
  tokenId: string,
  offset: number,
  limit: number,
  unspentOnly = false,
) => {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const path = unspentOnly ? 'box/unspent/byTokenId' : 'box/byTokenId';
  return `${nodeUrl}/blockchain/${path}/${tokenId}?${params.toString()}`;
};

/** The unspent endpoint returns either a bare array or `{ items, total }` depending on node version. */
const fetchUnspentBoxesByTokenId = async (
  nodeUrl: string,
  tokenId: string,
  offset: number,
  limit: number,
): Promise<IndexedErgoBoxResponse> => {
  const raw = await fetchJson<IndexedErgoBoxResponse | IndexedErgoBox[]>(
    tokenUrl(nodeUrl, tokenId, offset, limit, true),
  );
  return Array.isArray(raw) ? { items: raw, total: raw.length } : raw;
};

const fetchAllUnspentBoxesByTokenId = async (
  nodeUrl: string,
  tokenId: string,
  pageSize = 100,
): Promise<IndexedErgoBox[]> => {
  const items: IndexedErgoBox[] = [];
  let offset = 0;
  while (true) {
    const response = await fetchUnspentBoxesByTokenId(nodeUrl, tokenId, offset, pageSize);
    items.push(...response.items);
    if (response.items.length < pageSize || items.length >= response.total) {
      return items;
    }
    offset += response.items.length;
  }
};

const boxHeight = (box: IndexedErgoBox) => box.inclusionHeight ?? box.creationHeight ?? 0;

const decodeDatapoint = (box: IndexedErgoBox): OracleDatapoint | undefined => {
  const { R4, R5, R6 } = box.additionalRegisters ?? {};
  // Oracle boxes produced by a refresh carry only R4; they hold no datapoint.
  if (!R4 || !R5 || !R6) {
    return undefined;
  }
  try {
    return {
      boxId: box.boxId,
      txId: box.transactionId,
      blockHeight: boxHeight(box),
      globalIndex: box.globalIndex,
      value: decodeI64Register(R6),
      epochId: decodeI32Register(R5),
      oracleAddress: decodeOraclePublicKey(R4).base58,
      spentTransactionId: box.spentTransactionId ?? null,
    };
  } catch (error) {
    console.error('Failed to decode oracle datapoint', { boxId: box.boxId }, error);
    return undefined;
  }
};

const decodePoolBox = (box: IndexedErgoBox): PoolBoxSnapshot | undefined => {
  const { R4, R5 } = box.additionalRegisters ?? {};
  if (!R4 || !R5) {
    return undefined;
  }
  try {
    return {
      boxId: box.boxId,
      txId: box.transactionId,
      blockHeight: boxHeight(box),
      rate: decodeI64Register(R4),
      epochId: decodeI32Register(R5),
    };
  } catch (error) {
    console.error('Failed to decode pool box', { boxId: box.boxId }, error);
    return undefined;
  }
};

/** Oracle boxes, newest first. */
export const fetchDatapointPage = async (
  nodeUrl: string,
  pool: OraclePoolConfig,
  page: number,
): Promise<DatapointPage> => {
  const response = await fetchJson<IndexedErgoBoxResponse>(
    tokenUrl(nodeUrl, pool.datapointTokenId, page * DATAPOINT_PAGE_SIZE, DATAPOINT_PAGE_SIZE),
  );
  const oldest = response.items.reduce<IndexedErgoBox | null>(
    (min, box) => (!min || boxHeight(box) < boxHeight(min) ? box : min),
    null,
  );
  return {
    datapoints: response.items
      .map(decodeDatapoint)
      .filter((dp): dp is OracleDatapoint => Boolean(dp)),
    count: response.items.length,
    total: response.total,
    oldestHeight: oldest ? boxHeight(oldest) : null,
    oldestBoxId: oldest?.boxId ?? null,
  };
};

/** Pool box history, newest first: one box per epoch. */
export const fetchPoolBoxPage = async (
  nodeUrl: string,
  pool: OraclePoolConfig,
  page: number,
): Promise<PoolBoxPage> => {
  const response = await fetchJson<IndexedErgoBoxResponse>(
    tokenUrl(nodeUrl, pool.oraclePoolTokenId, page * POOL_BOX_PAGE_SIZE, POOL_BOX_PAGE_SIZE),
  );
  return {
    snapshots: response.items
      .map(decodePoolBox)
      .filter((snapshot): snapshot is PoolBoxSnapshot => Boolean(snapshot)),
    count: response.items.length,
    total: response.total,
  };
};

/** Reads epoch length, quorum, deviation limit and buffer from the refresh contract. */
export const fetchPoolParameters = async (
  nodeUrl: string,
  pool: OraclePoolConfig,
): Promise<PoolParameters | null> => {
  if (!pool.refreshTokenId) {
    return null;
  }
  const { items } = await fetchUnspentBoxesByTokenId(nodeUrl, pool.refreshTokenId, 0, 1);
  const refreshBox = items[0];
  if (!refreshBox) {
    return null;
  }
  const indices = pool.refreshContractConstantIndices ?? DEFAULT_REFRESH_CONTRACT_CONSTANT_INDICES;
  const [epochLength, minDataPoints, maxDeviationPercent, bufferLength] =
    decodeErgoTreeIntConstants(refreshBox.ergoTree, [
      indices.epochLength,
      indices.minDataPoints,
      indices.maxDeviationPercent,
      indices.bufferLength,
    ]);
  return { epochLength, minDataPoints, maxDeviationPercent, bufferLength };
};

/** Addresses of every oracle currently holding an oracle token. */
export const fetchOperatorAddresses = async (
  nodeUrl: string,
  pool: OraclePoolConfig,
): Promise<string[]> => {
  const unspentBoxes = await fetchAllUnspentBoxesByTokenId(nodeUrl, pool.datapointTokenId);
  const addresses = new Set<string>();
  unspentBoxes.forEach((box) => {
    const datapointAsset = box.assets.find((asset) => asset.tokenId === pool.datapointTokenId);
    const r4 = box.additionalRegisters?.R4;
    if (!datapointAsset || datapointAsset.amount <= 0 || !r4) {
      return;
    }
    try {
      addresses.add(decodeOraclePublicKey(r4).base58);
    } catch (error) {
      console.error('Failed to decode operator register', { boxId: box.boxId }, error);
    }
  });
  return Array.from(addresses);
};

export const fetchNodeInfo = async (nodeUrl: string): Promise<ErgoNodeInfo> =>
  fetchJson<ErgoNodeInfo>(`${nodeUrl}/info`);

export const buildExplorerLinks = {
  transaction: (txId: string) => `${EXPLORER_UI_URL}/en/transactions/${txId}`,
  box: (boxId: string) => `${EXPLORER_UI_URL}/en/box/${boxId}`,
  address: (address: string) => `${EXPLORER_UI_URL}/en/addresses/${address}`,
  token: (tokenId: string) => `${EXPLORER_UI_URL}/en/token/${tokenId}`,
};
