// src/lib/jupiter.ts
/**
 * ----------------------------------------------------------------------------
 * Jupiter API Client (Quote v6 & Swap Instructions v6)
 * ----------------------------------------------------------------------------
 *
 * Thin, robust client around the public Jupiter quote API.
 * - Strong runtime validation via Zod schemas
 * - Helpful error surfaces with HTTP status, error codes, and payload previews
 * - Defensive parsing (graceful handling of unexpected shapes)
 *
 * Exposes:
 * - `getQuote` — fetches and validates a v6 quote
 * - `getSwapInstructions` — fetches and validates v6 swap instructions
 */

import { request } from "undici";
import {
  QuoteSchema,
  type Quote,
  SwapIxsSchema,
  type SwapIxs,
} from "./jupiter.schemas.js";

/**
 * Custom error class for Jupiter API failures.
 */
export class JupiterApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly payloadPreview?: string
  ) {
    super(message);
    this.name = "JupiterApiError";
  }
}

/**
 * Safely stringify unknown objects for logs and error messages.
 * @param obj - Any value
 * @param len - Max length of preview string (default: 1000)
 */
function preview(obj: unknown, len = 1000) {
  try {
    return JSON.stringify(obj).slice(0, len);
  } catch {
    return String(obj).slice(0, len);
  }
}

/**
 * Fetch a v6 quote from Jupiter with robust validation and errors.
 *
 * Behavior
 * - Builds URL via URLSearchParams
 * - Checks HTTP status and surfaces `errorCode` when provided
 * - Validates response against `QuoteSchema` (permissive with `.passthrough()`)
 * - Adds guardrails to surface helpful messages when critical keys are missing
 *
 * @param params.inputMint - SPL mint for input token
 * @param params.outputMint - SPL mint for output token
 * @param params.amount - Amount in base units (string or number)
 * @param params.slippageBps - Slippage in basis points
 * @param params.swapMode - "ExactIn" (default) or "ExactOut"
 * @returns Parsed `Quote` object (Zod-validated)
 * @throws `JupiterApiError` on non-200 responses, or `Error` on malformed payloads
 */
export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string | number; // base units
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<Quote> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps),
    swapMode: params.swapMode ?? "ExactIn",
  });

  const res = await request(`https://quote-api.jup.ag/v6/quote?${search.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (res.statusCode !== 200) {
    const text = await res.body.text();
    // Try to extract an errorCode if it's JSON
    let code: string | undefined;
    try {
      code = (JSON.parse(text).errorCode as string) ?? undefined;
    } catch {}
    throw new JupiterApiError(
      `Quote HTTP ${res.statusCode}`,
      res.statusCode,
      code,
      text.slice(0, 800)
    );
  }

  let raw: any;
  try {
    raw = await res.body.json();
  } catch (e) {
    const text = await res.body.text();
    throw new Error(`Quote JSON parse error: ${String(e)}; body=${text.slice(0, 800)}`);
  }

  // Server-side error shape from Jupiter
  if (raw && typeof raw === "object" && "error" in raw) {
    throw new Error(`Quote API error: ${preview(raw)}`);
  }

  // Guardrail: surface a concise message when key fields are missing
  if (!raw?.inputMint || !raw?.outputMint || !raw?.inAmount) {
    throw new Error(
      `Quote shape unexpected (missing inputMint/outputMint/inAmount). Raw=${preview(raw)}`
    );
  }

  // Zod validation (schema tolerates platformFee=null/undefined and extra fields)
  return QuoteSchema.parse(raw);
}

/**
 * Fetch v6 swap instructions for a previously validated quote.
 *
 * Behavior
 * - Posts the Quote (validated by Zod) to the Jupiter endpoint
 * - Checks HTTP status and surfaces response body on failure
 * - Validates the instruction set with `SwapIxsSchema` (nullable/optional fields)
 *
 * @param body.userPublicKey - User public key base58
 * @param body.quoteResponse - A Zod-validated `Quote`
 * @param body.wrapAndUnwrapSol - Whether to include SOL wrap/unwrap instructions
 * @param body.dynamicComputeUnitLimit - Enable CU auto-tuning
 * @param body.prioritizationFeeLamports - "auto" or explicit lamports
 * @returns Parsed `SwapIxs` object (Zod-validated)
 * @throws `Error` on non-200 responses or malformed payloads
 */
export async function getSwapInstructions(body: {
  userPublicKey: string;
  quoteResponse: Quote; // validated Quote is required
  wrapAndUnwrapSol: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: "auto" | number;
}): Promise<SwapIxs> {
  const res = await request("https://quote-api.jup.ag/v6/swap-instructions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (res.statusCode !== 200) {
    const text = await res.body.text();
    throw new Error(`swap-instructions HTTP ${res.statusCode}: ${text.slice(0, 800)}`);
  }

  let raw: any;
  try {
    raw = await res.body.json();
  } catch (e) {
    const text = await res.body.text();
    throw new Error(`swap-instructions JSON parse error: ${String(e)}; body=${text.slice(0, 800)}`);
  }

  if (raw && typeof raw === "object" && "error" in raw) {
    throw new Error(`swap-instructions API error: ${preview(raw)}`);
  }

  return SwapIxsSchema.parse(raw);
}
