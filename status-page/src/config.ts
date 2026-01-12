import { NetworkPrefix } from 'ergo-lib-wasm-browser';

export interface OraclePoolConfig {
  id: string;
  label: string;
  description?: string;
  ergoNodeUrl?: string;
  ergoNodeApiUrl?: string;
  REFRESH_INTERVAL_SECONDS?: number;
  quoteTicker?: string;
  oraclePoolTokenId: string;
  datapointTokenId: string;
  refreshTokenId?: string;
}

export const DEFAULT_ERGO_NODE_URL = 'https://ergo-node.eutxo.de';

export const ORACLE_POOLS: OraclePoolConfig[] = [
  {
    id: 'oracle-usd',
    label: 'Oracle USD',
    description: 'ERG / USD oracle pool',
    quoteTicker: 'USD',
    oraclePoolTokenId: '6a2b821b5727e85beb5e78b4efb9f0250d59cd48481d2ded2c23e91ba1d07c66',
    datapointTokenId: '74fa4aee3607ceb7bdefd51a856861b5dbfa434a8f6c93bfe967de8ed1a30a78',
    refreshTokenId: '19b7f2e2f11052c020800c8b620660f9f0b5fd5b3f2beacc8b44af960477a694',
  },
  {
    id: 'oracle-xau',
    label: 'Oracle XAU',
    description: 'ERG / XAU oracle pool',
    quoteTicker: 'XAU',
    oraclePoolTokenId: '3c45f29a5165b030fdb5eaf5d81f8108f9d8f507b31487dd51f4ae08fe07cf4a',
    datapointTokenId: '78263e5613557e129f075f0a241287e09c4204be76ad53d77d6e7feebcccb001',
    refreshTokenId: '97ad159235d25d05d7efc5863b5d360f89d7d668409502058be3e7aac177b9cb',
  },
];

export const DEFAULT_POOL_ID = ORACLE_POOLS[0]?.id ?? 'oracle-usd';

export const EXPLORER_UI_URL = 'https://explorer.ergoplatform.com';

export const NETWORK_PREFIX = NetworkPrefix.Mainnet;
export const DATAPOINT_PAGE_SIZE = 100;
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 10;
