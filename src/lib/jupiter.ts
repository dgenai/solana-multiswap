// src/lib/jupiter.ts
import { request } from "undici";
import {
  QuoteSchema,
  type Quote,
  SwapIxsSchema,
  SwapSchema,
  type SwapResponse,
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
 * Generic exponential backoff retry wrapper.
 * - Retries on 429 or 5xx
 * - Delay grows exponentially (baseDelay * 2^attempt)
 * - Adds jitter to avoid thundering herd
 */
async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelayMs = 300
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.statusCode;
      if (
        attempt < maxRetries &&
        (status === 429 || (status && status >= 500))
      ) {
        const delay =
          baseDelayMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * 100); // jitter
        console.warn(
          `⚠️ Jupiter API ${status}, retrying in ${delay}ms (attempt ${
            attempt + 1
          }/${maxRetries})`
        );
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Safely stringify unknown objects for logs and error messages.
 */
function preview(obj: unknown, len = 1000) {
  try {
    return JSON.stringify(obj).slice(0, len);
  } catch {
    return String(obj).slice(0, len);
  }
}

/**
 * Fetch a v6 quote from Jupiter with retry + validation.
 */
export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string | number;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<Quote> {
  return withBackoff(async () => {
    const search = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: String(params.amount),
      slippageBps: String(params.slippageBps),
      swapMode: params.swapMode ?? "ExactIn",
    });

    const res = await request(
      `https://quote-api.jup.ag/v6/quote?${search.toString()}`,
      { method: "GET", headers: { accept: "application/json" } }
    );

    if (res.statusCode !== 200) {
      const text = await res.body.text();
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

    const raw = await res.body.json();
   
    return QuoteSchema.parse(raw);
  });
}

/**
 * Fetch swap-instructions (v6) with retry + validation.
 */
export async function getSwapInstructions(body: {
  userPublicKey: string;
  quoteResponse: Quote;
  wrapAndUnwrapSol: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: "auto" | number;
}): Promise<SwapIxs> {
  return withBackoff(async () => {
    const res = await request("https://quote-api.jup.ag/v6/swap-instructions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });

    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new JupiterApiError(
        `swap-instructions HTTP ${res.statusCode}`,
        res.statusCode,
        undefined,
        text.slice(0, 800)
      );
    }

    const raw = await res.body.json();
    return SwapIxsSchema.parse(raw);
  });
}

/**
 * Fetch full swap transaction (v6) with retry + validation.
 */
export async function getSwap(body: {
  userPublicKey: string;
  quoteResponse: Quote;
  wrapAndUnwrapSol: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: "auto" | number;
}): Promise<SwapResponse> {
  return withBackoff(async () => {
    const res = await request("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });

    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new JupiterApiError(
        `/swap HTTP ${res.statusCode}`,
        res.statusCode,
        undefined,
        text.slice(0, 800)
      );
    }

    const raw = await res.body.json();
    return SwapSchema.parse(raw);
  });
}
