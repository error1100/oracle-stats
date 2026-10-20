## Ergo oracle status page

Static React + Vite front-end that shows, per epoch, which oracle posted which datapoint and whether the refresh included it, for the Ergo oracle pools (USD, XAU, ...).

- **Top bar**: pool tabs, current price and pool rate, epoch, block height, and node status. The gear button opens the node settings.
- **Health cards**: quorum headroom (active vs. required vs. registered oracles), progress of the open epoch, refresh cadence, and the last epoch's spread against the deviation limit.
- **Epoch ledger**: one row per epoch with its duration (overrun epochs flagged), published price and change, a bar for the spread of included values (exact figures on hover), a status chip for every registered oracle (idle ones dimmed on the right), and the included count against the quorum. Click a row for its transactions.
- **Oracle roster**: every registered oracle with its participation history, inclusion share, median blocks to its first post, and how many overrun epochs it held up; oracles that never posted are marked idle.

Datapoint statuses:

| Status | Meaning |
|---|---|
| included | consumed by the refresh that closed the epoch |
| reposted | the oracle posted again in the same epoch; this box was superseded |
| late | posted at or after the refresh block |
| rejected | posted in time but not consumed by the refresh |
| pending | the epoch is still open |

An epoch is flagged as overrun when it lasts longer than epoch length + buffer. In an overrun epoch, the oracle whose first datapoint arrived last is marked as the bottleneck.

### Quick start

```bash
cd status-page
npm install
npm run dev          # start Vite dev server
npm run build        # produce production-ready assets in dist/
```

### Configuration

Everything is defined in `src/config.ts`:

- `ORACLE_POOLS`: array of pools. Each entry needs an id, a label, the pool NFT (`oraclePoolTokenId`), the oracle token (`datapointTokenId`), and the refresh NFT (`refreshTokenId`, used to read the pool parameters). New entries show up as tabs automatically.
- `refreshContractConstantIndices` (per pool, optional): positions of epoch length, min datapoints, max deviation, and buffer inside the refresh contract's ErgoTree constants. Defaults follow oracle-core (`0`, `13`, `15`, `21`).
- `DEFAULT_AUTO_REFRESH` / `DEFAULT_REFRESH_INTERVAL_SECONDS`: whether the node is polled for new blocks, and how often (default: on, every 30 s; `MIN_REFRESH_INTERVAL_SECONDS` is the lower bound).
- `DEFAULT_POOL_ID`: the pool selected on load.
- `DEFAULT_ERGO_NODE_URL`: node used when no node URL has been saved in the browser.
- `INITIAL_EPOCH_COUNT` / `EPOCH_LOAD_STEP`: epochs shown on load, and how many more load when you scroll to the bottom.
- `EXPLORER_UI_URL`: used only for deep links.

### Settings (gear button)

- **Ergo node URL**: the node must expose the blockchain indexer API.
- **Auto-refresh**: on/off and the interval in seconds. When off, the node is queried once on load.
- **Clear cache**: deletes the cached history for all pools and nodes and reloads from the node.

Settings are stored in `localStorage` under `oracle-stats.nodeUrl`, `oracle-stats.autoRefresh` and `oracle-stats.refreshIntervalSeconds`.

### Cache

Loaded history (oracle boxes, pool boxes, pool parameters, operators) is kept in `localStorage` per pool and node (`oracle-stats.cache.v1:<pool>:<node>`). A reload or pool switch renders from the cache right away, then fetches only the newest page to catch up. If that page doesn't connect to the cached history (for example, the tab was closed for many blocks), the cached history is dropped and loaded again. The cache keeps at most the newest 3000 datapoints and 1000 pool boxes.

### Implementation notes

- Register and contract decoding uses `ergo-lib-wasm-browser` only, so the page runs without a backend (e.g. on GitHub Pages).
- **Epoch boundaries** come from the pool box history: the pool box for epoch *n* marks its start. The pool box for *n + 1* gives the refresh transaction, the published rate (R4), and the end of epoch *n*.
- **Pool parameters** are read from the constants of the unspent refresh box's ErgoTree.
- **History loading**: oracle boxes are paged newest-first. An epoch is listed only once every box since its start has been loaded.
- **Live updates**: on each new block the newest page is fetched again and merged into what's already loaded.
- **Displayed price**: `1e9 / rate`; set each pool's `quoteTicker` to label it.
