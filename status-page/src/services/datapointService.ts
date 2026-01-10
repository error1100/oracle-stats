import type { OraclePoolConfig } from '../config';
import {
  DATAPOINT_PAGE_SIZE,
  DEFAULT_ERGO_NODE_URL,
  EXPLORER_UI_URL,
} from '../config';
import { decodeI32Register, decodeI64Register, decodeOraclePublicKey } from '../lib/ergo';
import type { OracleDatapoint } from '../types/datapoint';
import type { BlockHeader, IndexedErgoBox, IndexedErgoBoxResponse } from '../types/ergoNode';

export interface RefreshBoxMarker {
  boxId: string;
  txId: string;
  blockHeight: number;
  timestamp?: number;
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
}

const blockInfoCache = new Map<number, BlockHeader>();

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

const fetchBlockHeader = async (nodeUrl: string, height: number): Promise<BlockHeader | undefined> => {
  if (!height) {
    return undefined;
  }
  const cached = blockInfoCache.get(height);
  if (cached) {
    return cached;
  }
  try {
    const headerIds = await fetchJson<string[]>(`${nodeUrl}/blocks/at/${height}`);
    if (!headerIds.length) {
      return undefined;
    }
    const header = await fetchJson<BlockHeader>(`${nodeUrl}/blocks/${headerIds[0]}/header`);
    blockInfoCache.set(height, header);
    return header;
  } catch (error) {
    console.error(`Failed to fetch block header at height ${height}`, error);
    return undefined;
  }
};

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

const enrichWithBlockInfo = async (
  datapoints: OracleDatapoint[],
  nodeUrl: string,
): Promise<OracleDatapoint[]> => {
  const uniqueHeights = Array.from(
    new Set(datapoints.map((dp) => dp.blockHeight).filter((height) => height > 0)),
  );
  await Promise.all(uniqueHeights.map((height) => fetchBlockHeader(nodeUrl, height)));
  return datapoints.map((dp) => {
    const header = blockInfoCache.get(dp.blockHeight);
    return {
      ...dp,
      blockId: header?.id,
      timestamp: header?.timestamp,
    };
  });
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
    fetchBoxesByTokenId(nodeUrl, pool.oracleTokenId, offset, pageSize),
    fetchBoxesByTokenId(nodeUrl, pool.datapointTokenId, offset, pageSize),
    refreshTokenId
      ? fetchBoxesByTokenId(nodeUrl, refreshTokenId, offset, pageSize)
      : Promise.resolve<IndexedErgoBoxResponse>({ items: [], total: 0 }),
  ]);

  const oracleData = oracleBoxes.items
    .map((box) => decodeOracleDatapoint(pool.id, pool.oracleTokenId, 'oracleBox', box))
    .filter((box): box is OracleDatapoint => Boolean(box));
  const datapointData = datapointBoxes.items
    .map((box) => decodeOracleDatapoint(pool.id, pool.datapointTokenId, 'datapointBox', box))
    .filter((box): box is OracleDatapoint => Boolean(box));

  const deduped = new Map<string, OracleDatapoint>();
  [...oracleData, ...datapointData].forEach((dp) => {
    const existing = deduped.get(dp.boxId);
    if (!existing || (existing.source === 'oracleBox' && dp.source === 'datapointBox')) {
      deduped.set(dp.boxId, dp);
    }
  });

  const sorted = Array.from(deduped.values()).sort((a, b) => b.blockHeight - a.blockHeight);
  const enriched = await enrichWithBlockInfo(sorted, nodeUrl);

  const refreshMarkersBase: RefreshBoxMarker[] = refreshBoxesResponse.items.map((box) => ({
    boxId: box.boxId,
    txId: box.transactionId,
    blockHeight: box.inclusionHeight ?? box.creationHeight ?? 0,
  }));

  await Promise.all(
    refreshMarkersBase
      .filter((marker) => marker.blockHeight > 0)
      .map((marker) => fetchBlockHeader(nodeUrl, marker.blockHeight)),
  );

  const refreshBoxes = refreshMarkersBase.map((marker) => ({
    ...marker,
    timestamp: blockInfoCache.get(marker.blockHeight)?.timestamp,
  }));

  return {
    datapoints: enriched,
    totals: {
      oracle: oracleBoxes.total,
      datapoint: datapointBoxes.total,
    },
    pageCounts: {
      oracle: oracleBoxes.items.length,
      datapoint: datapointBoxes.items.length,
    },
    refreshBoxes,
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

export const fetchNodeInfo = async (baseUrl: string): Promise<ErgoNodeInfo> =>
  fetchJson<ErgoNodeInfo>(`${baseUrl}/info`);

export const buildExplorerLinks = {
  transaction: (txId: string) => `${EXPLORER_UI_URL}/en/transactions/${txId}`,
  box: (boxId: string) => `${EXPLORER_UI_URL}/en/box/${boxId}`,
  address: (address: string) => `${EXPLORER_UI_URL}/en/addresses/${address}`,
  token: (tokenId: string) => `${EXPLORER_UI_URL}/en/token/${tokenId}`,
};
