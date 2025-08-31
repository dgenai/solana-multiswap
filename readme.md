# solana-multiswap

Build **one v0 transaction** that executes **multiple Jupiter (v6) swaps** with:
- automatic **SOL wrap/unwrap** when needed,
- **Address Lookup Tables (ALT)** loading,
- **Compute Budget** handling,
- **Zod** validation for Jupiter payloads,
- **ESM** output (TypeScript → Node 18+),
- graceful handling of “no route” via `onRouteNotFound`.

> ⚠️ **Mainnet has real risk.** Start with simulation. Never commit secrets.

---

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration (.env)](#configuration-env)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [API](#api)
  - [`buildMultiSwapTxV0`](#buildmultiswaptxv0)
  - [`simulate`](#simulate)
  - [`execute`](#execute)
- [Full Example](#full-example)
- [Build & Publish](#build--publish)
- [Tests](#tests)
- [Quality (Lint/Format)](#quality-lintformat)
- [CI (GitHub Actions)](#ci-github-actions)
- [Security](#security)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [License](#license)

---

## Features

- Aggregates multiple Jupiter v6 quotes and **orchestrates** all instructions (setup/swap/other/cleanup).
- Optional **SOL wrap/unwrap** through Jupiter.
- Loads **ALT** accounts returned by Jupiter.
- **Zod** validation for `quote` and `swap-instructions` responses.
- **ESM**: uses `.js` suffix on **relative** imports in source (TypeScript) so Node ESM works after build.
- Typed Jupiter errors (`JupiterApiError`) and `onRouteNotFound` option (`skip`/`fail`).

---

## Requirements

- **Node.js ≥ 18**
- **npm ≥ 9**
- A Solana RPC endpoint (public or private)
- A user public key (and optional base58 private key if you want to execute)

---

## Install

```bash
npm i
```

Key dependencies (already in `package.json`):
- `@solana/web3.js`, `bs58`
- `undici` (HTTP)
- `zod` (validation)
- `dotenv` (env)
- Dev: `typescript`, `tsx`, `vitest`, `eslint`, `prettier`, `rimraf`

---

## Configuration (.env)

Create a **root-level** `.env` (never commit it):

```env
SOLANA_RPC=https://api.mainnet-beta.solana.com
USER_PUBLIC_KEY=YourPublicKey
PRIVATE_KEY_B58=   # optional (leave empty to only simulate)
```

> Place `.env` at the **project root**, not in `src/`.

---

## Project Structure

```
solana-multiswap/
├─ src/
│  ├─ core/
│  │  ├─ buildMultiSwapTxV0.ts
│  │  ├─ execute.ts
│  │  └─ simulate.ts
│  ├─ lib/
│  │  ├─ solana.ts
│  │  ├─ jupiter.ts
│  │  └─ jupiter.schemas.ts
│  ├─ utils/
│  │  └─ amounts.ts
│  ├─ types.ts
│  └─ index.ts
├─ examples/
│  └─ multiswap.example.ts
├─ tests/
│  └─ jupiter.schemas.test.ts
├─ .env.example
├─ README.md
├─ package.json
├─ tsconfig.json
└─ ...
```

> **ESM note:** All **relative** imports in `src/**` use the **`.js`** suffix (e.g. `import { ... } from "../lib/jupiter.js"`). TypeScript accepts this with `moduleResolution: "Bundler"` and emits correct `.js` paths in `dist/`.

---

## Quick Start

Run the example (simulation by default):

```bash
npm run dev
# or
npm run dev:example
```

- If `PRIVATE_KEY_B58` is **empty**, the example **only simulates**.
- If `PRIVATE_KEY_B58` is set, it can **sign and send** the transaction.

---

## API

### `buildMultiSwapTxV0`

Build a single v0 transaction containing multiple Jupiter swaps.

```ts
import { buildMultiSwapTxV0 } from "solana-multiswap";

type Side = "buy" | "sell";
type MultiRouteInput = {
  inputMint: string;
  outputMint: string;
  amount?: string | number; // base units
  uiAmount?: number;        // UI units
  slippageBps: number;
  side?: Side;
};

const { unsignedTx, base64, diagnostics } = await buildMultiSwapTxV0({
  routes: myRoutes,
  userPublicKey: "YourPubkey",
  onRouteNotFound: "skip", // or "fail" (default is "skip")
});
```

**Normalization included:**
- For `side: "sell"` + `uiAmount`, we convert to `amount` (base units) and **cap** to on-chain balance.
- For `buy` funded with SOL + `uiAmount`, converts to **lamports**.
- SOL wrap/unwrap is added if required.

**Returns:**
- `unsignedTx` — `VersionedTransaction` ready to simulate/sign
- `base64` — serialized base64
- `diagnostics`:
  - `skipped: { index, reason, code }[]` (routes ignored)
  - `executedCount`, `requestedCount`
  - `wrappedLamports`

**Options:**
- `onRouteNotFound: "skip" | "fail"` — if Jupiter returns `COULD_NOT_FIND_ANY_ROUTE`.

---

### `simulate`

Simulate a transaction **without signing**.

```ts
import { simulate } from "solana-multiswap";

const sim = await simulate(unsignedTx);
console.log(sim.unitsConsumed, sim.logs);
```

---

### `execute`

Sign (base58 secret) and send the transaction.

```ts
import { execute } from "solana-multiswap";

const sig = await execute(unsignedTx, /* optional base58 secret */);
// by default it reads PRIVATE_KEY_B58 from process.env
```

---

## Full Example

```ts
// examples/multiswap.example.ts
import "dotenv/config";
import { buildMultiSwapTxV0, simulate, execute } from "../src/index.js";

const SOL = "So11111111111111111111111111111111111111112";

async function main() {
  const user = process.env.USER_PUBLIC_KEY!;
  if (!user) throw new Error("Missing USER_PUBLIC_KEY");

  const routes = [
    { side: "buy" as const, inputMint: SOL, outputMint: "EcMzzin...Vfz", amount: 1_000, slippageBps: 100 },
    { side: "buy" as const, inputMint: SOL, outputMint: "AdwCEWQ...pump", uiAmount: 0.002, slippageBps: 100 },
    { side: "sell" as const, inputMint: "jZGmEw...pump", outputMint: SOL, uiAmount: 3115.37591, slippageBps: 100 },
  ];

  const { unsignedTx, diagnostics } = await buildMultiSwapTxV0({
    routes,
    userPublicKey: user,
    onRouteNotFound: "skip", // "fail" to abort when a route is missing
  });

  if (diagnostics?.skipped?.length) {
    console.warn("⚠️ Skipped routes:", diagnostics.skipped);
  }

  console.log("🔎 Simulating...");
  const sim = await simulate(unsignedTx);
  console.log("⚡ CU:", sim.unitsConsumed);
  if (sim.err) console.error("❌ Sim error:", sim.err);

  if (process.env.PRIVATE_KEY_B58) {
    console.log("🚀 Executing...");
    const sig = await execute(unsignedTx);
    console.log("✅ Signature:", sig);
  } else {
    console.log("ℹ️ PRIVATE_KEY_B58 not set — skipping execution.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## Build & Publish

### Build (ESM + d.ts)

**tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["dist","node_modules","examples","tests"]
}
```

**package.json (excerpt)**
```json
{
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rimraf dist",
    "prepack": "npm run clean && npm run build",
    "dev:example": "tsx examples/multiswap.example.ts",
    "dev": "npm run dev:example",
    "test": "vitest run",
    "lint": "eslint .",
    "format": "prettier -w ."
  }
}
```

**Build**
```bash
npm run build
```

**Sanity check**
```bash
node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"
```

**Pack/Publish**
```bash
npm pack
npm publish --access public
```

> Prefer a bundler (`tsup`) if you want a single-file ESM artifact.

---

## Tests

Run unit tests (Vitest):

```bash
npm run test
```

Example: `tests/jupiter.schemas.test.ts` validates `QuoteSchema` and `SwapIxsSchema` (including nullable/optional fields).

---

## Quality (Lint/Format)

```bash
npm run lint
npm run format
```

`.eslintrc.cjs` & `.prettierrc` included (standard TS style).

---

## CI (GitHub Actions)

Minimal workflow `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test --if-present
```

---

## Security

- **NEVER** commit private keys.  
- Use external signers for production (Ledger, HSM, custodian).  
- `execute()` can be replaced by your custom signer — it accepts an optional base58 secret.  
- **Rate limits / reliability:** Jupiter API may fail; consider retries.

---

## Troubleshooting / FAQ

**“Non-base58 character”**  
→ A pubkey/mint/ALT has invalid chars or trailing spaces. Use the `toPk` helper (trim + regex) everywhere.

**`missing field swapMode` in swap-instructions**  
→ Add `swapMode=ExactIn` to the quote and pass the **validated Quote** to `/swap-instructions`. `QuoteSchema` includes `swapMode`.

**`platformFee` null → ZodError**  
→ `QuoteSchema` uses `platformFee: optional().nullable()` (supported).

**`COULD_NOT_FIND_ANY_ROUTE`**  
→ Use `onRouteNotFound: "skip"` to ignore that route and continue. `"fail"` to abort.  
Tips: reduce `amount`, increase `slippageBps`, try an intermediate hop (USDC/USDT).

**Node ESM: ERR_MODULE_NOT_FOUND / imports without `.js`**  
→ In ESM, Node requires file extensions on **relative** imports. We use `.js` in **source** (TS) + `moduleResolution: "Bundler"` so output is correct.

**`.env` not loaded**  
→ Put `.env` at the **project root** and import `dotenv/config` in your entry script.

---

## License

MIT — see `LICENSE`.
