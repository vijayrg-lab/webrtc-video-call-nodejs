import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Room data: { roomId: Set<socket.id> }
const MAX_USERS = 4;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId, role) => {
    socket.data.role = role; // 'moderator' or 'user'

    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    if (clients.size >= MAX_USERS) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);
    socket.emit("joined-room", { roomId, role });
    console.log(`${role} joined room ${roomId}`);

    // Notify moderator if a new user joins
    if (role === "user") {
      const moderatorSockets = Array.from(clients)
        .map(id => io.sockets.sockets.get(id))
        .filter(s => s && s.data.role === "moderator");

      moderatorSockets.forEach(mod => {
        mod.emit("user-joined", socket.id);
      });
    }
  });

  // Relay offers / answers / ICE candidates
  socket.on("offer", (data) => {
    const { roomId, to, fromRole } = data;

    // Users cannot send streams to other users
    if (fromRole === "user") {
      // send only to moderators
      const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
      clients.forEach(id => {
        const s = io.sockets.sockets.get(id);
        if (s && s.data.role === "moderator" && s.id !== socket.id) {
          s.emit("offer", data);
        }
      });
      return;
    }

    // Moderator offers → send to all users
    if (fromRole === "moderator") {
      socket.to(roomId).emit("offer", data);
    }
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    // Optional: Notify room
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
