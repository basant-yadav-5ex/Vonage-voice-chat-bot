import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import registerRoutes from "./src/routes.js";
import setupVonageWs from "./src/websocket/vonageWs.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
// app.use(express.static("../public"));
app.use(express.static(path.join(__dirname, "src/public")));

registerRoutes(app, io);
setupVonageWs(server, io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});