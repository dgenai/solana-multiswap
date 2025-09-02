import { Step } from "./Step.js";
import { StepContext } from "../../types.js";
import { JupiterApiError } from "../../lib/jupiter.js";

export class SwapStep implements Step {
  async run(ctx: StepContext): Promise<void> {
    ctx.swapPayloads = [];
    ctx.skipped = [];

    await Promise.all(
      ctx.routes.map(async (r, i) => {
        try {
          const q = await ctx.provider.getQuote({
            inputMint: r.inputMint,
            outputMint: r.outputMint,
            amount: r.amount!,
            slippageBps: r.slippageBps,
            swapMode: "ExactIn",
          });

          const ixs = await ctx.provider.getSwapInstructions({
            userPublicKey: ctx.userPublicKey,
            quoteResponse: q,
            wrapAndUnwrapSol: false,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: "auto",
          });

          ctx.swapPayloads.push({ i, ixs });
        } catch (e: any) {
          if (e instanceof JupiterApiError && e.errorCode === "COULD_NOT_FIND_ANY_ROUTE") {
            if (ctx.onRouteNotFound === "skip") {
              ctx.skipped.push({ index: i, reason: e.message, code: e.errorCode });
              return;
            }
          }
          throw e;
        }
      })
    );

    if (ctx.swapPayloads.length === 0) {
      const msg =
        ctx.skipped.length > 0
          ? `No executable route. Skipped indices: ${ctx.skipped.map((s) => s.index).join(", ")}`
          : "No executable route.";
      throw new Error(msg);
    }
  }
}
