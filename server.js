const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {
  socket.on("join", (code) => {
    if (!rooms[code]) rooms[code] = [];

    if (rooms[code].length >= 2) {
      socket.emit("full");
      return;
    }

    rooms[code].push(socket.id);
    socket.join(code);
    socket.code = code;

    if (rooms[code].length === 2) {
      const [a, b] = rooms[code];
      io.to(a).emit("peer", { initiator: true });
      io.to(b).emit("peer", { initiator: false });
    }
  });

  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  socket.on("disconnect", () => {
    const code = socket.code;
    if (!code || !rooms[code]) return;

    rooms[code] = rooms[code].filter(id => id !== socket.id);

    if (rooms[code].length === 0) {
      delete rooms[code];
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("running on port " + PORT);
});
