## Ergo oracle status page

Static React + Vite front-end that visualizes datapoint activity for the Ergo oracle pools (USD, XAU, ...).

- Pulls raw oracle + datapoint box data via ergo-node’s blockchain endpoints
- Deserializes register values (oracle public keys, epoch ids, datapoints) with `ergo-lib-wasm-browser`
- Groups datapoints by epoch and highlights which oracle address posted which value, regardless of whether the box was consumed in a refresh transaction
- Adds a lightweight timeline view of the most recent epochs so you can see which blocks received datapoints and when refresh transactions landed
- Generates Explorer links for every box, transaction, token, and oracle address so it can be run/hosted without a backend

### Quick start

```bash
cd status-page
npm install          # already run once, but safe to repeat
npm run dev          # start Vite dev server
npm run build        # produce production-ready assets in dist/
```

### Configuration

Everything is defined in `src/config.ts`:

- `ORACLE_POOLS` – array of pools. Every entry needs an id, label/description, oracle token ID (oracle NFT) and datapoint token ID (datapoint NFT). Add more pools here and they’ll show up in the UI selector automatically.
- `DEFAULT_POOL_ID` – which pool should be auto-selected on load
- `DEFAULT_ERGO_NODE_URL` – ergo-node REST base
- `Vite base` – `vite.config.ts` sets `base: './'` so the static bundle works when hosted under a GitHub Pages subpath. Change it if you deploy at a different root.
- `EXPLORER_UI_URL` – only used for deep-linking to Explorer pages
- `DATAPOINT_PAGE_SIZE` – pagination window when querying ergo-node

### Implementation notes

- Register decoding relies exclusively on `ergo-lib-wasm-browser` so the same logic can run in-browser on GitHub Pages
- Oracles are identified by their compressed public keys (R4) and converted to P2PK addresses for readability
- Derived USD/ERG prices are computed as `1e9 / datapoint` which matches the oracle-core representation
- Pagination requests grab datapoint and oracle NFT boxes separately, dedupe by boxId, and keep block info cached locally for fast browsing
