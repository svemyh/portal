"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPurchaseTransaction = buildPurchaseTransaction;
exports.getKeyRecord = getKeyRecord;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const portal_idl_1 = require("@maxtindall/portal-idl");
function resolveProgramId(id) {
    return new web3_js_1.PublicKey(id ?? portal_idl_1.PROGRAM_ID);
}
function findKeyRecordPda(buyer, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("key_record"), buyer.toBuffer()], programId);
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
async function buildPurchaseTransaction(opts) {
    const { connection, buyer, treasury } = opts;
    const programId = resolveProgramId(opts.programId);
    const keyRecord = findKeyRecordPda(buyer, programId);
    // Use a dummy signer for the provider — buyer signs client-side
    const dummyWallet = {
        publicKey: buyer,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
    };
    const provider = new anchor_1.AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const program = new anchor_1.Program(portal_idl_1.IDL, programId, provider);
    const tx = await program.methods
        .purchaseKey()
        .accounts({ buyer, keyRecord, treasury, systemProgram: web3_js_1.SystemProgram.programId })
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
async function getKeyRecord(opts) {
    const { connection, buyer } = opts;
    const programId = resolveProgramId(opts.programId);
    const pda = findKeyRecordPda(buyer, programId);
    const info = await connection.getAccountInfo(pda);
    if (!info)
        return null;
    const data = info.data;
    const owner = new web3_js_1.PublicKey(data.slice(8, 40));
    const strLen = data.readUInt32LE(40);
    const portalKey = data.slice(44, 44 + strLen).toString("utf8");
    const purchasedAt = Number(data.readBigInt64LE(44 + strLen));
    const used = data[44 + strLen + 8] === 1;
    return { owner, portalKey, purchasedAt, used };
}
//# sourceMappingURL=purchase.js.map