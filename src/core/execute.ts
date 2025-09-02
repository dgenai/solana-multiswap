// src/core/execute.ts
import {
  Connection,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");

/**
 * ----------------------------------------------------------------------------
 * Execute (on-chain submission)
 * ----------------------------------------------------------------------------
 *
 * Utility to sign and submit a Solana v0 (VersionedTransaction).
 *
 * Features
 * - Loads a signer from PRIVATE_KEY_B58 (expected base58-encoded secret key).
 * - Refreshes `recentBlockhash` + `lastValidBlockHeight` to avoid expired TX errors.
 * - Signs the transaction locally before sending.
 * - Submits via `sendRawTransaction` with retries enabled.
 * - Confirms the transaction using blockhash-based strategy (non-deprecated).
 *
 * Typical failure modes handled:
 * - `TransactionExpiredBlockheightExceededError` (blockhash expired)
 * - Node drop / network transient errors (retries)
 *
 * @param unsignedTx A previously built but unsigned VersionedTransaction
 * @returns The confirmed transaction signature (base58 string)
 * @throws Error if signing key is missing or submission fails
 */
export async function execute(unsignedTx: VersionedTransaction): Promise<string> {
  if (!process.env.PRIVATE_KEY_B58) {
    throw new Error("Missing PRIVATE_KEY_B58");
  }

  // ---------------------------------------------------------------------------
  // 1) Load signer keypair from environment
  // ---------------------------------------------------------------------------
  const secret = bs58.decode(process.env.PRIVATE_KEY_B58);
  const signer = Keypair.fromSecretKey(secret);

  // ---------------------------------------------------------------------------
  // 2) Refresh blockhash & lastValidBlockHeight for transaction validity
  //    Ensures the transaction will not expire immediately on submission.
  // ---------------------------------------------------------------------------
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
  unsignedTx.message.recentBlockhash = blockhash;

  // ---------------------------------------------------------------------------
  // 3) Sign transaction (payer and signer must be included in unsignedTx)
  // ---------------------------------------------------------------------------
  unsignedTx.sign([signer]);

  // ---------------------------------------------------------------------------
  // 4) Submit transaction to cluster
  //    - skipPreflight=false → run preflight checks (safer, more accurate CU/fees)
  //    - maxRetries=3       → retry on transient errors
  // ---------------------------------------------------------------------------
  const sig = await conn.sendRawTransaction(unsignedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  // ---------------------------------------------------------------------------
  // 5) Confirm transaction with blockhash strategy
  //    Uses `blockhash + lastValidBlockHeight` to avoid deprecated API usage.
  // ---------------------------------------------------------------------------
  await conn.confirmTransaction(
    {
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return sig;
}
