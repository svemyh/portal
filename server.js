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

    // limit to 2 users
    if (rooms[code].length >= 2) {
      socket.emit("full");
      return;
    }

    // add user to room
    rooms[code].push(socket.id);
    socket.join(code);
    socket.code = code;

    // assign user number (first = 1, second = 2)
    const userNumber = rooms[code].length;

    // send number to this user
    socket.emit("assigned", { userNumber });

    // if 2 users, start connection
    if (rooms[code].length === 2) {
      const [a, b] = rooms[code];

      // first user = initiator (#1)
      io.to(a).emit("peer", { initiator: true });

      // second user = receiver (#2)
      io.to(b).emit("peer", { initiator: false });
    }
  });

  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  socket.on("disconnect", () => {
    const code = socket.code;
    if (!code || !rooms[code]) return;

    // notify peer (optional, but clean)
    socket.to(code).emit("peer_left");

    // remove user
    rooms[code] = rooms[code].filter(id => id !== socket.id);

    // cleanup empty room
    if (rooms[code].length === 0) {
      delete rooms[code];
    }
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("running on port " + PORT);
});