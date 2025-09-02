import { Step } from "./Step.js";
import { StepContext } from "../../types.js";
import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { toIx } from "../../utils/pk.js";

/**
 * AssembleInstructionsStep (Strict Deduplication)
 *
 * - Wrap SOL once at the start
 * - Deduplicate ATA creation (owner+mint) across ALL instruction sources
 * - Deduplicate other instructions (programId+keys+data)
 * - Deduplicate compute budget instructions (keep max 2: limit + price)
 * - Append swap + other instructions in order
 * - Unwrap SOL once at the end
 */
export class AssembleInstructionsStep implements Step {
  async run(ctx: StepContext): Promise<void> {
    const ixs: TransactionInstruction[] = [];

    // -----------------------------------------------------------------------
    // Global deduplication state
    // -----------------------------------------------------------------------
    const seenATAs = new Set<string>();
    const seenGeneric = new Set<string>();

    const pushIfUnique = (ix: TransactionInstruction) => {
      if (ix.programId.toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") {
        // ATA creation: dedupe by (owner, mint)
        const owner = ix.keys[2]?.pubkey.toBase58();
        const mint = ix.keys[3]?.pubkey.toBase58();
        const ataKey = `${owner}|${mint}`;
        if (seenATAs.has(ataKey)) return;
        seenATAs.add(ataKey);
        ixs.push(ix);
      } else {
        // Generic deduplication: programId + accounts + data
        const key =
          ix.programId.toBase58() +
          "|" +
          ix.keys.map((k) => k.pubkey.toBase58()).join("-") +
          "|" +
          Buffer.from(ix.data).toString("base64");
        if (seenGeneric.has(key)) return;
        seenGeneric.add(key);
        ixs.push(ix);
      }
    };

    // -----------------------------------------------------------------------
    // Wrap SOL (if needed)
    // -----------------------------------------------------------------------
    if (ctx.wrapInstrs.length) {
      ctx.wrapInstrs.forEach((ix) => pushIfUnique(ix));
    }

    // -----------------------------------------------------------------------
    // Token ledger instruction (optional, only one)
    // -----------------------------------------------------------------------
    const tokenLedgerIx = ctx.swapPayloads.find((x) => !!x.ixs.tokenLedgerInstruction)?.ixs
      .tokenLedgerInstruction;
    if (tokenLedgerIx) {
      pushIfUnique(toIx(tokenLedgerIx));
    }

    // -----------------------------------------------------------------------
    // Deduplicate compute budget instructions
    // -----------------------------------------------------------------------
    const computeBudgetIx = ctx.swapPayloads
      .flatMap((x) => x.ixs.computeBudgetInstructions ?? [])
      .map(toIx);

    const seenCB = new Set<string>();
    const filteredCB = computeBudgetIx.filter((ix) => {
      const key = ix.programId.toBase58() + "|" + Buffer.from(ix.data).toString("base64");
      if (seenCB.has(key)) return false;
      seenCB.add(key);
      return true;
    });

    if (filteredCB.length > 0) {
      filteredCB.slice(0, 2).forEach((ix) => pushIfUnique(ix)); // keep max 2
    } else {
      pushIfUnique(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
    }

    // -----------------------------------------------------------------------
    // Setup instructions (dedupe included)
    // -----------------------------------------------------------------------
    ctx.swapPayloads.forEach((x) => {
      if (x.ixs.setupInstructions?.length) {
        x.ixs.setupInstructions.map(toIx).forEach((ix: TransactionInstruction) => pushIfUnique(ix));
      }
    });

    // -----------------------------------------------------------------------
    // Main swap instructions
    // -----------------------------------------------------------------------
    ctx.swapPayloads.forEach((x) => {
      if (x.ixs.swapInstruction) {
        pushIfUnique(toIx(x.ixs.swapInstruction));
      }
    });

    // -----------------------------------------------------------------------
    // Additional instructions
    // -----------------------------------------------------------------------
    ctx.swapPayloads.forEach((x) => {
      if (x.ixs.otherInstructions?.length) {
        x.ixs.otherInstructions.map(toIx).forEach((ix: TransactionInstruction) => pushIfUnique(ix));
      }
    });

    // -----------------------------------------------------------------------
    // Cleanup (unwrap SOL, close temp accounts)
    // -----------------------------------------------------------------------
    if (ctx.cleanupInstr) {
      pushIfUnique(ctx.cleanupInstr);
    }

    // Save optimized instruction list
    (ctx as any).instructions = ixs;
  }
}
