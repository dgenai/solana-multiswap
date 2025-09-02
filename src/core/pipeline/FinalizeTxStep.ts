import { Step } from "./Step.js";
import { StepContext, BuildMultiSwapResult } from "../../types.js";
import {
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection, toPk } from "../../lib/solana.js";

const MAX_TX_SIZE = 1232; // Solana packet size limit (bytes)

export class FinalizeTxStep implements Step {
  async run(ctx: StepContext): Promise<void> {
    const { blockhash } = await getConnection().getLatestBlockhash("finalized");
    const payer = toPk(ctx.userPublicKey);

    // ALT fusion/dedup
    const rawAlts = ctx.altAccounts ?? [];
    const beforeCount = rawAlts.length;

    const seen = new Set<string>();
    const mergedAlts = rawAlts.filter((a: any) => {
      const key = a.key.toBase58();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const afterCount = mergedAlts.length;

    // Compile transaction
    const msgV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: (ctx as any).instructions,
    }).compileToV0Message(mergedAlts);

    const unsignedTx = new VersionedTransaction(msgV0);

    // Estimate size BEFORE serialize
    let size = 0;
    try {
      size = unsignedTx.serialize().length;
    } catch {
      size = -1; // if serialization fails due to oversize
    }

    if (size > MAX_TX_SIZE || size === -1) {
      throw new Error(
        `Transaction too large: estimated size ${size} bytes (limit ${MAX_TX_SIZE}). ` +
        `Split into multiple transactions required.`
      );
    }

    console.log(`✅ Transaction size: ${size} bytes`);

    // Safe serialize (under limit)
    const base64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    ctx.result = {
      unsignedTx,
      base64,
      diagnostics: {
        skipped: ctx.skipped,
        executedCount: ctx.swapPayloads.length,
        requestedCount: ctx.routes.length,
        wrappedLamports: ctx.wrappedLamports,
        altBefore: beforeCount,
        altAfter: afterCount,
        altSaved: beforeCount - afterCount,
        txSize: size,
        overLimit: false,
      },
    } as BuildMultiSwapResult;
  }
}
