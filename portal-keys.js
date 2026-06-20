/**
 * portal-keys.js
 * 
 * Add this to server.js with:
 *   const portalKeys = require("./portal-keys");
 *   portalKeys.init(app);
 * 
 * And in the socket "join" handler, validate the code:
 *   const valid = await portalKeys.validateKey(code);
 *   if (!valid) { socket.emit("invalid_key"); return; }
 * 
 * Required env vars (.env):
 *   SOLANA_RPC_URL        e.g. https://api.mainnet-beta.solana.com
 *   PROGRAM_ID            your deployed program ID
 *   TREASURY_PUBKEY       your wallet that receives SOL
 *   SERVER_KEYPAIR        path to your server's keypair JSON (for mark_used)
 */

const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const { Program, AnchorProvider, Wallet, BN } = require("@coral-xyz/anchor");
const { readFileSync } = require("fs");
const crypto = require("crypto");

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const RPC_URL       = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const PROGRAM_ID    = process.env.PROGRAM_ID      ? new PublicKey(process.env.PROGRAM_ID)      : null;
const TREASURY      = process.env.TREASURY_PUBKEY ? new PublicKey(process.env.TREASURY_PUBKEY) : null;
const KEY_PRICE_LAMPORTS = 100_000_000; // must match lib.rs constant

if (!PROGRAM_ID || !TREASURY) {
  console.warn("portal-keys: PROGRAM_ID or TREASURY_PUBKEY not set — purchase/validate routes will be no-ops until contract is deployed");
}

const connection = new Connection(RPC_URL, "confirmed");

/* Load server keypair (used only for mark_used instruction) */
function loadServerKeypair() {
  try {
    const raw = JSON.parse(readFileSync(process.env.SERVER_KEYPAIR || "~/.config/solana/id.json"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    console.warn("SERVER_KEYPAIR not found — mark_used will be unavailable");
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  IDL (minimal — only what the server needs)                         */
/*  Replace with the full generated IDL from `anchor build`            */
/* ------------------------------------------------------------------ */

const IDL = {
  version: "0.1.0",
  name: "portal",
  instructions: [
    {
      name: "purchaseKey",
      accounts: [
        { name: "buyer",         isMut: true,  isSigner: true  },
        { name: "keyRecord",     isMut: true,  isSigner: false },
        { name: "treasury",      isMut: true,  isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "markUsed",
      accounts: [
        { name: "authority",  isMut: false, isSigner: true },
        { name: "keyRecord",  isMut: true,  isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "KeyRecord",
      type: {
        kind: "struct",
        fields: [
          { name: "owner",       type: "publicKey" },
          { name: "portalKey",   type: "string"    },
          { name: "purchasedAt", type: "i64"       },
          { name: "used",        type: "bool"      },
        ],
      },
    },
  ],
  events: [
    {
      name: "KeyPurchased",
      fields: [
        { name: "buyer",       type: "publicKey", index: false },
        { name: "portalKey",   type: "string",    index: false },
        { name: "purchasedAt", type: "i64",       index: false },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  PDA helper                                                          */
/* ------------------------------------------------------------------ */

async function findKeyRecord(buyerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("key_record"), buyerPubkey.toBuffer()],
    PROGRAM_ID
  );
}

/* ------------------------------------------------------------------ */
/*  In-memory session store                                             */
/*  Maps sessionId → { buyerPubkey, portalKey } after confirmation     */
/*  Use Redis/DB in production                                          */
/* ------------------------------------------------------------------ */

const pendingSessions = new Map();

/* ------------------------------------------------------------------ */
/*  Admin key store — bypasses chain, server-side only                 */
/* ------------------------------------------------------------------ */

const adminKeys = new Set();

/* Load permanent gifted keys from env on startup
   ADMIN_KEYS=KEY1,KEY2,KEY3 in your .env               */
if (process.env.ADMIN_KEYS) {
  process.env.ADMIN_KEYS.split(",")
    .map(k => k.trim().toUpperCase())
    .filter(k => k.length === 8)
    .forEach(k => {
      adminKeys.add(k);
      console.log(`Permanent gifted key loaded: ${k}`);
    });
}

function generateAdminKey() {
  const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, b => CHARSET[b % CHARSET.length]).join("");
}

/* ------------------------------------------------------------------ */
/*  Key validation — called at room join                               */
/* ------------------------------------------------------------------ */

async function validateKey(code) {
  /* Check admin keys first — instant, no RPC call */
  if (adminKeys.has(code)) return true;

  /* Contract not yet deployed — allow all codes through */
  if (!PROGRAM_ID) return true;

  try {
    /* Fetch all KeyRecord accounts and look for a matching key */
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 93 }, /* KeyRecord::LEN */
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
  } catch (e) {
    console.error("validateKey error:", e);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Express routes                                                      */
/* ------------------------------------------------------------------ */

function init(app) {

  /* GET /key-price — return current price in lamports */
  app.get("/key-price", (req, res) => {
    res.json({ lamports: KEY_PRICE_LAMPORTS, sol: KEY_PRICE_LAMPORTS / LAMPORTS_PER_SOL });
  });

  /* POST /admin/generate-key
     Header: x-admin-secret: <ADMIN_SECRET>
     Returns: { portalKey: "XXXXXXXX" }
     Generates a free key at your discretion, no SOL required.
  */
  app.post("/admin/generate-key", (req, res) => {
    const validSecret = process.env.ADMIN_SECRET && req.headers["x-admin-secret"] === process.env.ADMIN_SECRET;
    const validKey    = process.env.ADMIN_KEY    && req.headers["x-admin-key"]    === process.env.ADMIN_KEY;
    // If neither env var is configured, allow through (dev mode, consistent with rest of server)
    const authConfigured = !!(process.env.ADMIN_SECRET || process.env.ADMIN_KEY);
    if (authConfigured && !validSecret && !validKey) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const key = generateAdminKey();
    adminKeys.add(key);
    console.log(`Admin key generated: ${key} (total admin keys: ${adminKeys.size})`);
    res.json({ portalKey: key });
  });

  /* POST /admin/revoke-key
     Header: x-admin-secret: <ADMIN_SECRET>
     Body: { key: "XXXXXXXX" }
     Revokes an admin key immediately.
  */
  app.post("/admin/revoke-key", (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "key required" });

    const removed = adminKeys.delete(key);
    res.json({ revoked: removed });
  });

  /* GET /admin/list-keys
     Header: x-admin-secret: <ADMIN_SECRET>
     Lists all currently active admin keys.
  */
  app.get("/admin/list-keys", (req, res) => {
    const secret = req.headers["x-admin-secret"];
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    res.json({ keys: [...adminKeys], count: adminKeys.size });
  });

  /* POST /purchase
     Body: { buyer: "<pubkey string>" }
     Returns: { transaction: "<base64>", sessionId: "<uuid>" }
  */
  app.post("/purchase", async (req, res) => {
    if (!PROGRAM_ID || !TREASURY) {
      return res.status(503).json({ error: "contract not yet deployed" });
    }
    try {
      const buyer = new PublicKey(req.body.buyer);
      const [keyRecordPda] = await findKeyRecord(buyer);

      /* Build the purchase_key instruction */
      const serverKeypair = loadServerKeypair();
      const provider = new AnchorProvider(
        connection,
        new Wallet(serverKeypair || Keypair.generate()), /* dummy wallet — buyer signs */
        { commitment: "confirmed" }
      );
      const program = new Program(IDL, PROGRAM_ID, provider);

      const tx = await program.methods
        .purchaseKey()
        .accounts({
          buyer,
          keyRecord: keyRecordPda,
          treasury: TREASURY,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      /* Set recent blockhash + fee payer */
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = buyer;

      /* Serialize (partially signed — buyer will sign client-side) */
      const serialized = tx.serialize({ requireAllSignatures: false });
      const txBase64   = Buffer.from(serialized).toString("base64");

      /* Create session to track this purchase */
      const sessionId = crypto.randomUUID();
      pendingSessions.set(sessionId, { buyer: buyer.toString(), portalKey: null });

      /* Listen for confirmation to capture the key */
      listenForKey(buyer, sessionId);

      res.json({ transaction: txBase64, sessionId });
    } catch (e) {
      console.error("/purchase error:", e);
      res.status(500).send(e.message);
    }
  });

  /* GET /key/:sessionId — poll after tx confirmation */
  app.get("/key/:sessionId", async (req, res) => {
    const session = pendingSessions.get(req.params.sessionId);
    if (!session) return res.status(404).send("session not found");
    if (!session.portalKey) return res.status(202).send("pending");
    res.json({ portalKey: session.portalKey });
  });

}

/* ------------------------------------------------------------------ */
/*  Listen for KeyPurchased event to capture generated key             */
/* ------------------------------------------------------------------ */

async function listenForKey(buyer, sessionId) {
  /* Poll the buyer's PDA until it has data — simple approach */
  const [pda] = await findKeyRecord(buyer);
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const account = await connection.getAccountInfo(pda);
      if (!account) continue;

      const data   = account.data;
      const strLen = data.readUInt32LE(40);
      const key    = data.slice(44, 44 + strLen).toString("utf8");

      if (key && key.length === 8) {
        const session = pendingSessions.get(sessionId);
        if (session) session.portalKey = key;
        console.log(`Key issued: ${key} for session ${sessionId}`);
        return;
      }
    } catch {}
  }

  console.warn(`Session ${sessionId}: key not found after ${maxAttempts} attempts`);
}

function isAdminKey(code) {
  return adminKeys.has(code.trim().toUpperCase());
}

module.exports = { init, validateKey, isAdminKey };
