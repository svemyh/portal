/**
 * @maxtindall/portal-idl
 * Anchor IDL and TypeScript types for the Portal Solana program.
 */
export declare const PROGRAM_ID = "75vZMouaNixrw4zk1rohwMyHCkPZU7odD5crg6goWjM6";
export declare const IDL: {
    readonly address: "75vZMouaNixrw4zk1rohwMyHCkPZU7odD5crg6goWjM6";
    readonly metadata: {
        readonly name: "portal";
        readonly version: "0.1.0";
        readonly spec: "0.1.0";
    };
    readonly instructions: readonly [{
        readonly name: "mark_used";
        readonly docs: readonly ["Mark a key as used — called by your server after a session starts.", "Only callable by the key's original buyer."];
        readonly discriminator: readonly [37, 245, 77, 214, 14, 19, 195, 15];
        readonly accounts: readonly [{
            readonly name: "authority";
            readonly signer: true;
        }, {
            readonly name: "key_record";
            readonly writable: true;
        }];
        readonly args: readonly [];
    }, {
        readonly name: "purchase_key";
        readonly docs: readonly ["Purchase a portal key.", "Transfers SOL to treasury, derives a collision-resistant 8-char", "key via SHA-256(pubkey || slot || timestamp), stores in PDA."];
        readonly discriminator: readonly [153, 199, 145, 43, 91, 62, 251, 215];
        readonly accounts: readonly [{
            readonly name: "buyer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "key_record";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [107, 101, 121, 95, 114, 101, 99, 111, 114, 100];
                }, {
                    readonly kind: "account";
                    readonly path: "buyer";
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [];
    }];
    readonly accounts: readonly [{
        readonly name: "KeyRecord";
        readonly discriminator: readonly [71, 3, 224, 40, 16, 111, 28, 230];
    }];
    readonly events: readonly [{
        readonly name: "KeyPurchased";
        readonly discriminator: readonly [35, 110, 48, 77, 210, 4, 195, 28];
    }];
    readonly errors: readonly [{
        readonly code: 6000;
        readonly name: "KeyGenerationFailed";
        readonly msg: "Key generation failed";
    }, {
        readonly code: 6001;
        readonly name: "KeyAlreadyUsed";
        readonly msg: "Key already used";
    }, {
        readonly code: 6002;
        readonly name: "Unauthorized";
        readonly msg: "Unauthorized";
    }];
    readonly types: readonly [{
        readonly name: "KeyPurchased";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "buyer";
                readonly type: "pubkey";
            }, {
                readonly name: "portal_key";
                readonly type: "string";
            }, {
                readonly name: "purchased_at";
                readonly type: "i64";
            }];
        };
    }, {
        readonly name: "KeyRecord";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "owner";
                readonly type: "pubkey";
            }, {
                readonly name: "portal_key";
                readonly type: "string";
            }, {
                readonly name: "purchased_at";
                readonly type: "i64";
            }, {
                readonly name: "used";
                readonly type: "bool";
            }];
        };
    }];
};
/** On-chain record for a purchased portal key. */
export interface KeyRecord {
    /** Solana pubkey of the buyer (base58 string). */
    owner: string;
    /** 8-character portal key (e.g. "ABCD1234"). */
    portalKey: string;
    /** Unix timestamp (seconds) of purchase. */
    purchasedAt: number;
    /** Whether the key has been consumed in a session. */
    used: boolean;
}
/** Event emitted on-chain when a key is purchased. */
export interface KeyPurchasedEvent {
    buyer: string;
    portalKey: string;
    purchasedAt: number;
}
/** Anchor error codes for the Portal program. */
export declare enum PortalError {
    KeyGenerationFailed = 6000,
    KeyAlreadyUsed = 6001,
    Unauthorized = 6002
}
//# sourceMappingURL=index.d.ts.map