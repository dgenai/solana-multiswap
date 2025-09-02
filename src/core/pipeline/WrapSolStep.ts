import { Step } from "./Step.js";
import { StepContext } from "../../types.js";
import { toIx } from "../../utils/pk.js";

export class WrapSolStep implements Step {
  constructor(private SOL: string, private USDC: string) {}

  async run(ctx: StepContext): Promise<void> {
    const totalLamports = ctx.routes
      .filter((r) => r.side !== "sell" && r.inputMint === this.SOL)
      .reduce((sum, r) => sum + Number(r.amount), 0);

    ctx.wrappedLamports = totalLamports;

    if (totalLamports > 0) {
      const dummyQuote = await ctx.provider.getQuote({
        inputMint: this.SOL,
        outputMint: this.USDC,
        amount: totalLamports.toString(),
        slippageBps: 1,
        swapMode: "ExactIn",
      });
      const swapIxs = await ctx.provider.getSwapInstructions({
        userPublicKey: ctx.userPublicKey,
        quoteResponse: dummyQuote,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      });
      if (swapIxs.setupInstructions?.length) ctx.wrapInstrs = swapIxs.setupInstructions.map(toIx);
      if (swapIxs.cleanupInstruction) ctx.cleanupInstr = toIx(swapIxs.cleanupInstruction);
    }
  }
}
