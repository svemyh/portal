const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
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
