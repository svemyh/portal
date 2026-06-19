"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePortalKey = validatePortalKey;
const web3_js_1 = require("@solana/web3.js");
const portal_idl_1 = require("@maxtindall/portal-idl");
const KEY_RECORD_DISCRIMINATOR = Buffer.from([71, 3, 224, 40, 16, 111, 28, 230]);
const KEY_RECORD_DATA_SIZE = 93;
/**
 * Validate a portal key on-chain.
 * Returns `true` if the key exists and has not been used.
 *
 * @example
 * ```ts
 * const valid = await validatePortalKey({ connection, code: "ABCD1234" });
 * ```
 */
async function validatePortalKey(opts) {
    const { connection, code } = opts;
    const programId = new web3_js_1.PublicKey(opts.programId ?? portal_idl_1.PROGRAM_ID);
    const accounts = await connection.getProgramAccounts(programId, {
        filters: [
            { memcmp: { offset: 0, bytes: KEY_RECORD_DISCRIMINATOR.toString("base64") } },
            { dataSize: KEY_RECORD_DATA_SIZE },
        ],
    });
    for (const { account } of accounts) {
        const data = account.data;
        const strLen = data.readUInt32LE(40);
        const key = data.slice(44, 44 + strLen).toString("utf8");
        const used = data[44 + strLen + 8] === 1;
        if (key === code && !used)
            return true;
    }
    return false;
}
//# sourceMappingURL=validate.js.map