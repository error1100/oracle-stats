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
- `REFRESH_INTERVAL_SECONDS` (per pool, optional): polling cadence for the node `/info` endpoint that detects new blocks. `0` disables auto-refresh.
- `DEFAULT_POOL_ID`: the pool selected on load.
- `DEFAULT_ERGO_NODE_URL`: node used when no node URL has been saved in the browser.
- `INITIAL_EPOCH_COUNT` / `EPOCH_LOAD_STEP`: epochs shown on load, and how many more load when you scroll to the bottom.
- `EXPLORER_UI_URL`: used only for deep links.

The node URL can be changed in the UI through the gear button. The node must expose the blockchain indexer API. The value is stored in `localStorage` under `oracle-stats.nodeUrl`.

### Implementation notes

- Register and contract decoding uses `ergo-lib-wasm-browser` only, so the page runs without a backend (e.g. on GitHub Pages).
- **Epoch boundaries** come from the pool box history: the pool box for epoch *n* marks its start. The pool box for *n + 1* gives the refresh transaction, the published rate (R4), and the end of epoch *n*.
- **Pool parameters** are read from the constants of the unspent refresh box's ErgoTree.
- **History loading**: oracle boxes are paged newest-first. An epoch is listed only once every box since its start has been loaded.
- **Live updates**: on each new block the newest page is fetched again and merged into what's already loaded.
- **Displayed price**: `1e9 / rate`; set each pool's `quoteTicker` to label it.
