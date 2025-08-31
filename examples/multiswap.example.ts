// examples/example-multiswap.ts
/**
 * ----------------------------------------------------------------------------
 * Example: Multi-swap transaction build → simulate → execute
 * ----------------------------------------------------------------------------
 *
 * This script demonstrates how to:
 * 1. Build a multi-route swap transaction with `buildMultiSwapTxV0`
 * 2. Simulate it with `simulate` to inspect compute units and logs
 * 3. Optionally execute it on-chain with `execute` (if PRIVATE_KEY_B58 is set)
 *
 * Environment variables required:
 * - USER_PUBLIC_KEY: Public key of the user (payer and signer)
 * - PRIVATE_KEY_B58: (optional) base58-encoded secret key for signing and execution
 *
 * Usage:
 * ```bash
 * USER_PUBLIC_KEY=... PRIVATE_KEY_B58=... tsx examples/example-multiswap.ts
 * ```
 */

import "dotenv/config";
import { buildMultiSwapTxV0, simulate, execute } from "../src";

/** Native SOL mint */
const SOL = "So11111111111111111111111111111111111111112";

async function main() {
  const user = process.env.USER_PUBLIC_KEY!;
  if (!user) throw new Error("Missing USER_PUBLIC_KEY");

  // Define multi-route swaps (buy and sell flows)
  const routes = [
    {
      side: "buy" as const,
      inputMint: SOL,
      outputMint: "EcMzzinq67zZmxxxAcSSvCuRVfabdyE4jRMxxzqPgVfz",
      amount: 1_000,
      slippageBps: 100,
    },
    {
      side: "buy" as const,
      inputMint: SOL,
      outputMint: "AdwCEWQGzt3vuFMEPMf97AJMiq1eYL2sR7gk2x42pump",
      uiAmount: 0.002,
      slippageBps: 100,
    },
    {
      side: "sell" as const,
      inputMint: "jZGmEwwaW94iiU32wa6RADgVEhdpQpa6MtGERfJpump",
      outputMint: SOL,
      uiAmount: 3115.37591,
      slippageBps: 100,
    },
  ];

  // Step 1: Build unsigned v0 transaction
  const { unsignedTx } = await buildMultiSwapTxV0({ routes, userPublicKey: user });

  // Step 2: Simulate to inspect logs and compute unit usage
  console.log("🔎 Simulating...");
  const sim = await simulate(unsignedTx);
  console.log("⚡ CU:", sim.unitsConsumed, "\n📜 Logs:", sim.logs);

  // Step 3: Optionally execute if PRIVATE_KEY_B58 is set
  if (process.env.PRIVATE_KEY_B58) {
    console.log("🚀 Executing...");
    const sig = await execute(unsignedTx);
    console.log("✅", sig);
  } else {
    console.log("ℹ️ PRIVATE_KEY_B58 not set — skipping execution.");
  }
}

// Entrypoint with error handling
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
