export type Side = "buy" | "sell";

export interface MultiRouteInput {
  inputMint: string;
  outputMint: string;
  amount?: string | number;   // base units
  uiAmount?: number;          // UI units
  slippageBps: number;
  side?: Side;
}