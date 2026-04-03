import http from "http";
import express, { type Request, type Response } from "express";
import morgan from "morgan";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./src/config/env";
import { corsMiddleware, socketCorsConfig } from "./src/config/cors";
import { authRouter } from "./src/modules/auth/auth.routes";
import { sessionRouter } from "./src/modules/sessions/session.routes";
import { errorMiddleware } from "./src/middleware/error.middleware";
import { registerSocketHandlers } from "./src/socket/register";
import { sessionService } from "./src/modules/sessions/session.service";

const app = express();

app.use(morgan("dev"));
app.use(corsMiddleware);
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionRouter);

app.use(errorMiddleware);

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: socketCorsConfig
});

registerSocketHandlers(io);

// Best-effort session timeout cleanup (prevents sessions staying active forever).
// Default: 6 hours, runs every 15 minutes.
const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? String(6 * 60 * 60 * 1000));
const SESSION_CLEANUP_INTERVAL_MS = Number(process.env.SESSION_CLEANUP_INTERVAL_MS ?? String(15 * 60 * 1000));

setInterval(() => {
  void sessionService.autoEndExpiredSessions(SESSION_TIMEOUT_MS).catch(() => {
    // Non-fatal; avoid crashing the server due to cleanup issues.
  });
}, SESSION_CLEANUP_INTERVAL_MS);

httpServer.listen(env.PORT, () => {
  console.log(`API + Socket.io on http://localhost:${env.PORT}`);
});
