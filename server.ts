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
    client_offset TEXT UNIQUE,
    created_at INTEGER NOT NULL
  )
`);

const insertMessage = db.query(
  `INSERT OR IGNORE INTO messages
   (pseudo, text, client_id, client_offset, created_at)
   VALUES (?, ?, ?, ?, ?)`,
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

  // Pseudo et clientId arrivent dès la connexion, via auth
  const { pseudo, clientId, serverOffset } = socket.handshake.auth;

  const cleanPseudo = String(pseudo ?? "").trim().slice(0, 20) || "Anonyme";
  socket.data.pseudo = cleanPseudo;
  socket.data.clientId = String(clientId ?? "").slice(0, 64) || null;

  socket.broadcast.emit("system message", `${cleanPseudo} s'est connecté`);

  // Messages manquants : ceux dont l'id dépasse le dernier vu par le client
  const offset = Number(serverOffset) || 0;
  const missed = selectAfter.all(offset) as ChatMessage[];
  for (const msg of missed) {
    socket.emit("chat message", msg);
  }

  socket.on(
    "chat message",
    (text: string, clientOffset: string, callback?: () => void) => {
      const clean = String(text).trim().slice(0, 500);
      if (!clean) {
        callback?.();
        return;
      }

      const createdAt = Date.now();

      const result = insertMessage.run(
        socket.data.pseudo,
        clean,
        socket.data.clientId,
        String(clientOffset).slice(0, 100),
        createdAt,
      );

      // Déjà enregistré (message renvoyé après une coupure) : on confirme sans rediffuser
      if (result.changes === 0) {
        callback?.();
        return;
      }

      const msg: ChatMessage = {
        id: Number(result.lastInsertRowid),
        pseudo: socket.data.pseudo,
        text: clean,
        clientId: socket.data.clientId,
        createdAt,
      };

      io.emit("chat message", msg);
      callback?.();
    },
  );

  socket.on("disconnect", () => {
    console.log("user disconnected");
    socket.broadcast.emit("system message", `${socket.data.pseudo} est parti`);
  });
});

httpServer.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});