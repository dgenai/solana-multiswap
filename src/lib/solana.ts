// src/lib/solana.ts
/**
 * ----------------------------------------------------------------------------
 * Solana connection & key utilities
 * ----------------------------------------------------------------------------
 *
 * Provides small helpers for consistent RPC connections and PublicKey handling.
 *
 * - `getConnection` — returns a `Connection` object using the provided RPC URL,
 *   or falls back to `SOLANA_RPC` env var, or defaults to mainnet-beta.
 * - `toPk` — shorthand to construct a `PublicKey` from a base58 string.
 *
 * Usage
 * ```ts
 * const conn = getConnection();
 * const pk = toPk("So11111111111111111111111111111111111111112");
 * ```
 */

import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Get a Solana JSON-RPC connection.
 *
 * @param rpc - Optional RPC endpoint. Defaults to `process.env.SOLANA_RPC` or mainnet-beta.
 * @returns A `Connection` instance with commitment level "confirmed"
 */
export function getConnection(
  rpc = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com"
) {
  return new Connection(rpc, "confirmed");
}

/**
 * Convert a base58 string to a `PublicKey`.
 *
 * @param v - Base58-encoded public key string
 * @returns `PublicKey` instance
 */
export function toPk(v: string) {
  return new PublicKey(v);
}
