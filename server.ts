import express from "express";
import { join } from "node:path";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { Database } from "bun:sqlite";
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";

// ==========================================
// PROCESSUS PRINCIPAL
// ==========================================

if (cluster.isPrimary) {
  const numWorkers = Math.min(availableParallelism(), 3);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({ PORT: String(3000 + i) });
  }

  setupPrimary();
} else {
  // ==========================================
  // WORKERS : EXPRESS ET SOCKET.IO
  // ==========================================

  type ChatMessage = {
    id: number;
    pseudo: string;
    text: string;
    clientId: string | null;
    createdAt: number;
  };

  // BASE DE DONNÉES
  const db = new Database("chat.db");

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");

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
    `SELECT id, pseudo, text,
            client_id AS clientId,
            created_at AS createdAt
     FROM messages WHERE id > ? ORDER BY id`,
  );

  // EXPRESS
  const app = express();
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    adapter: createAdapter(),
  });

  // Sert style.css (et tout ce qui est dans src/)
  app.use(express.static(join(import.meta.dirname, "src")));

  app.get("/", (req, res) => {
    res.sendFile(join(import.meta.dirname, "src/index.html"));
  });

  // ==========================================
  // SOCKET.IO
  // ==========================================

  io.on("connection", (socket) => {
    console.log("a user connected");

    const { pseudo, clientId, serverOffset } = socket.handshake.auth;

    const cleanPseudo = String(pseudo ?? "").trim().slice(0, 20) || "Anonyme";

    socket.data.pseudo = cleanPseudo;
    socket.data.clientId = String(clientId ?? "").slice(0, 64) || null;

    socket.broadcast.emit("system message", `${cleanPseudo} s'est connecté`);

    // Messages manqués
    const offset = Number(serverOffset) || 0;
    const missed = selectAfter.all(offset) as ChatMessage[];

    for (const msg of missed) {
      socket.emit("chat message", msg);
    }

    // Réception des messages
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

        // Déjà enregistré (message renvoyé après une coupure)
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

    // Déconnexion
    socket.on("disconnect", () => {
      console.log("user disconnected");

      socket.broadcast.emit("system message", `${socket.data.pseudo} est parti`);
    });
  });

  // ==========================================
  // DÉMARRAGE
  // ==========================================

  const port = Number(process.env.PORT) || 3000;

  httpServer.listen(port, () => {
    console.log(`Worker ${process.pid} : http://localhost:${port}`);
  });
}