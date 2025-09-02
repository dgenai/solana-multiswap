import {
  AddressLookupTableAccount,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { SwapIxs } from "./lib/jupiter.schemas";

export type Side = "buy" | "sell";

export interface MultiRouteInput {
  inputMint: string;
  outputMint: string;
  amount?: string;       // always base units as string
  uiAmount?: number;     // UI units (float)
  slippageBps: number;
  side?: Side;
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
 * Parameters for requesting a quote from Jupiter.
 */
export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // base units, must always be string
  slippageBps: number;
  swapMode: "ExactIn" | "ExactOut";
}

/**
 * Parameters for requesting swap instructions from Jupiter.
 */
export interface SwapInstructionParams {
  userPublicKey: string;
  quoteResponse: any;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | "auto";
}

/**
 * Provider abstraction for Jupiter API.
 */
export interface SwapProvider {
  getQuote(params: QuoteParams): Promise<any>;
  getSwapInstructions(params: SwapInstructionParams): Promise<SwapIxs>;
}

/**
 * Pipeline context passed between steps.
 */
export interface StepContext {
  routes: MultiRouteInput[];
  provider: SwapProvider;
  userPublicKey: string;
  onRouteNotFound: "skip" | "fail";
  skipped: Array<{ index: number; reason: string; code?: string }>;
  swapPayloads: Array<{ i: number; ixs: any }>;
  wrapInstrs: TransactionInstruction[];
  cleanupInstr: TransactionInstruction | null;
  altAccounts: AddressLookupTableAccount[];
  wrappedLamports: number;
  result?: BuildMultiSwapResult;
}
