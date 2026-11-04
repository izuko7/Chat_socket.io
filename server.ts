import express from "express";
import { join } from "node:path";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.get("/", (req, res) => {
  // "index.html" si ce fichier est dans src/, sinon "src/index.html"
  res.sendFile(join(import.meta.dirname, "src/index.html"));
});

io.on("connection", (socket) => {
  console.log("a user connected");

  // socket.on("chat message", (msg) => { ... });
  // à toi : renvoyer le message à tous les clients avec io.emit

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });

  socket.on("chat message", (msg) => {
  io.emit("chat message", msg);
});
});




httpServer.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});