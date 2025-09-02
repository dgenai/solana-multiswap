import { getQuote, getSwapInstructions } from "../../lib/jupiter.js";
import { SwapProvider } from "../../types.js";

export class JupiterProvider implements SwapProvider {
  async getQuote(params: any) {
    return getQuote(params);
  }
  async getSwapInstructions(params: any) {
    return getSwapInstructions(params);
  }
}
