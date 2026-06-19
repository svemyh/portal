import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID as DEFAULT_PROGRAM_ID } from "@maxtindall/portal-idl";
import type { ValidateOptions } from "./types";

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
export async function validatePortalKey(opts: ValidateOptions): Promise<boolean> {
  const { connection, code } = opts;
  const programId = new PublicKey(opts.programId ?? DEFAULT_PROGRAM_ID);

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: KEY_RECORD_DISCRIMINATOR.toString("base64") } },
      { dataSize: KEY_RECORD_DATA_SIZE },
    ],
  });

  for (const { account } of accounts) {
    const data   = account.data;
    const strLen = data.readUInt32LE(40);
    const key    = data.slice(44, 44 + strLen).toString("utf8");
    const used   = data[44 + strLen + 8] === 1;

    if (key === code && !used) return true;
  }

  return false;
}
