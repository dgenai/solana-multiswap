// src/core/simulate.ts
/**
 * ----------------------------------------------------------------------------
 * simulate
 * ----------------------------------------------------------------------------
 *
 * Simulates a Solana VersionedTransaction locally against the current cluster.
 *
 * Features
 * - Uses `simulateTransaction` with `sigVerify=false` and `replaceRecentBlockhash=true`
 * - Does not broadcast or commit the transaction
 * - Returns execution logs, accounts, and error info if any
 *
 * Usage
 * ```ts
 * const result = await simulate(unsignedTx);
 * console.log("Logs:", result.logs);
 * ```
 */

import { VersionedTransaction } from "@solana/web3.js";
import { getConnection } from "../lib/solana.js";

/**
 * Simulate execution of an unsigned transaction without submitting it.
 *
 * @param unsignedTx - Unsigned VersionedTransaction to simulate
 * @returns Simulation result value (accounts, logs, error, units consumed, etc.)
 */
export async function simulate(unsignedTx: VersionedTransaction) {
  const conn = getConnection();

  const sim = await conn.simulateTransaction(unsignedTx, {
    sigVerify: false, // skip signature checks for faster simulation
    replaceRecentBlockhash: true, // replace blockhash to ensure freshness
  });

  return sim.value;
}
