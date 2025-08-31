// src/core/schemas.ts
/**
 * ----------------------------------------------------------------------------
 * Zod Schemas for Jupiter Quote v6 & Swap Instructions v6
 * ----------------------------------------------------------------------------
 *
 * Provides runtime validation and TypeScript typing for data returned by the
 * Jupiter aggregator API (quotes, routes, serialized instructions).
 *
 * Key points
 * - Validates quote responses including route plan, fees, and swap mode
 * - Validates serialized instructions (program ID, accounts, base64 data)
 * - Permissive (`.passthrough()`) to allow forward compatibility with extra fields
 * - Provides TypeScript types inferred directly from schemas
 *
 * Usage
 * ```ts
 * const parsed = QuoteSchema.parse(apiResponse);
 * console.log("Out amount:", parsed.outAmount);
 * ```
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Quote v6
// ---------------------------------------------------------------------------

/** Platform fee description */
export const PlatformFeeSchema = z.object({
  amount: z.string(),
  feeBps: z.number(),
});

/** Single swap step information */
export const SwapInfoSchema = z.object({
  ammKey: z.string(),
  label: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  feeAmount: z.string(),
  feeMint: z.string(),
});

/** Route plan item: swap info + allocation % */
export const RoutePlanItemSchema = z.object({
  swapInfo: SwapInfoSchema,
  percent: z.number(),
  bps: z.number(),
});

/** Quote response schema */
export const QuoteSchema = z
  .object({
    inputMint: z.string(),
    inAmount: z.string(),
    outputMint: z.string(),
    outAmount: z.string(),
    otherAmountThreshold: z.string(),
    swapMode: z.enum(["ExactIn", "ExactOut"]),
    slippageBps: z.number(),
    platformFee: PlatformFeeSchema.optional().nullable(),
    priceImpactPct: z.string(),
    routePlan: z.array(RoutePlanItemSchema),
    contextSlot: z.number(),
    timeTaken: z.number(),
  })
  .passthrough(); // allow extra fields not explicitly listed

/** Parsed quote type */
export type Quote = z.infer<typeof QuoteSchema>;

// ---------------------------------------------------------------------------
// Serialized accounts & instructions
// ---------------------------------------------------------------------------

/** Serialized account metadata (Jupiter format) */
export const AccountMetaSchema = z.object({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWritable: z.boolean(),
});

/** Serialized instruction (Jupiter format) */
export const SerializedIxSchema = z.object({
  programId: z.string(),
  accounts: z.array(AccountMetaSchema),
  data: z.string(), // base64 string
});

// ---------------------------------------------------------------------------
// Swap Instructions v6
// ---------------------------------------------------------------------------

/**
 * Swap instruction set returned by Jupiter v6.
 * Some fields may be `null` or omitted, hence optional/nullable.
 */
export const SwapIxsSchema = z
  .object({
    otherInstructions: z.array(SerializedIxSchema).optional(),
    computeBudgetInstructions: z.array(SerializedIxSchema).optional(),
    setupInstructions: z.array(SerializedIxSchema).optional(),

    swapInstruction: SerializedIxSchema.optional().nullable(),
    cleanupInstruction: SerializedIxSchema.optional().nullable(),

    addressLookupTableAddresses: z.array(z.string()).optional(),
  })
  .passthrough(); // allow forward compatibility

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type SwapIxs = z.infer<typeof SwapIxsSchema>;
export type SerializedIx = z.infer<typeof SerializedIxSchema>;
export type AccountMeta = z.infer<typeof AccountMetaSchema>;