import express from "express";
import { join } from "node:path";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { Database } from "bun:sqlite";

type ChatMessage = {
  id: number;
  pseudo: string;
  text: string;
  clientId: string | null;
  createdAt: number;
};

const db = new Database("chat.db");

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo TEXT NOT NULL,
    text TEXT NOT NULL,
    client_id TEXT,
    created_at INTEGER NOT NULL
  )
`);

const insertMessage = db.query(
  "INSERT INTO messages (pseudo, text, client_id, created_at) VALUES (?, ?, ?, ?)",
);

const selectAfter = db.query(
  `SELECT id, pseudo, text, client_id AS clientId, created_at AS createdAt
   FROM messages WHERE id > ? ORDER BY id`,
);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Sert style.css (et tout ce qui est dans src/)
app.use(express.static(join(import.meta.dirname, "src")));

app.get("/", (req, res) => {
  res.sendFile(join(import.meta.dirname, "src/index.html"));
});

io.on("connection", (socket) => {
  console.log("a user connected");

  // Le client envoie l'id du dernier message qu'il a vu
  const offset = Number(socket.handshake.auth.serverOffset) || 0;

  const missed = selectAfter.all(offset) as ChatMessage[];
  for (const msg of missed) {
    socket.emit("chat message", msg);
  }

  socket.on("join", (pseudo: string, clientId: string) => {
    const clean = String(pseudo).trim().slice(0, 20) || "Anonyme";
    socket.data.pseudo = clean;
    socket.data.clientId = String(clientId).slice(0, 64);

    socket.broadcast.emit("system message", `${clean} s'est connecté`);
  });

  socket.on("chat message", (text: string) => {
    const clean = String(text).trim().slice(0, 500);
    if (!clean) return;

    const pseudo = socket.data.pseudo ?? "Anonyme";
    const clientId = socket.data.clientId ?? null;
    const createdAt = Date.now();

    const result = insertMessage.run(pseudo, clean, clientId, createdAt);

    const msg: ChatMessage = {
      id: Number(result.lastInsertRowid),
      pseudo,
      text: clean,
      clientId,
      createdAt,
    };

    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
    if (socket.data.pseudo) {
      socket.broadcast.emit("system message", `${socket.data.pseudo} est parti`);
    }
  });
});

httpServer.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});