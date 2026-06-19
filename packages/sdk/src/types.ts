import { Connection, PublicKey } from "@solana/web3.js";

export interface ValidateOptions {
  /** Solana RPC connection. */
  connection: Connection;
  /** Deployed Portal program ID. Defaults to mainnet address. */
  programId?: string | PublicKey;
  /** 8-character portal key to validate. */
  code: string;
}

export interface PurchaseOptions {
  /** Solana RPC connection. */
  connection: Connection;
  /** Buyer's public key. */
  buyer: PublicKey;
  /** Treasury wallet that receives SOL. */
  treasury: PublicKey;
  /** Deployed Portal program ID. Defaults to mainnet address. */
  programId?: string | PublicKey;
}

export interface KeyRecordData {
  owner: PublicKey;
  portalKey: string;
  purchasedAt: number;
  used: boolean;
}
