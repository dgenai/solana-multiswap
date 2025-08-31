// src/core/buildMultiSwapTxV0.ts
/**
 * ----------------------------------------------------------------------------
 * buildMultiSwapTxV0
 * ----------------------------------------------------------------------------
 *
 * Builds a Solana v0 (VersionedTransaction) transaction that orchestrates
 * multiple Jupiter swaps in a single execution, with support for Address Lookup
 * Tables (ALT) and SOL → WSOL wrapping if required.
 *
 * Key points
 * - Normalizes each route (resolves `amount` in base units from `uiAmount`)
 * - Wraps SOL if any route requires SOL input
 * - Fetches quotes and swap instructions from Jupiter (handles "no route" cases)
 * - Orders instructions properly (compute budget, setup, swap, other, cleanup)
 * - Compiles into a v0 message with ALT accounts returned by Jupiter
 *
 * Assumptions
 * - Caller signs the transaction (payer = `userPublicKey`)
 * - Solana/Jupiter integration helpers (getConnection, getQuote, getSwapInstructions)
 *   are correctly configured at the app level
 *
 * Common errors
 * - `order[i] missing amount/uiAmount` if no quantity is provided
 * - `No executable route` if no valid swap route is found
 * - Jupiter errors (e.g. `COULD_NOT_FIND_ANY_ROUTE`) may propagate depending on `onRouteNotFound`
 *
 * Example
 * ```ts
 * const { base64, diagnostics } = await buildMultiSwapTxV0({
 *   routes: [
 *     { side: "sell", inputMint: USDC, outputMint: SOL, uiAmount: 25, slippageBps: 50 },
 *     { side: "buy",  inputMint: SOL,  outputMint: USDC, amount: "1000000", slippageBps: 50 },
 *   ],
 *   userPublicKey: wallet.publicKey.toBase58(),
 *   onRouteNotFound: "skip" // or "fail"
 * });
 * // → forward `base64` to the wallet for signing/submitting
 * ```
 */

import {
    AddressLookupTableAccount,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
  } from "@solana/web3.js";
  import { getConnection, toPk } from "../lib/solana.js";
  import { getQuote, getSwapInstructions, JupiterApiError } from "../lib/jupiter.js";
  import { uiToBaseUnits, solToLamports } from "../utils/amounts.js";
  import type { MultiRouteInput } from "../types.js";
  
  /**
   * Native SOL mint (used by Jupiter to represent SOL input).
   * Note: on-chain swaps wrap SOL into WSOL via setup/cleanup instructions.
   */
  const SOL = "So11111111111111111111111111111111111111112";
  
  /**
   * USDC mint (commonly used as reference token for dummy-quote when wrapping SOL).
   */
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  
  /**
   * Converts a Jupiter JSON instruction into a `TransactionInstruction`.
   *
   * @param ix - Jupiter-serialized instruction (JSON)
   * @returns A `TransactionInstruction` usable in a v0 message
   */
  const toIx = (ix: any) =>
    new TransactionInstruction({
      programId: toPk(ix.programId),
      keys: ix.accounts.map((a: any) => ({
        pubkey: toPk(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      data: Buffer.from(ix.data, "base64"),
    });
  
  /**
   * Fetch SPL mint decimals via `getTokenSupply`.
   *
   * @param mint - SPL mint address
   * @throws If decimals are not available
   */
  async function getTokenDecimals(mint: string): Promise<number> {
    const conn = getConnection();
    const res = await conn.getTokenSupply(toPk(mint));
    const d = res.value?.decimals;
    if (typeof d !== "number") throw new Error(`No decimals for ${mint}`);
    return d;
  }
  
  /**
   * Fetch on-chain token balance for a given owner/mint (first ATA found).
   *
   * @param owner - Owner public key (base58)
   * @param mint  - SPL mint address
   * @returns Balance in base units (BigInt). Returns 0n if no ATA is found.
   */
  async function getTokenBalance(owner: string, mint: string): Promise<bigint> {
    const conn = getConnection();
    const ata = await conn.getTokenAccountsByOwner(toPk(owner), { mint: toPk(mint) });
    if (ata.value.length === 0) return 0n;
    const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
    return BigInt(bal.value.amount);
  }
  
  export interface BuildMultiSwapDiagnostics {
    /** Indices of skipped orders and reasons */
    skipped: Array<{ index: number; reason: string; code?: string }>;
    /** Number of executable orders */
    executedCount: number;
    /** Number of requested orders */
    requestedCount: number;
    /** Total lamports wrapped (SOL → WSOL) */
    wrappedLamports: number;
  }
  
  export interface BuildMultiSwapResult {
    /** Unsigned transaction (web3.js) */
    unsignedTx: VersionedTransaction;
    /** Transaction serialized in base64 (ready for wallet signing) */
    base64: string;
    /** Diagnostics for UI / telemetry */
    diagnostics: BuildMultiSwapDiagnostics;
  }
  
  export interface BuildMultiSwapParams {
    /**
     * List of swap routes. Each route must define `side`, `inputMint`, `outputMint`
     * and either `amount` (base units) or `uiAmount`.
     */
    routes: MultiRouteInput[];
    /** User public key (base58) — payer & expected signer */
    userPublicKey: string;
    /** Behavior when Jupiter cannot find a route (default: "skip") */
    onRouteNotFound?: "skip" | "fail";
  }
  
  /**
   * Builds a v0 transaction orchestrating multiple Jupiter swaps.
   *
   * @param params - See `BuildMultiSwapParams`
   * @returns Result including unsigned transaction, base64 encoding, and diagnostics
   * @throws `Error` if no executable route is found or if amounts are missing
   */
  export async function buildMultiSwapTxV0(params: BuildMultiSwapParams): Promise<BuildMultiSwapResult> {
    const { routes: rawRoutes, userPublicKey, onRouteNotFound = "skip" } = params;
    const conn = getConnection();
  
    // ---------------------------------------------------------------------------
    // 0) Normalize routes (resolve `amount` in base units)
    // ---------------------------------------------------------------------------
    const routes = await Promise.all(
      rawRoutes.map(async (r, idx) => {
        // SELL with `uiAmount` → convert to base units + clamp against on-chain balance
        if (r.side === "sell" && r.uiAmount !== undefined && r.amount === undefined) {
          const dec = await getTokenDecimals(r.inputMint);
          const baseStr = uiToBaseUnits(r.uiAmount, dec);
          const onchainBal = await getTokenBalance(userPublicKey, r.inputMint);
          const safeAmount = BigInt(baseStr) > onchainBal ? onchainBal : BigInt(baseStr);
          return { ...r, amount: safeAmount.toString() };
        }
        // BUY paid in native SOL with `uiAmount` → convert to lamports
        if (r.side !== "sell" && r.inputMint === SOL && r.uiAmount !== undefined && r.amount === undefined) {
          return { ...r, amount: solToLamports(r.uiAmount) };
        }
        // Otherwise, `amount` must be provided
        if (r.amount === undefined) throw new Error(`order[${idx}] missing amount/uiAmount`);
        return r;
      })
    );
  
    // ---------------------------------------------------------------------------
    // 1) Total SOL to wrap (if BUY orders paid in SOL)
    // ---------------------------------------------------------------------------
    const totalLamports = routes
      .filter((r) => r.side !== "sell" && r.inputMint === SOL)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  
    // ---------------------------------------------------------------------------
    // 2) Wrap/unwap instructions via Jupiter (if required)
    //    Use dummy SOL→USDC quote to get wrap/cleanup ixs.
    // ---------------------------------------------------------------------------
    let wrapInstrs: TransactionInstruction[] = [];
    let cleanupInstr: TransactionInstruction | null = null;
    if (totalLamports > 0) {
      const dummyQuote = await getQuote({
        inputMint: SOL,
        outputMint: USDC,
        amount: totalLamports,
        slippageBps: 1,
        swapMode: "ExactIn",
      });
      const swapIxs = await getSwapInstructions({
        userPublicKey,
        quoteResponse: dummyQuote,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      });
      if (swapIxs.setupInstructions?.length) wrapInstrs = swapIxs.setupInstructions.map(toIx);
      if (swapIxs.cleanupInstruction) cleanupInstr = toIx(swapIxs.cleanupInstruction);
    }
  
    // ---------------------------------------------------------------------------
    // 3) Quotes + 4) Swap instructions (fine-grained handling of "no route")
    // ---------------------------------------------------------------------------
    const swapPayloads: Array<{ i: number; ixs: any }> = [];
    const skipped: Array<{ index: number; reason: string; code?: string }> = [];
  
    await Promise.all(
      routes.map(async (r, i) => {
        try {
          const q = await getQuote({
            inputMint: r.inputMint,
            outputMint: r.outputMint,
            amount: r.amount!, // base units
            slippageBps: r.slippageBps,
            swapMode: "ExactIn",
          });
  
          const ixs = await getSwapInstructions({
            userPublicKey,
            quoteResponse: q, // validated quote
            wrapAndUnwrapSol: false,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: "auto",
          });
  
          swapPayloads.push({ i, ixs });
        } catch (e: any) {
          if (e instanceof JupiterApiError && e.errorCode === "COULD_NOT_FIND_ANY_ROUTE") {
            if (onRouteNotFound === "skip") {
              skipped.push({ index: i, reason: e.message, code: e.errorCode });
              return;
            }
          }
          // Other errors or mode = "fail" → rethrow
          throw e;
        }
      })
    );
  
    if (swapPayloads.length === 0) {
      const msg =
        skipped.length > 0
          ? `No executable route. Skipped indices: ${skipped.map((s) => s.index).join(", ")}`
          : "No executable route.";
      throw new Error(msg);
    }
  
    // ---------------------------------------------------------------------------
    // 5) Instruction orchestration (order matters)
    // ---------------------------------------------------------------------------
    const ixs: TransactionInstruction[] = [];
    if (wrapInstrs.length) ixs.push(...wrapInstrs);
  
    // Token ledger (if present in at least one set)
    const tokenLedgerIx = swapPayloads.find((x) => !!x.ixs.tokenLedgerInstruction)?.ixs
      .tokenLedgerInstruction as any;
    if (tokenLedgerIx) ixs.push(toIx(tokenLedgerIx));
  
    // Compute budget: choose the richest set (most instructions)
    const computeBudgetSets = swapPayloads.map((x) => (x.ixs.computeBudgetInstructions ?? []).map(toIx));
    const computeBudget = computeBudgetSets.sort((a, b) => b.length - a.length)[0] ?? [];
    ixs.push(...computeBudget);
  
    // Setup / Swap / Other grouped to keep consistent order
    swapPayloads.forEach((x) => {
      if (x.ixs.setupInstructions?.length) ixs.push(...x.ixs.setupInstructions.map(toIx));
    });
    swapPayloads.forEach((x) => {
      if (x.ixs.swapInstruction) ixs.push(toIx(x.ixs.swapInstruction));
    });
    swapPayloads.forEach((x) => {
      if (x.ixs.otherInstructions?.length) ixs.push(...x.ixs.otherInstructions.map(toIx));
    });
  
    if (cleanupInstr) ixs.push(cleanupInstr);
  
    // ---------------------------------------------------------------------------
    // 6) Address Lookup Tables (resolve ALT accounts returned by Jupiter)
    // ---------------------------------------------------------------------------
    const altAddrs = Array.from(
      new Set(swapPayloads.flatMap((x) => x.ixs.addressLookupTableAddresses || []))
    );
    const altAccounts: AddressLookupTableAccount[] = (
      await Promise.all(altAddrs.map((a) => conn.getAddressLookupTable(toPk(a))))
    )
      .map((r) => r.value)
      .filter(Boolean) as AddressLookupTableAccount[];
  
    // ---------------------------------------------------------------------------
    // 7) Build v0 transaction (payer = user)
    // ---------------------------------------------------------------------------
    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const payer = toPk(userPublicKey);
    const msgV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(altAccounts);
  
    const unsignedTx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(unsignedTx.serialize()).toString("base64");
  
    return {
      unsignedTx,
      base64,
      diagnostics: {
        skipped, // [{ index, reason, code }]
        executedCount: swapPayloads.length,
        requestedCount: routes.length,
        wrappedLamports: totalLamports,
      },
    };
  }
  