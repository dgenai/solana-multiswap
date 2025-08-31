// src/core/execute.ts
/**
 * ----------------------------------------------------------------------------
 * execute
 * ----------------------------------------------------------------------------
 *
 * Signs and submits a VersionedTransaction to the Solana blockchain.
 *
 * Features
 * - Loads a signer keypair from a base58-encoded secret key (string or env var)
 * - Signs the provided unsigned transaction
 * - Sends it with retry and preflight checks enabled
 * - Waits for confirmation at commitment level "confirmed"
 *
 * Usage
 * ```ts
 * const sig = await execute(unsignedTx, mySecretKeyB58);
 * console.log("Transaction signature:", sig);
 * ```
 */

import { VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getConnection } from "../lib/solana.js";

/**
 * Execute a Solana transaction by signing it with a local keypair and broadcasting it.
 *
 * @param unsignedTx - Unsigned VersionedTransaction (must include payer, blockhash, instructions)
 * @param base58Secret - Optional base58-encoded secret key. Falls back to `process.env.PRIVATE_KEY_B58`.
 * @returns The confirmed transaction signature string
 * @throws Error if no secret key is provided or if sending/confirmation fails
 */
export async function execute(unsignedTx: VersionedTransaction, base58Secret?: string) {
  // Resolve secret key (explicit argument > env var)
  const secretB58 = base58Secret ?? process.env.PRIVATE_KEY_B58;
  if (!secretB58) throw new Error("Missing PRIVATE_KEY_B58");

  // Decode base58 secret and reconstruct signer keypair
  const keypair = Keypair.fromSecretKey(bs58.decode(secretB58));

  // Sign the provided transaction
  unsignedTx.sign([keypair]);

  // Get Solana RPC connection
  const conn = getConnection();

  // Send raw transaction (with retries and preflight)
  const sig = await conn.sendRawTransaction(unsignedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Wait for confirmation
  await conn.confirmTransaction(sig, "confirmed");

  return sig;
}