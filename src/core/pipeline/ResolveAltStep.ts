// src/core/pipeline/ResolveAltStep.ts
import { Step } from "./Step.js";
import { StepContext } from "../../types.js";
import { getConnection, toPk } from "../../lib/solana";
import { AddressLookupTableAccount } from "@solana/web3.js";

export class ResolveAltStep implements Step {
  async run(ctx: StepContext): Promise<void> {
    const conn = getConnection();
    const altAddrs = Array.from(
      new Set(ctx.swapPayloads.flatMap((x) => x.ixs.addressLookupTableAddresses || []))
    );

    const altAccounts: AddressLookupTableAccount[] = (
      await Promise.all(altAddrs.map((a) => conn.getAddressLookupTable(toPk(a))))
    )
      .map((r) => r.value)
      .filter(Boolean) as AddressLookupTableAccount[];

    ctx.altAccounts = altAccounts;
  }
}
