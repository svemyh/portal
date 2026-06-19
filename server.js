const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

/* ---------- KEY VALIDATION ---------- */
/*
  Set PORTAL_KEYS_ENABLED=true in your .env to enforce key validation.
  Leave unset during development to allow any code.
*/

let portalKeys = null;

if (process.env.PORTAL_KEYS_ENABLED === "true") {
  portalKeys = require("./portal-keys");
  portalKeys.init(app);
  console.log("portal key validation enabled");
} else {
  /* Dev mode — expose stub routes so buy.html doesn't 404 */
  app.get("/key-price", (_, res) => res.json({ lamports: 100_000_000, sol: 0.1 }));
  console.log("portal key validation DISABLED (dev mode)");
}

/* ---------- FACE SERVICE PROXY ---------- */

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";

async function faceProxy(path, body, res) {
  try {
    const r = await fetch(`${FACE_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      let preview = "";
      try { preview = (await r.text()).slice(0, 120); } catch {}
      console.error(`face service non-JSON [${r.status}] ct="${ct}" body="${preview}"`);
      return res.status(502).json({
        error: "face service unavailable — it may be cold-starting, please retry in ~30s",
        status: r.status,
      });
    }
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(503).json({ error: "face service unavailable", detail: e.message });
  }
}

app.post("/admin/auth", (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.json({ ok: true });
});

app.post("/face/enroll", (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  faceProxy("/enroll", req.body, res);
});
app.post("/face/verify",  (req, res) => faceProxy("/verify",  req.body, res));
app.post("/face/detect",  (req, res) => faceProxy("/detect",  req.body, res));

/* DELETE /admin/enrollments/:key — remove a private key's face enrollment */
app.delete("/admin/enrollments/:key", async (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const key = req.params.key.trim().toUpperCase();
  // Only allow deleting private (non-chain) keys
  if (portalKeys && process.env.PROGRAM_ID && !portalKeys.isAdminKey(key)) {
    return res.status(403).json({ error: "cannot delete on-chain key enrollments" });
  }
  try {
    const r = await fetch(`${FACE_SERVICE_URL}/enrolled/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: "face service unavailable", detail: e.message });
  }
});

/* GET /admin/enrollments — list enrolled keys with on-chain/private status */
app.get("/admin/enrollments", async (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const r = await fetch(`${FACE_SERVICE_URL}/enrolled`);
    if (!r.ok) return res.status(502).json({ error: "face service error" });
    const { count, keys } = await r.json();

    const programDeployed = !!process.env.PROGRAM_ID;
    const records = await Promise.all(keys.map(async (k) => {
      let chain = "private"; // default — off-chain/admin key
      if (portalKeys && programDeployed && !portalKeys.isAdminKey(k)) {
        const valid = await portalKeys.validateKey(k);
        chain = valid ? "on-chain" : "private";
      }
      return { key: k, chain };
    }));

    res.json({ count, enrollments: records });
  } catch (e) {
    res.status(503).json({ error: "face service unavailable", detail: e.message });
  }
});

/* ---------- ICE CONFIG ---------- */

app.get("/ice-config", (req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  if (process.env.TURN_URL_UDP || process.env.TURN_URL_TCP) {
    const urls = [];
    if (process.env.TURN_URL_UDP) urls.push(process.env.TURN_URL_UDP);
    if (process.env.TURN_URL_TCP) urls.push(process.env.TURN_URL_TCP);
    iceServers.push({
      urls,
      username:   process.env.TURN_USERNAME   || "",
      credential: process.env.TURN_CREDENTIAL || ""
    });
  }

  res.json({ iceServers });
});

/* ---------- ROOMS ---------- */

const rooms = {};

io.on("connection", (socket) => {

  socket.on("join", async (code) => {
    code = code.trim();

    /* Validate key on-chain if enabled */
    if (portalKeys) {
      const valid = await portalKeys.validateKey(code);
      if (!valid) {
        socket.emit("invalid_key");
        return;
      }
    }

    if (!rooms[code]) rooms[code] = { users: [] };
    const room = rooms[code];

    if (room.users.length >= 2) {
      socket.emit("full");
      return;
    }

    const userNumber = room.users.length === 0 ? 1 : 2;
    room.users.push(socket.id);
    socket.join(code);
    socket.code = code;

    socket.emit("assigned", { userNumber });

    if (room.users.length === 2) {
      const [first, second] = room.users;
      io.to(first).emit("peer",  { initiator: true  });
      io.to(second).emit("peer", { initiator: false });
    }
  });

  /* ---------- SIGNAL ---------- */

  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  /* ---------- FACE WARNING ---------- */

  socket.on("face_warning",  (code) => { socket.to(code).emit("face_warning"); });
  socket.on("face_verified", (code) => { socket.to(code).emit("face_verified"); });

  /* ---------- REMOTE TRANSFORM ---------- */

  socket.on("transform", ({ code, target, posX, posY, scale }) => {
    socket.to(code).emit("transform", { target, posX, posY, scale });
  });

  /* ---------- DISCONNECT ---------- */

  socket.on("disconnect", () => {
    const code = socket.code;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    room.users = room.users.filter(id => id !== socket.id);
    socket.to(code).emit("peer_left");

    if (room.users.length === 0) delete rooms[code];
  });
});

/* ---------- START ---------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("running on port " + PORT));
