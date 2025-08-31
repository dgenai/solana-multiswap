// src/utils/amounts.ts
/**
 * ----------------------------------------------------------------------------
 * Amount conversion utilities (UI ↔ base units)
 * ----------------------------------------------------------------------------
 *
 * Provides helpers for converting user-facing numeric amounts to on-chain
 * integer base units (strings), consistent with Solana conventions.
 *
 * - `uiToBaseUnits` — converts a UI amount (e.g. 1.23 USDC) to base units using mint decimals
 * - `solToLamports` — shorthand for SOL → lamports conversion (9 decimals)
 *
 * Usage
 * ```ts
 * const lamports = solToLamports(0.5); // "500000000"
 * const usdcBase = uiToBaseUnits("1.25", 6); // "1250000"
 * ```
 */

/**
 * Convert a user-facing amount into base units.
 *
 * @param ui - Amount as number or string (e.g. "1.25")
 * @param decimals - Mint decimals (e.g. 6 for USDC)
 * @returns String representing integer amount in base units
 */
export function uiToBaseUnits(ui: number | string, decimals: number): string {
  const n = typeof ui === "string" ? parseFloat(ui) : ui;
  return BigInt(Math.floor(n * 10 ** decimals)).toString();
}

/**
 * Convert SOL amount to lamports (9 decimals).
 *
 * @param sol - Amount of SOL (number or string)
 * @returns String representing lamports
 */
export function solToLamports(sol: number | string) {
  return uiToBaseUnits(sol, 9);
}
