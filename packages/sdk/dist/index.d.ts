/**
 * @maxtindall/portal-sdk
 * Client library for Portal key purchase, validation, and session management.
 *
 * @example
 * ```ts
 * import { validatePortalKey, buildPurchaseTransaction } from '@maxtindall/portal-sdk';
 * ```
 */
export { validatePortalKey } from "./validate";
export { buildPurchaseTransaction, getKeyRecord } from "./purchase";
export type { ValidateOptions, PurchaseOptions, KeyRecordData } from "./types";
export { PROGRAM_ID, IDL } from "@maxtindall/portal-idl";
export type { KeyRecord, KeyPurchasedEvent, PortalError } from "@maxtindall/portal-idl";
//# sourceMappingURL=index.d.ts.map