const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static("public"));

/* ---------- ICE CONFIG ---------- */

app.get("/ice-config", (req, res) => {

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" }
  ];

  if (process.env.TURN_URL_UDP || process.env.TURN_URL_TCP) {

    const urls = [];

    if (process.env.TURN_URL_UDP) urls.push(process.env.TURN_URL_UDP);
    if (process.env.TURN_URL_TCP) urls.push(process.env.TURN_URL_TCP);

    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || ""
    });
  }

  res.json({ iceServers });
});

/* ---------- ROOMS ---------- */

const rooms = {};

io.on("connection", socket => {

  socket.on("join", code => {

    code = String(code || "")
      .trim()
      .toUpperCase();

    if (!code) {
      socket.emit("invalid_room");
      return;
    }

    if (!rooms[code]) {
      rooms[code] = {
        users: [],
        created: Date.now()
      };
    }

    const room = rooms[code];

    if (room.users.length >= 2) {
      socket.emit("full");
      return;
    }

    const userNumber =
      room.users.length === 0 ? 1 : 2;

    room.users.push(socket.id);

    socket.join(code);
    socket.code = code;

    socket.emit("assigned", {
      userNumber
    });

    if (room.users.length === 2) {

      const [first, second] = room.users;

      io.to(first).emit("peer", {
        initiator: true
      });

      io.to(second).emit("peer", {
        initiator: false
      });
    }
  });

  /* ---------- WEBRTC SIGNALING ---------- */

  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  /* ---------- REMOTE VIEWPORT ---------- */

  socket.on("transform", payload => {
    socket.to(payload.code).emit("transform", {
      posX: payload.posX,
      posY: payload.posY,
      scale: payload.scale
    });
  });

  socket.on("control-mode", payload => {
    socket.to(payload.code).emit("control-mode", payload);
  });

  /* ---------- CHAT ---------- */

  socket.on("chat", payload => {
    socket.to(payload.code).emit("chat", payload);
  });

  /* ---------- FACE API ---------- */

  socket.on("face-data", payload => {
    socket.to(payload.code).emit("face-data", payload);
  });

  /* ---------- FILE TRANSFER ---------- */

  socket.on("file-meta", payload => {
    socket.to(payload.code).emit("file-meta", payload);
  });

  socket.on("file-chunk", payload => {
    socket.to(payload.code).emit("file-chunk", payload);
  });

  socket.on("file-complete", payload => {
    socket.to(payload.code).emit("file-complete", payload);
  });

  /* ---------- DISCONNECT ---------- */

  socket.on("disconnect", () => {

    const code = socket.code;

    if (!code || !rooms[code]) return;

    const room = rooms[code];

    room.users =
      room.users.filter(id => id !== socket.id);

    socket.to(code).emit("peer_left");

    if (room.users.length === 0) {
      delete rooms[code];
    }
  });
});

/* ---------- START ---------- */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`portal v0.0.7 running on ${PORT}`);
});