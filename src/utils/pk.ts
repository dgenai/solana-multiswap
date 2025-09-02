import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/**
 * Convertit une string base58 en PublicKey.
 */
export const toPk = (s: string): PublicKey => new PublicKey(s);

/**
 * Convertit une Jupiter JSON instruction en TransactionInstruction.
 */
export const toIx = (ix: any): TransactionInstruction =>
  new TransactionInstruction({
    programId: toPk(ix.programId),
    keys: ix.accounts.map((a: any) => ({
      pubkey: toPk(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
