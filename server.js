const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// rooms now store structured data
const rooms = {};

io.on("connection", (socket) => {

  socket.on("join", (code) => {
    // initialize room
    if (!rooms[code]) {
      rooms[code] = {
        users: []
      };
    }

    const room = rooms[code];

    // limit to 2 users
    if (room.users.length >= 2) {
      socket.emit("full");
      return;
    }

    // assign user number deterministically
    const userNumber = room.users.length === 0 ? 1 : 2;

    room.users.push(socket.id);

    socket.join(code);
    socket.code = code;

    // send user identity
    socket.emit("assigned", { userNumber });

    // when both users present, assign roles explicitly
    if (room.users.length === 2) {
      const [first, second] = room.users;

      // first = initiator (#1)
      io.to(first).emit("peer", { initiator: true });

      // second = receiver (#2)
      io.to(second).emit("peer", { initiator: false });
    }
  });

  // relay signaling
  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  // cleanup on disconnect
  socket.on("disconnect", () => {
    const code = socket.code;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    // remove user from room
    room.users = room.users.filter(id => id !== socket.id);

    // notify remaining peer
    socket.to(code).emit("peer_left");

    // delete empty room
    if (room.users.length === 0) {
      delete rooms[code];
    }
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("running on port " + PORT);
});