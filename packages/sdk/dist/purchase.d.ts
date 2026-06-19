import { PublicKey, Transaction } from "@solana/web3.js";
import type { PurchaseOptions, KeyRecordData } from "./types";
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
export declare function buildPurchaseTransaction(opts: PurchaseOptions): Promise<Transaction>;
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
export declare function getKeyRecord(opts: Pick<PurchaseOptions, "connection" | "programId"> & {
    buyer: PublicKey;
}): Promise<KeyRecordData | null>;
//# sourceMappingURL=purchase.d.ts.map