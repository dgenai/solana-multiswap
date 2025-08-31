// tests/jupiter.schemas.test.ts
/**
 * ----------------------------------------------------------------------------
 * Jupiter Schemas Tests
 * ----------------------------------------------------------------------------
 *
 * Unit tests for Zod schemas validating Jupiter API responses.
 *
 * - Verifies `QuoteSchema` parses a minimal valid quote payload
 * - Verifies `SwapIxsSchema` parses a minimal valid swap-instructions payload
 * - Ensures required fields are preserved and parsed correctly
 *
 * Run with:
 * ```bash
 * npx vitest run
 * ```
 */

import { describe, it, expect } from "vitest";
import { QuoteSchema, SwapIxsSchema } from "../src/lib/jupiter.schemas.js";

describe("Jupiter schemas", () => {
  it("parses a valid quote", () => {
    const payload = {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inAmount: "1000000000",
      outAmount: "995000",
      otherAmountThreshold: "990000",
      swapMode: "ExactIn", // required by schema
      slippageBps: 50,
      platformFee: null, // optional/nullable accepted
      priceImpactPct: "0.0021",
      routePlan: [
        {
          swapInfo: {
            ammKey: "9wFFumD...pN4",
            label: "Jupiter-Route", // required by schema
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "1000000000",
            outAmount: "995000",
            feeAmount: "5000", // required by schema
            feeMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // required by schema
          },
          percent: 100,
          bps: 10000, // required by schema
        },
      ],
      contextSlot: 123456789, // required by schema
      timeTaken: 12, // required by schema (ms)
    };

    const parsed = QuoteSchema.parse(payload);
    expect(parsed.inputMint).toBe(payload.inputMint);
    expect(parsed.swapMode).toBe("ExactIn");
    expect(parsed.routePlan[0].swapInfo.outAmount).toBe("995000");
  });

  it("parses swap-instructions", () => {
    const payload = {
      setupInstructions: [
        {
          programId: "ComputeBudget111111111111111111111111111111",
          accounts: [],
          data: "AQID", // base64 string
        },
      ],
      swapInstruction: {
        programId: "JUP111111111111111111111111111111111111111",
        accounts: [
          {
            pubkey: "So11111111111111111111111111111111111111112",
            isSigner: false,
            isWritable: true,
          },
        ],
        data: "AAAA",
      },
      addressLookupTableAddresses: [
        "H3Jup1TerAddR35555555555555555555555555555",
      ],
    };

    const parsed = SwapIxsSchema.parse(payload);
    expect(parsed.swapInstruction?.programId).toMatch(/^JUP/);
    expect(parsed.addressLookupTableAddresses?.length).toBe(1);
  });
});