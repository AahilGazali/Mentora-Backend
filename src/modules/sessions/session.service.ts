import { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../config/supabase";

type UserRole = "mentor" | "student";

export type SessionRow = {
  id: string;
  title: string;
  mentor_id: string | null;
  student_id: string | null;
  status: "waiting" | "active" | "ended";
  join_code: string;
  language: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type StatusedError = Error & { status?: number };

const withStatus = (status: number, message: string): StatusedError => {
  const err = new Error(message) as StatusedError;
  err.status = status;
  return err;
};

const joinCodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const generateJoinCode = (length: number = 8): string => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += joinCodeChars[Math.floor(Math.random() * joinCodeChars.length)];
  }
  return code;
};

const isUniqueViolation = (error: PostgrestError): boolean => {
  return error.code === "23505";
};

export const sessionService = {
  create: async (input: {
    mentorId: string;
    title: string;
    language?: string;
  }): Promise<SessionRow> => {
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const joinCode = generateJoinCode(8);

      const payload: {
        title: string;
        mentor_id: string;
        join_code: string;
        language?: string;
      } = {
        title: input.title,
        mentor_id: input.mentorId,
        join_code: joinCode
      };

      if (input.language) {
        payload.language = input.language;
      }

      const { data: session, error } = await supabase
        .from("sessions")
        .insert(payload)
        .select("*")
        .single();

      if (session) {
        return session as unknown as SessionRow;
      }

      if (error && isUniqueViolation(error) && attempt < maxAttempts - 1) {
        continue;
      }

      throw withStatus(400, error?.message ?? "Failed to create session");
    }

    throw withStatus(500, "Failed to generate a unique join code");
  },

  join: async (input: { studentId: string; joinCode: string }): Promise<SessionRow> => {
    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("join_code", input.joinCode)
      .single();

    if (error || !session) {
      throw withStatus(404, "No session found with that join code.");
    }

    if (session.status !== "waiting") {
      throw withStatus(400, "This session is no longer open to join. It may already be in progress or ended.");
    }

    const { data: updated, error: updateError } = await supabase
      .from("sessions")
      .update({
        student_id: input.studentId,
        status: "active",
        started_at: new Date().toISOString()
      })
      .eq("id", session.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw withStatus(400, updateError?.message ?? "Failed to join session");
    }

    return updated as unknown as SessionRow;
  },

  /**
   * Student voluntarily leaves: clear slot so mentor dashboard no longer shows their name
   * and the room returns to "waiting" for another join.
   */
  studentLeave: async (input: { sessionId: string; studentId: string }): Promise<void> => {
    const session = await sessionService.getById({
      sessionId: input.sessionId,
      requesterId: input.studentId
    });

    if (session.student_id !== input.studentId) {
      throw withStatus(403, "You are not the student in this session.");
    }

    if (session.status === "ended") {
      return;
    }

    const { error } = await supabase
      .from("sessions")
      .update({
        student_id: null,
        status: "waiting"
      })
      .eq("id", input.sessionId)
      .eq("student_id", input.studentId);

    if (error) {
      throw withStatus(400, error.message ?? "Failed to leave session");
    }
  },

  getById: async (input: { sessionId: string; requesterId: string }): Promise<SessionRow> => {
    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", input.sessionId)
      .single();

    if (error || !session) {
      throw withStatus(404, error?.message ?? "Session not found");
    }

    const isMember =
      session.mentor_id === input.requesterId || session.student_id === input.requesterId;

    if (!isMember) {
      const { data: anyMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("session_id", session.id)
        .eq("sender_id", input.requesterId)
        .limit(1)
        .maybeSingle();

      if (!anyMsg) {
        throw withStatus(403, "Forbidden");
      }
    }

    return session as unknown as SessionRow;
  },

  end: async (input: { sessionId: string; mentorId: string }): Promise<void> => {
    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", input.sessionId)
      .single();

    if (error || !session) {
      throw withStatus(404, error?.message ?? "Session not found");
    }

    if (session.mentor_id !== input.mentorId) {
      throw withStatus(403, "Forbidden");
    }

    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString()
      })
      .eq("id", input.sessionId);

    if (updateError) {
      throw withStatus(400, updateError.message ?? "Failed to end session");
    }
  },

  list: async (input: { requesterId: string; role: UserRole }): Promise<SessionRow[]> => {
    const userMapByIds = async (ids: string[]) => {
      if (ids.length === 0) return new Map<string, { id: string; email: string; full_name: string | null }>();
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, email, full_name")
        .in("id", ids);

      if (usersError || !users) {
        throw withStatus(400, usersError?.message ?? "Failed to load participants");
      }

      return new Map(users.map((u) => [u.id as string, u as { id: string; email: string; full_name: string | null }]));
    };

    if (input.role === "mentor") {
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("mentor_id", input.requesterId)
        .order("created_at", { ascending: false });

      if (error || !sessions) {
        throw withStatus(400, error?.message ?? "Failed to list sessions");
      }

      const rows = sessions as unknown as SessionRow[];

      const sessionIdsMissingStudent = rows
        .filter((r) => !r.student_id && r.mentor_id)
        .map((r) => r.id as string);

      const studentSenderBySession = new Map<string, string>();

      if (sessionIdsMissingStudent.length > 0) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("session_id, sender_id, created_at")
          .in("session_id", sessionIdsMissingStudent)
          .order("created_at", { ascending: true });

        const candidateSenderIds = [...new Set((msgs ?? []).map((m) => m.sender_id as string))];

        const { data: userRows } =
          candidateSenderIds.length > 0
            ? await supabase.from("users").select("id, role").in("id", candidateSenderIds)
            : { data: [] as { id: string; role: string }[] };

        const studentUserIds = new Set(
          (userRows ?? []).filter((u) => u.role === "student").map((u) => u.id as string)
        );

        const mentorIdBySession = new Map(rows.map((r) => [r.id as string, r.mentor_id as string]));

        for (const m of msgs ?? []) {
          const sessionId = m.session_id as string;
          if (studentSenderBySession.has(sessionId)) continue;
          const senderId = m.sender_id as string;
          if (senderId === mentorIdBySession.get(sessionId)) continue;
          if (!studentUserIds.has(senderId)) continue;
          studentSenderBySession.set(sessionId, senderId);
        }
      }

      const allStudentIds = [
        ...rows.map((r) => r.student_id).filter((id): id is string => Boolean(id)),
        ...studentSenderBySession.values()
      ];
      const byId = await userMapByIds([...new Set(allStudentIds)]);

      return rows.map((r) => {
        const sid = (r.student_id as string | null) ?? studentSenderBySession.get(r.id as string) ?? null;
        return {
          ...r,
          student: sid ? byId.get(sid) ?? null : null
        };
      }) as unknown as SessionRow[];
    }

    // Student: sessions where they are the assigned student OR they have any message (join/leave/chat)
    // so history stays visible after they leave and student_id is cleared.
    const { data: asCurrentStudent, error: errCurrent } = await supabase
      .from("sessions")
      .select("*")
      .eq("student_id", input.requesterId);

    if (errCurrent) {
      throw withStatus(400, errCurrent.message ?? "Failed to list sessions");
    }

    const { data: msgRows, error: errMsg } = await supabase
      .from("messages")
      .select("session_id")
      .eq("sender_id", input.requesterId);

    if (errMsg) {
      throw withStatus(400, errMsg.message ?? "Failed to list session history");
    }

    const sessionIdsFromMessages = [...new Set((msgRows ?? []).map((m) => m.session_id as string))];

    let fromHistory: SessionRow[] = [];
    if (sessionIdsFromMessages.length > 0) {
      const { data: hist, error: errHist } = await supabase
        .from("sessions")
        .select("*")
        .in("id", sessionIdsFromMessages);

      if (errHist || !hist) {
        throw withStatus(400, errHist?.message ?? "Failed to load sessions");
      }
      fromHistory = hist as unknown as SessionRow[];
    }

    const merged = new Map<string, SessionRow>();
    for (const s of [...(asCurrentStudent ?? []), ...fromHistory]) {
      merged.set(s.id as string, s as unknown as SessionRow);
    }

    const rows = [...merged.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const mentorIds = [...new Set(rows.map((r) => r.mentor_id).filter((id): id is string => Boolean(id)))];
    const byMentor = await userMapByIds(mentorIds);
    return rows.map((r) => ({
      ...r,
      mentor: r.mentor_id ? byMentor.get(r.mentor_id) ?? null : null
    })) as unknown as SessionRow[];
  },

  getLatestSnapshot: async (input: {
    sessionId: string;
    requesterId: string;
  }): Promise<{ code?: string; language?: string }> => {
    await sessionService.getById({
      sessionId: input.sessionId,
      requesterId: input.requesterId
    });

    const { data, error } = await supabase
      .from("code_snapshots")
      .select("code, language")
      .eq("session_id", input.sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw withStatus(400, error.message ?? "Failed to load snapshot");
    }

    if (!data) {
      return {};
    }

    return {
      code: data.code as string | undefined,
      language: data.language as string | undefined
    };
  },

  saveSnapshot: async (input: {
    sessionId: string;
    requesterId: string;
    code: string;
    language: string;
  }): Promise<void> => {
    await sessionService.getById({
      sessionId: input.sessionId,
      requesterId: input.requesterId
    });

    const { error } = await supabase.from("code_snapshots").insert({
      session_id: input.sessionId,
      code: input.code,
      language: input.language,
      saved_by: input.requesterId
    });

    if (error) {
      throw withStatus(400, error.message ?? "Failed to save snapshot");
    }
  },

  listMessages: async (input: { sessionId: string; requesterId: string }) => {
    await sessionService.getById({
      sessionId: input.sessionId,
      requesterId: input.requesterId
    });

    const { data: rows, error } = await supabase
      .from("messages")
      .select("id, session_id, sender_id, content, type, created_at")
      .eq("session_id", input.sessionId)
      .order("created_at", { ascending: true });

    if (error || !rows) {
      throw withStatus(400, error?.message ?? "Failed to load messages");
    }

    const senderIds = [...new Set(rows.map((r) => r.sender_id as string))];
    const { data: users } = await supabase
      .from("users")
      .select("id, email, full_name, role, avatar_url, created_at")
      .in("id", senderIds);

    const userMap = new Map((users ?? []).map((u) => [u.id as string, u]));

    const messages = rows.map((m) => ({
      ...m,
      sender: userMap.get(m.sender_id as string)
    }));

    return { messages };
  },

  listMySnapshots: async (
    requesterId: string
  ): Promise<
    Array<{
      id: string;
      session_id: string;
      session_title: string;
      join_code: string;
      code: string;
      language: string;
      saved_by: string;
      created_at: string;
      partner_display_name: string;
      partner_role: "mentor" | "student";
      has_partner: boolean;
    }>
  > => {
    const { data: sessionsByMembership, error: sessionsError } = await supabase
      .from("sessions")
      .select("id, title, mentor_id, student_id, join_code, created_at")
      .or(`mentor_id.eq.${requesterId},student_id.eq.${requesterId}`);

    if (sessionsError) {
      throw withStatus(400, sessionsError.message ?? "Failed to list sessions");
    }

    const { data: snapshotSessionRows, error: snapErr } = await supabase
      .from("code_snapshots")
      .select("session_id")
      .eq("saved_by", requesterId);

    if (snapErr) {
      throw withStatus(400, snapErr.message ?? "Failed to list snapshot sessions");
    }

    const extraSessionIds = [...new Set((snapshotSessionRows ?? []).map((r) => r.session_id as string))];

    let sessionsFromSnapshots: typeof sessionsByMembership = [];
    if (extraSessionIds.length > 0) {
      const { data: snapSess, error: sessErr } = await supabase
        .from("sessions")
        .select("id, title, mentor_id, student_id, join_code, created_at")
        .in("id", extraSessionIds);

      if (sessErr || !snapSess) {
        throw withStatus(400, sessErr?.message ?? "Failed to load sessions for snapshots");
      }
      sessionsFromSnapshots = snapSess;
    }

    const sessionById = new Map<string, (typeof sessionsByMembership)[0]>();
    for (const s of [...(sessionsByMembership ?? []), ...sessionsFromSnapshots]) {
      sessionById.set(s.id as string, s);
    }
    const sessions = [...sessionById.values()];

    if (!sessions.length) {
      return [];
    }

    const partnerIds = new Set<string>();
    const sessionMeta = new Map<
      string,
      {
        title: string;
        join_code: string;
        partnerId: string | null;
        partner_role: "mentor" | "student";
      }
    >();

    for (const s of sessions) {
      const sid = s.id as string;
      const mentorId = s.mentor_id as string | null;
      const studentId = s.student_id as string | null;
      const title = (s.title as string)?.trim() || "Session";
      const joinCode = (s.join_code as string) ?? "";

      const iAmMentor = mentorId === requesterId;
      const partnerId = iAmMentor ? studentId : mentorId;
      const partner_role: "mentor" | "student" = iAmMentor ? "student" : "mentor";

      if (partnerId) partnerIds.add(partnerId);

      sessionMeta.set(sid, {
        title,
        join_code: joinCode,
        partnerId,
        partner_role
      });
    }

    const { data: partnerRows } =
      partnerIds.size > 0
        ? await supabase.from("users").select("id, email, full_name").in("id", [...partnerIds])
        : { data: [] as { id: string; email: string; full_name: string | null }[] };

    const partnerNameById = new Map(
      (partnerRows ?? []).map((u) => {
        const id = u.id as string;
        const name = (u.full_name as string | null)?.trim();
        const label = name || (u.email as string) || "Partner";
        return [id, label] as const;
      })
    );

    const sessionIds = sessions.map((s) => s.id as string);

    const { data: rows, error } = await supabase
      .from("code_snapshots")
      .select("id, session_id, code, language, saved_by, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error || !rows) {
      throw withStatus(400, error?.message ?? "Failed to list snapshots");
    }

    return rows.map((r) => {
      const meta = sessionMeta.get(r.session_id as string);
      const partnerId = meta?.partnerId ?? null;
      const has_partner = Boolean(partnerId);

      let partner_display_name = "—";
      if (partnerId) {
        partner_display_name = partnerNameById.get(partnerId) ?? "Partner";
      } else if (meta?.partner_role === "student") {
        partner_display_name = "Waiting for a student";
      } else {
        partner_display_name = "Waiting for mentor";
      }

      return {
        id: r.id as string,
        session_id: r.session_id as string,
        session_title: meta?.title ?? "Session",
        join_code: meta?.join_code ?? "",
        code: r.code as string,
        language: r.language as string,
        saved_by: r.saved_by as string,
        created_at: r.created_at as string,
        partner_display_name,
        partner_role: meta?.partner_role ?? "student",
        has_partner
      };
    });
  },

  insertChatMessage: async (input: {
    sessionId: string;
    senderId: string;
    content: string;
    type?: "text" | "system";
  }): Promise<{ id: string; content: string; sender_id: string; created_at: string; type: "text" | "system" }> => {
    const messageType: "text" | "system" = input.type ?? "text";
    const { data, error } = await supabase
      .from("messages")
      .insert({
        session_id: input.sessionId,
        sender_id: input.senderId,
        content: input.content,
        type: messageType
      })
      .select("id, content, sender_id, created_at, type")
      .single();

    if (error || !data) {
      throw withStatus(400, error?.message ?? "Failed to save message");
    }

    return data as {
      id: string;
      content: string;
      sender_id: string;
      created_at: string;
      type: "text" | "system"
    };
  },

  autoEndExpiredSessions: async (maxAgeMs: number): Promise<{ ended: number }> => {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

    // Auto-end long-running active sessions (best-effort cleanup).
    const { error } = await supabase
      .from("sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString()
      })
      .eq("status", "active")
      .lt("started_at", cutoff);

    if (error) {
      throw withStatus(500, error.message ?? "Failed to auto-end expired sessions");
    }

    // We don't strictly need the exact count for MVP claims; keep it simple.
    return { ended: 0 };
  }
};

