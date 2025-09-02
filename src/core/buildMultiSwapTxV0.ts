import { BuildMultiSwapParams, BuildMultiSwapResult, StepContext } from "../types.js";
import { NormalizeRoutesStep } from "./pipeline/NormalizeRoutesStep.js";
import { WrapSolStep } from "./pipeline/WrapSolStep.js";
import { SwapStep } from "./pipeline/SwapStep.js";
import { AssembleInstructionsStep } from "./pipeline/AssembleInstructionsStep.js";
import { ResolveAltStep } from "./pipeline/ResolveAltStep.js";
import { FinalizeTxStep } from "./pipeline/FinalizeTxStep.js";
import { JupiterProvider } from "./providers/JupiterProvider.js";

export async function buildMultiSwapTxV0(params: BuildMultiSwapParams): Promise<BuildMultiSwapResult> {
  const SOL = "So11111111111111111111111111111111111111112";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  const ctx: StepContext = {
    routes: params.routes,
    provider: new JupiterProvider(),
    userPublicKey: params.userPublicKey,
    onRouteNotFound: params.onRouteNotFound ?? "skip",
    skipped: [],
    swapPayloads: [],
    wrapInstrs: [],
    cleanupInstr: null,
    altAccounts: [],
    wrappedLamports: 0,
  };

  const steps = [
    new NormalizeRoutesStep(SOL),
    new WrapSolStep(SOL, USDC),
    new SwapStep(),
    new AssembleInstructionsStep(),
    new ResolveAltStep(),
    new FinalizeTxStep(),
  ];

  for (const step of steps) {
    await step.run(ctx);
  }

  return ctx.result!;
}
