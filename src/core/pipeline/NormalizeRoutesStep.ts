import { Step } from "./Step";
import { StepContext } from "../../types";
import { getConnection, toPk } from "../../lib/solana";
import { uiToBaseUnits, solToLamports } from "../../utils/amounts";

/**
 * NormalizeRoutesStep
 *
 * Responsibilities:
 * - Convert `uiAmount` to base units when provided
 * - Enforce presence of either `amount` or `uiAmount`
 * - Clamp SELL amounts against the on-chain balance
 * - Convert BUY orders in native SOL to lamports
 */
export class NormalizeRoutesStep implements Step {
  constructor(private SOL: string) {}

  async run(ctx: StepContext): Promise<void> {
    const conn = getConnection();

    ctx.routes = await Promise.all(
      ctx.routes.map(async (r, idx) => {
        // SELL order with uiAmount: convert to base units and clamp to token balance
        if (r.side === "sell" && r.uiAmount !== undefined && r.amount === undefined) {
          const res = await conn.getTokenSupply(toPk(r.inputMint));
          const decimals = res.value.decimals;
          const baseStr = uiToBaseUnits(r.uiAmount, decimals);

          const ata = await conn.getTokenAccountsByOwner(toPk(ctx.userPublicKey), { mint: toPk(r.inputMint) });
          let onchainBalance = 0n;
          if (ata.value.length > 0) {
            const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
            onchainBalance = BigInt(bal.value.amount);
          }

          const safeAmount = BigInt(baseStr) > onchainBalance ? onchainBalance : BigInt(baseStr);
          return { ...r, amount: safeAmount.toString() };
        }

        // BUY order with native SOL and uiAmount: convert to lamports
        if (r.side !== "sell" && r.inputMint === this.SOL && r.uiAmount !== undefined && r.amount === undefined) {
          return { ...r, amount: solToLamports(r.uiAmount) };
        }

        // Amount explicitly provided: no conversion required
        if (r.amount !== undefined) {
          return r;
        }

        // Invalid route: neither amount nor uiAmount specified
        throw new Error(`order[${idx}] missing amount/uiAmount`);
      })
    );
  }
}
