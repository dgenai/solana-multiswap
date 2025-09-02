import "dotenv/config";
import { buildMultiSwapTxV0, execute } from "../src";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";

const SOL = "So11111111111111111111111111111111111111112";
const RPC = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");


const DEBUG_SIMULATE = (process.env.DEBUG_SIMULATE ?? "false").toLowerCase() === "true";

type BenchRow = {
  label: string;
  signature: string;
  cu?: number;
  cuPriceMicro?: bigint;
  priorityFeeLamports?: bigint;
  baseFeeLamports?: bigint;
  totalFeeLamports?: bigint;
  rentLamports?: bigint;
};

const LAMPORTS_PER_SIG = 5_000n;

function lamportsToSOL(l: bigint) {
  return Number(l) / 1e9;
}

function dumpInstructions(label: string, tx: VersionedTransaction) {
  console.log(`\n—— Instructions Dump [${label}] ——`);

  // Works for v0 transactions
  if ("compiledInstructions" in tx.message) {
    tx.message.compiledInstructions.forEach((ix, idx) => {
      console.log(
        `${idx.toString().padStart(2, " ")} | programIdIndex=${ix.programIdIndex} | dataLen=${ix.data.length} | keys=${ix.accountKeyIndexes.length}`
      );
    });
  } else {
    console.warn("⚠️ No compiledInstructions found in tx.message");
  }

  console.log("—— End ——\n");
}


/**
 * Extract the compute unit price (µLamports per CU) from transaction instructions.
 */
function extractCuPriceMicroFromTxResponse(tx: any): bigint | undefined {
  try {
    const msg = tx.transaction.message;
    const keys: string[] = msg.accountKeys.map((k: any) =>
      typeof k === "string" ? k : (k.pubkey ?? k.toString?.() ?? "")
    );
    const CB = "ComputeBudget111111111111111111111111111111";
    const cbIdx = keys.findIndex((k) => k === CB);
    if (cbIdx < 0) return undefined;

    let lastPrice: bigint | undefined;
    const instrs = msg.instructions ?? [];
    for (const ix of instrs) {
      if (ix.programIdIndex !== cbIdx) continue;
      const dataStr: string = ix.data;
      let raw: Buffer | undefined;
      try {
        raw = Buffer.from(bs58.decode(dataStr) as Uint8Array);
      } catch {
        try {
          raw = Buffer.from(dataStr, "base64");
        } catch {
          continue;
        }
      }
      if (!raw || raw.length < 2) continue;
      const tag = raw[0];
      if (raw.length >= 9 && (tag === 3 || tag === 4)) {
        const price = raw.readBigUInt64LE(1);
        if (price > 0n) lastPrice = price;
      }
    }
    return lastPrice;
  } catch {
    return undefined;
  }
}

/**
 * Compute rent cost (lamports locked for new accounts created in the transaction).
 */
async function computeRentLamportsFromParsed(sig: string): Promise<bigint> {
  const parsed = await connection.getParsedTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed?.meta?.innerInstructions) return 0n;

  let rent = 0n;
  for (const inner of parsed.meta.innerInstructions) {
    for (const ix of inner.instructions as any[]) {
      const programId = ix.programId?.toString?.() ?? ix.programId ?? "";
      if (programId === "11111111111111111111111111111111" || ix.program === "system") {
        const t = ix.parsed?.type;
        if (t === "createAccount" || t === "createAccountWithSeed") {
          const lamports = BigInt(ix.parsed?.info?.lamports ?? 0);
          rent += lamports;
        }
      }
    }
  }
  return rent;
}

/**
 * Poll until a transaction is available on-chain.
 */
async function waitForTx(signature: string, retries = 20, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Transaction not found after waiting: ${signature}`);
}

/**
 * Analyze an executed transaction and return fee breakdown.
 */
async function analyzeExecuted(signature: string): Promise<BenchRow> {
  const tx = await waitForTx(signature);
  if (!tx) throw new Error(`Transaction not found: ${signature}`);

  const meta = tx.meta!;
  const totalFee = BigInt(meta.fee ?? 0);
  const cu = (meta as any).computeUnitsConsumed ?? 0;

  const nbSigs = BigInt((tx.transaction.signatures?.length ?? 1));
  let base = nbSigs * LAMPORTS_PER_SIG;
  if (base > totalFee) base = totalFee;

  const priority = totalFee > base ? totalFee - base : 0n;

  let priceMicro = extractCuPriceMicroFromTxResponse(tx);
  if (!priceMicro && cu > 0 && priority > 0n) {
    priceMicro = (priority * 1_000_000n) / BigInt(cu);
  }

  const rent = await computeRentLamportsFromParsed(signature);

  return {
    label: "",
    signature,
    cu,
    cuPriceMicro: priceMicro,
    priorityFeeLamports: priority,
    baseFeeLamports: base,
    totalFeeLamports: totalFee,
    rentLamports: rent,
  };
}

/**
 * Pretty-print one benchmark row.
 */
function printRow(label: string, r: BenchRow) {
  const pri = r.priorityFeeLamports ?? 0n;
  const base = r.baseFeeLamports ?? (r.totalFeeLamports !== undefined ? r.totalFeeLamports - pri : 0n);
  const tot = r.totalFeeLamports ?? 0n;
  const rent = r.rentLamports ?? 0n;
  const cuPriceStr = r.cuPriceMicro !== undefined ? `${r.cuPriceMicro.toString()} µLamports/CU` : "n/a";

  console.log(
    `${label.padEnd(12)} | ${r.signature} | CU=${(r.cu ?? 0).toString().padStart(7)} | ` +
    `CU_Price=${cuPriceStr.padEnd(18)} | Base=${base.toString().padStart(8)} | ` +
    `Priority=${pri.toString().padStart(8)} | Total=${tot.toString().padStart(8)} | ` +
    `Rent=${rent.toString().padStart(8)} | Total(SOL)=${lamportsToSOL(tot).toFixed(8)}`
  );
}

/**
 * Run one benchmark round: 1 bundled multi-swap vs each route as a single transaction.
 */
async function runOnce(user: string, routes: any[]) {
  try {
    // Build the bundled multi-route transaction
    const { unsignedTx: multiTx } = await buildMultiSwapTxV0({
      routes,
      userPublicKey: user,
    });

    // Debug-only mode: dump instructions without execution
    if (DEBUG_SIMULATE) {
      dumpInstructions("MULTI", multiTx);
      return {
        multi: { label: "MULTI", signature: "(simulated)" },
        singles: [],
      };
    }

    // Execute the bundled transaction on-chain
    const sigMulti = await execute(multiTx);
    const multi = await analyzeExecuted(sigMulti);
    multi.label = "MULTI";

    // Execute each route as a standalone transaction for comparison
    const singles: BenchRow[] = [];
     
    for (let i = 0; i < routes.length; i++) {
      const { unsignedTx: singleTx } = await buildMultiSwapTxV0({
        routes: [routes[i]],
        userPublicKey: user,
      });
      const sig = await execute(singleTx);
      const row = await analyzeExecuted(sig);
      row.label = `SINGLE[${i}]`;
      singles.push(row);
    } 
    

    return { multi, singles };
  } catch (err: any) {
    // Catch any build/serialization error (e.g., oversized transaction)

    // Option A: rethrow to stop the benchmark
    throw err;

    // Option B: return a placeholder to continue benchmarking
    // return { multi: { label: "MULTI", signature: "(failed)" }, singles: [] };
  }
}



function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const user = process.env.USER_PUBLIC_KEY!;
  if (!user) throw new Error("Missing USER_PUBLIC_KEY");
  if (!process.env.PRIVATE_KEY_B58) throw new Error("Need PRIVATE_KEY_B58 to run REAL benchmark");

  const routes = [
    { side: "buy" as const, inputMint: SOL, outputMint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", uiAmount: 0.00002, slippageBps: 100 },
    { side: "buy" as const, inputMint: SOL, outputMint: "AdwCEWQGzt3vuFMEPMf97AJMiq1eYL2sR7gk2x42pump", uiAmount: 0.00002, slippageBps: 100 },
  ];

  const ITER = 1;
  const multiRuns: BenchRow[] = [];
  const singleRuns: BenchRow[][] = [];

  for (let i = 0; i < ITER; i++) {
    console.log(`\n🔁 Run #${i + 1}/${ITER}`);
    let multi, singles;
    try {
      ( { multi, singles } = await runOnce(user, routes));
    } catch (err) {
      console.error(`❌ runOnce failed on iteration ${i + 1}:`, err);
      continue; // skip this iteration, go to the next
    }
    if (!DEBUG_SIMULATE) {
      console.log("\n📊 BENCHMARK REPORT (Run " + (i + 1) + ")");
      console.log("label        | signature                                                                                         | CU       | CU_Price(µLamports/CU) | Base       | Priority   | Total     | Rent      | Total(SOL)");
      console.log("─────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────┼────────────┼────────────┼───────────┼───────────┼────────────");
      printRow(multi.label, multi);
      for (const s of singles) printRow(s.label, s);

      let sum: BenchRow = {
        label: "SINGLES_SUM",
        signature: "-",
        cu: singles.reduce((a, b) => a + (b.cu ?? 0), 0),
        cuPriceMicro: undefined,
        priorityFeeLamports: singles.reduce((a, b) => a + (b.priorityFeeLamports ?? 0n), 0n),
        baseFeeLamports: singles.reduce((a, b) => a + (b.baseFeeLamports ?? 0n), 0n),
        totalFeeLamports: singles.reduce((a, b) => a + (b.totalFeeLamports ?? 0n), 0n),
        rentLamports: singles.reduce((a, b) => a + (b.rentLamports ?? 0n), 0n),
      };
      console.log("─────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────┼────────────┼────────────┼───────────┼───────────┼────────────");
      printRow(sum.label, sum);

      const savedLamports = (sum.totalFeeLamports ?? 0n) - (multi.totalFeeLamports ?? 0n);
      const savedPct = sum.totalFeeLamports && sum.totalFeeLamports > 0n
        ? (100 * Number(savedLamports)) / Number(sum.totalFeeLamports)
        : 0;

      console.log(`💡 Saved ${savedLamports} lamports (${lamportsToSOL(savedLamports).toFixed(8)} SOL), ~${savedPct.toFixed(2)}% vs singles`);

      multiRuns.push(multi);
      singleRuns.push(singles);

      if (i < ITER - 1) {
        await sleep(20000);
      }
    }
  }

  if (!DEBUG_SIMULATE) {
    function avgBigInt(arr: bigint[]) {
      if (arr.length === 0) return 0n;
      return arr.reduce((a, b) => a + b, 0n) / BigInt(arr.length);
    }

    const totalMultiFees = multiRuns.map(r => r.totalFeeLamports ?? 0n);
    const totalSinglesFees = singleRuns.map(rows =>
      rows.reduce((a, b) => a + (b.totalFeeLamports ?? 0n), 0n)
    );

    const avgMultiFee = avgBigInt(totalMultiFees);
    const avgSinglesFee = avgBigInt(totalSinglesFees);

    console.log("\n📊 BENCHMARK AVERAGE REPORT (over " + ITER + " runs)");
    console.log("────────────────────────────────────────────────────────────────────────────");
    console.log(`MULTI(avg fee):   ${avgMultiFee} lamports (${lamportsToSOL(avgMultiFee).toFixed(8)} SOL)`);
    console.log(`SINGLES(avg fee): ${avgSinglesFee} lamports (${lamportsToSOL(avgSinglesFee).toFixed(8)} SOL)`);

    const savedLamports = avgSinglesFee - avgMultiFee;
    const savedPct =
      avgSinglesFee > 0n ? (100 * Number(savedLamports)) / Number(avgSinglesFee) : 0;

    console.log(`\n💡 Avg result: Bundle saved ${savedLamports} lamports (${lamportsToSOL(savedLamports).toFixed(8)} SOL), ~${savedPct.toFixed(2)}% vs singles`);
  }
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});


