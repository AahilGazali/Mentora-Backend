import type { Server, Socket } from "socket.io";
import { supabase } from "../config/supabase";
import { sessionService } from "../modules/sessions/session.service";

type SocketUser = { id: string; role: "mentor" | "student" };

async function authenticateSocket(socket: Socket): Promise<SocketUser | null> {
  const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
  if (!token) return null;

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile) return null;

  return {
    id: profile.id as string,
    role: profile.role as "mentor" | "student"
  };
}

function roomForSession(sessionId: string): string {
  return `session:${sessionId}`;
}

export function registerSocketHandlers(io: Server): void {
  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket);
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as SocketUser;
    socket.data.sessions = socket.data.sessions ?? ([] as string[]);

    socket.on("session:join", async (payload: { sessionId?: string }) => {
      const sessionId = payload?.sessionId;
      if (!sessionId) return;
      try {
        await sessionService.getById({ sessionId, requesterId: user.id });
        await socket.join(roomForSession(sessionId));

        // Track sessions for disconnect cleanup.
        const sessions = socket.data.sessions as string[];
        if (!sessions.includes(sessionId)) sessions.push(sessionId);

        socket.emit("session:joined", { sessionId });
        socket.to(roomForSession(sessionId)).emit("session:peer_joined", {
          sessionId,
          userId: user.id,
          role: user.role
        });

        // Add a system message so both peers see join context.
        const systemContent = user.role === "mentor" ? "Mentor joined the session." : "Student joined the session.";
        const saved = await sessionService.insertChatMessage({
          sessionId,
          senderId: user.id,
          content: systemContent,
          type: "system"
        });

        const { data: senderRow } = await supabase
          .from("users")
          .select("id, email, full_name, role, avatar_url, created_at")
          .eq("id", user.id)
          .single();

        io.to(roomForSession(sessionId)).emit("chat:message", {
          id: saved.id,
          content: saved.content,
          sender_id: saved.sender_id,
          created_at: saved.created_at,
          type: saved.type,
          sender: senderRow ?? undefined
        });
      } catch {
        socket.emit("error", { message: "Cannot join session" });
      }
    });

    socket.on(
      "session:leave",
      async (payload: { sessionId?: string }, ack?: (result: { ok: boolean }) => void) => {
        const sessionId = payload?.sessionId;
        if (!sessionId) {
          ack?.({ ok: false });
          return;
        }
        if (user.role !== "student") {
          ack?.({ ok: false });
          return;
        }

        try {
          await sessionService.studentLeave({ sessionId, studentId: user.id });

          const saved = await sessionService.insertChatMessage({
            sessionId,
            senderId: user.id,
            content: "Student left the session.",
            type: "system"
          });

          const { data: senderRow } = await supabase
            .from("users")
            .select("id, email, full_name, role, avatar_url, created_at")
            .eq("id", user.id)
            .single();

          io.to(roomForSession(sessionId)).emit("chat:message", {
            id: saved.id,
            content: saved.content,
            sender_id: saved.sender_id,
            created_at: saved.created_at,
            type: saved.type,
            sender: senderRow ?? undefined
          });

          io.to(roomForSession(sessionId)).emit("session:updated", { sessionId });

          await socket.leave(roomForSession(sessionId));
          const sessions = socket.data.sessions as string[];
          const idx = sessions.indexOf(sessionId);
          if (idx >= 0) sessions.splice(idx, 1);

          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false });
        }
      }
    );

    socket.on("session:end", (payload: { sessionId?: string }) => {
      const sessionId = payload?.sessionId;
      if (!sessionId) return;

      // Broadcast a system message (and persist it) before redirecting clients.
      void (async () => {
        try {
          const systemContent = user.role === "mentor" ? "Mentor ended the session." : "Student ended the session.";
          const saved = await sessionService.insertChatMessage({
            sessionId,
            senderId: user.id,
            content: systemContent,
            type: "system"
          });

          const { data: senderRow } = await supabase
            .from("users")
            .select("id, email, full_name, role, avatar_url, created_at")
            .eq("id", user.id)
            .single();

          io.to(roomForSession(sessionId)).emit("chat:message", {
            id: saved.id,
            content: saved.content,
            sender_id: saved.sender_id,
            created_at: saved.created_at,
            type: saved.type,
            sender: senderRow ?? undefined
          });
        } catch {
          // non-fatal
        }
      })();

      socket.to(roomForSession(sessionId)).emit("session:end", { sessionId });
    });

    socket.on(
      "code:change",
      (payload: { sessionId?: string; code?: string; language?: string }) => {
        const sessionId = payload?.sessionId;
        if (!sessionId || typeof payload?.code !== "string" || typeof payload?.language !== "string") {
          return;
        }
        socket.to(roomForSession(sessionId)).emit("code:update", {
          code: payload.code,
          language: payload.language,
          senderId: user.id
        });
      }
    );

    socket.on(
      "code:cursor",
      (payload: { sessionId?: string; cursor?: { line: number; column: number }; senderId?: string }) => {
        const sessionId = payload?.sessionId;
        if (!sessionId || !payload?.cursor) return;
        socket.to(roomForSession(sessionId)).emit("code:cursor", {
          sessionId,
          cursor: payload.cursor,
          senderId: user.id
        });
      }
    );

    socket.on("chat:typing", (payload: { sessionId?: string; isTyping?: boolean }) => {
      const sessionId = payload?.sessionId;
      if (!sessionId) return;
      socket.to(roomForSession(sessionId)).emit("chat:typing", {
        senderId: user.id,
        isTyping: Boolean(payload.isTyping)
      });
    });

    socket.on("chat:message", async (payload: { sessionId?: string; content?: string }) => {
      const sessionId = payload?.sessionId;
      const content = payload?.content?.trim();
      if (!sessionId || !content) return;

      try {
        await sessionService.getById({ sessionId, requesterId: user.id });
      } catch {
        return;
      }

      const saved = await sessionService.insertChatMessage({
        sessionId,
        senderId: user.id,
        content,
        type: "text"
      });

      const { data: senderRow } = await supabase
        .from("users")
        .select("id, email, full_name, role, avatar_url, created_at")
        .eq("id", user.id)
        .single();

      io.to(roomForSession(sessionId)).emit("chat:message", {
        id: saved.id,
        content: saved.content,
        sender_id: saved.sender_id,
        created_at: saved.created_at,
        type: saved.type,
        sender: senderRow ?? undefined
      });
    });

    const relay = (
      event: "webrtc:offer" | "webrtc:answer" | "webrtc:ice" | "webrtc:request_offer"
    ) => {
      socket.on(event, (payload: { sessionId?: string } & Record<string, unknown>) => {
        const sessionId = payload?.sessionId;
        if (!sessionId) return;
        socket.to(roomForSession(sessionId)).emit(event, payload);
      });
    };

    relay("webrtc:offer");
    relay("webrtc:answer");
    relay("webrtc:ice");
    relay("webrtc:request_offer");

    // Best-effort disconnect handling: add a system message to each room we joined.
    socket.on("disconnect", () => {
      const sessions = (socket.data.sessions ?? []) as string[];
      void (async () => {
        await Promise.all(
          sessions.map(async (sessionId) => {
            try {
              const systemContent = user.role === "mentor" ? "Mentor disconnected." : "Student disconnected.";
              const saved = await sessionService.insertChatMessage({
                sessionId,
                senderId: user.id,
                content: systemContent,
                type: "system"
              });

              io.to(roomForSession(sessionId)).emit("chat:message", {
                id: saved.id,
                content: saved.content,
                sender_id: saved.sender_id,
                created_at: saved.created_at,
                type: saved.type
              });
            } catch {
              // ignore
            }
          })
        );
      })();
    });
  });
}
