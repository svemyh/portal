"use strict";
/**
 * @maxtindall/portal-idl
 * Anchor IDL and TypeScript types for the Portal Solana program.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortalError = exports.IDL = exports.PROGRAM_ID = void 0;
// ─── Program ID ───────────────────────────────────────────────────────────────
exports.PROGRAM_ID = "75vZMouaNixrw4zk1rohwMyHCkPZU7odD5crg6goWjM6";
// ─── IDL ──────────────────────────────────────────────────────────────────────
exports.IDL = {
    address: "75vZMouaNixrw4zk1rohwMyHCkPZU7odD5crg6goWjM6",
    metadata: {
        name: "portal",
        version: "0.1.0",
        spec: "0.1.0",
    },
    instructions: [
        {
            name: "mark_used",
            docs: [
                "Mark a key as used — called by your server after a session starts.",
                "Only callable by the key's original buyer.",
            ],
            discriminator: [37, 245, 77, 214, 14, 19, 195, 15],
            accounts: [
                { name: "authority", signer: true },
                { name: "key_record", writable: true },
            ],
            args: [],
        },
        {
            name: "purchase_key",
            docs: [
                "Purchase a portal key.",
                "Transfers SOL to treasury, derives a collision-resistant 8-char",
                "key via SHA-256(pubkey || slot || timestamp), stores in PDA.",
            ],
            discriminator: [153, 199, 145, 43, 91, 62, 251, 215],
            accounts: [
                { name: "buyer", writable: true, signer: true },
                {
                    name: "key_record",
                    writable: true,
                    pda: {
                        seeds: [
                            { kind: "const", value: [107, 101, 121, 95, 114, 101, 99, 111, 114, 100] },
                            { kind: "account", path: "buyer" },
                        ],
                    },
                },
                { name: "treasury", writable: true },
                { name: "system_program", address: "11111111111111111111111111111111" },
            ],
            args: [],
        },
    ],
    accounts: [
        {
            name: "KeyRecord",
            discriminator: [71, 3, 224, 40, 16, 111, 28, 230],
        },
    ],
    events: [
        {
            name: "KeyPurchased",
            discriminator: [35, 110, 48, 77, 210, 4, 195, 28],
        },
    ],
    errors: [
        { code: 6000, name: "KeyGenerationFailed", msg: "Key generation failed" },
        { code: 6001, name: "KeyAlreadyUsed", msg: "Key already used" },
        { code: 6002, name: "Unauthorized", msg: "Unauthorized" },
    ],
    types: [
        {
            name: "KeyPurchased",
            type: {
                kind: "struct",
                fields: [
                    { name: "buyer", type: "pubkey" },
                    { name: "portal_key", type: "string" },
                    { name: "purchased_at", type: "i64" },
                ],
            },
        },
        {
            name: "KeyRecord",
            type: {
                kind: "struct",
                fields: [
                    { name: "owner", type: "pubkey" },
                    { name: "portal_key", type: "string" },
                    { name: "purchased_at", type: "i64" },
                    { name: "used", type: "bool" },
                ],
            },
        },
    ],
};
/** Anchor error codes for the Portal program. */
var PortalError;
(function (PortalError) {
    PortalError[PortalError["KeyGenerationFailed"] = 6000] = "KeyGenerationFailed";
    PortalError[PortalError["KeyAlreadyUsed"] = 6001] = "KeyAlreadyUsed";
    PortalError[PortalError["Unauthorized"] = 6002] = "Unauthorized";
})(PortalError || (exports.PortalError = PortalError = {}));
//# sourceMappingURL=index.js.map