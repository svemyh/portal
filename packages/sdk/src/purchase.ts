import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { IDL, PROGRAM_ID as DEFAULT_PROGRAM_ID } from "@maxtindall/portal-idl";
import type { PurchaseOptions, KeyRecordData } from "./types";

function resolveProgramId(id?: string | PublicKey): PublicKey {
  return new PublicKey(id ?? DEFAULT_PROGRAM_ID);
}

function findKeyRecordPda(buyer: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("key_record"), buyer.toBuffer()],
    programId
  );
  return pda;
}

/**
 * Build a Solana transaction that purchases a portal key.
 * The caller must sign and send the transaction.
 *
 * @example
 * ```ts
 * const tx = await buildPurchaseTransaction({ connection, buyer, treasury });
 * const sig = await wallet.sendTransaction(tx, connection);
 * ```
 */
export async function buildPurchaseTransaction(opts: PurchaseOptions): Promise<Transaction> {
  const { connection, buyer, treasury } = opts;
  const programId = resolveProgramId(opts.programId);
  const keyRecord = findKeyRecordPda(buyer, programId);

  // Use a dummy signer for the provider — buyer signs client-side
  const dummyWallet = {
    publicKey: buyer,
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
  } as unknown as Wallet;

  const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program  = new Program(IDL as any, programId, provider);

  const tx = await program.methods
    .purchaseKey()
    .accounts({ buyer, keyRecord, treasury, systemProgram: SystemProgram.programId })
    .transaction();

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyer;

  return tx;
}

/**
 * Fetch the KeyRecord PDA data for a given buyer.
 * Returns `null` if the buyer has not purchased a key.
 *
 * @example
 * ```ts
 * const record = await getKeyRecord({ connection, buyer: new PublicKey("...") });
 * console.log(record?.portalKey); // "ABCD1234"
 * ```
 */
export async function getKeyRecord(
  opts: Pick<PurchaseOptions, "connection" | "programId"> & { buyer: PublicKey }
): Promise<KeyRecordData | null> {
  const { connection, buyer } = opts;
  const programId = resolveProgramId(opts.programId);
  const pda = findKeyRecordPda(buyer, programId);

  const info = await connection.getAccountInfo(pda);
  if (!info) return null;

  const data     = info.data;
  const owner    = new PublicKey(data.slice(8, 40));
  const strLen   = data.readUInt32LE(40);
  const portalKey = data.slice(44, 44 + strLen).toString("utf8");
  const purchasedAt = Number(data.readBigInt64LE(44 + strLen));
  const used     = data[44 + strLen + 8] === 1;

  return { owner, portalKey, purchasedAt, used };
}
