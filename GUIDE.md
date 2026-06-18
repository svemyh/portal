# PORTAL v0.0.7 — Complete Setup & Deployment Guide

---

## File Structure

```
portal/
├── public/
│   ├── index.html          ← main app
│   ├── buy.html            ← key purchase page
│   └── models/             ← face-api.js weights (see Step 3)
├── programs/
│   └── portal/
│       ├── src/lib.rs      ← Solana smart contract
│       └── Cargo.toml
├── server.js               ← Express + Socket.io server
├── portal-keys.js          ← Solana key system
├── download-models.js      ← one-time model download script
├── package.json
├── Anchor.toml
└── .env.example
```

---

## Part 1 — Basic Setup (no key system)

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Fill in TURN server credentials. Leave `PORTAL_KEYS_ENABLED` blank for now.

### Step 3 — Download face-api models (one time)

```bash
node download-models.js
```

This downloads ~120KB of model weights into `public/models/`.
The face analysis (hair colour, shirt colour) won't work without this.

### Step 4 — Run locally

```bash
npm start
```

Visit `http://localhost:3000`. Open two tabs, enter the same code in both — you're connected.

### Step 5 — Deploy to Render (or Railway/Fly)

1. Push to GitHub
2. Create a new Web Service on render.com
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Add environment variables from your `.env`
6. Deploy

---

## Part 2 — TURN Server (for reliable connections across networks)

Without a TURN server, connections may fail on mobile or behind firewalls.

### Option A — Self-hosted (Vultr/DigitalOcean, ~$6/mo)

```bash
# On your VPS:
apt install coturn

# /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=portal:your_password
realm=portal.gripe
total-quota=100
stale-nonce=600

systemctl enable coturn && systemctl start coturn
```

Then set in `.env`:
```
TURN_URL_UDP=turn:YOUR_VPS_IP:3478?transport=udp
TURN_URL_TCP=turn:YOUR_VPS_IP:3478?transport=tcp
TURN_USERNAME=portal
TURN_CREDENTIAL=your_password
```

### Option B — Metered (managed, has a free tier)

Sign up at metered.ca, get credentials, paste into `.env`.

---

## Part 3 — Solana Key System

### Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0
avm use 0.29.0
```

### Step 1 — Set your key price

In `programs/portal/src/lib.rs`:
```rust
const KEY_PRICE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL
```
1 SOL = 1,000,000,000 lamports.

### Step 2 — Build the program

```bash
anchor build
```

### Step 3 — Get your program ID

```bash
solana-keygen pubkey target/deploy/portal-keypair.json
```

Replace `REPLACE_WITH_YOUR_PROGRAM_ID` in:
- `programs/portal/src/lib.rs` (`declare_id!` macro)
- `Anchor.toml`
- `public/buy.html` (`PROGRAM_ID` constant)
- `.env` (`PROGRAM_ID`)

Rebuild:
```bash
anchor build
```

### Step 4 — Set your treasury wallet

```bash
solana-keygen pubkey ~/.config/solana/id.json
```

Add to `.env`:
```
TREASURY_PUBKEY=<your pubkey>
```

### Step 5 — Deploy to mainnet

```bash
solana config set --url mainnet-beta
solana balance  # need ~0.1 SOL for deploy fees
anchor deploy
```

### Step 6 — Replace the IDL stub

```bash
cat target/idl/portal.json
```

Replace the `const IDL = { ... }` block in `portal-keys.js` with the full output.

### Step 7 — Enable key validation

In `.env`:
```
PORTAL_KEYS_ENABLED=true
```

Redeploy your server. Users will now see "invalid key" if they enter a code that hasn't been purchased or gifted.

### Step 8 — Test

1. Visit `portal.gripe/buy.html`
2. Connect Phantom wallet (mainnet)
3. Purchase a key
4. Visit `portal.gripe`, enter the key
5. Should connect normally

---

## Part 4 — Admin & Gifted Keys

### Generate a free key (runtime, lost on restart)

```bash
curl -X POST https://portal.gripe/admin/generate-key \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
# → { "portalKey": "XXXXXXXX" }
```

### List active admin keys

```bash
curl https://portal.gripe/admin/list-keys \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
```

### Revoke a key

```bash
curl -X POST https://portal.gripe/admin/revoke-key \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"key":"XXXXXXXX"}'
```

### Permanent gifted keys (survive restarts)

Add to `.env`:
```
ADMIN_KEYS=KEY1XXXX,KEY2XXXX
```

Redeploy. These keys load at startup and are logged to console.
To revoke: remove from `ADMIN_KEYS` and redeploy.

---

## Part 5 — Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Mute / unmute your mic |
| `Cmd+D` | Toggle your camera on/off (global) |
| `Cmd+V` | Minimize / restore video box (global) |
| `Cmd+C` | Maximize / minimize chat (global) |
| Double-tap / dblclick video | Toggle remote control |

---

## Part 6 — How Remote Control Works

Double-tap or double-click the video to claim remote control.
When active (border brightens):
- Dragging any box mirrors on your peer's screen
- Scroll/pinch zoom mirrors on your peer's screen
- Only one user can hold control at a time
- Either user can claim or release at any time
- `Cmd+V`, `Cmd+C`, `Cmd+D` are always global regardless of remote control

---

## Turning the key system off

Set `PORTAL_KEYS_ENABLED=` (empty) in your env and redeploy.
Any string will work as a room code again.
