import type { ValidateOptions } from "./types";
/**
 * Validate a portal key on-chain.
 * Returns `true` if the key exists and has not been used.
 *
 * @example
 * ```ts
 * const valid = await validatePortalKey({ connection, code: "ABCD1234" });
 * ```
 */
export declare function validatePortalKey(opts: ValidateOptions): Promise<boolean>;
//# sourceMappingURL=validate.d.ts.map