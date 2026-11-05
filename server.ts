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

app.use(express.static(join(import.meta.dirname, "src")));

type ChatMessage = { pseudo: string; text: string; clientId?: string};

const history: ChatMessage[] = [];
const Max_history = 50;


io.on("connection", (socket) => {
  console.log(`a user connected`);

  socket.on("join", (pseudo: string, clientId: string) => {
    const clean = String(pseudo).trim().slice(0, 20) || "Anonyme";
    socket.data.pseudo = clean;
    socket.data.clientId = String(clientId).slice(0, 64)

    socket.emit('history', history);
    socket.broadcast.emit("system message", `${clean} s'est connecté`);
  });

  socket.on("chat message", (text: string) => {
    const clean = String(text).trim().slice(0, 500);
    if (!clean) return;

    const msg: ChatMessage= {
      pseudo: socket.data.pseudo ?? "Anonyme",
      text: clean,
      clientId: socket.data.clientId,
    };

    history.push(msg);
    if(history.length > Max_history) history.shift();

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