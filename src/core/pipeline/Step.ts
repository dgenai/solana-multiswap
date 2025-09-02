import { StepContext } from "../../types.js";

export interface Step {
  run(ctx: StepContext): Promise<void>;
}