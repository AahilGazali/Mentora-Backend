import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sessionService } from "./session.service";

const createSessionSchema = z.object({
  title: z.string().min(1),
  language: z.string().min(1).optional()
});

const joinSessionSchema = z.object({
  join_code: z
    .string()
    .min(1)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9]{8}$/.test(v), "join_code must be 8 chars (A-Z, 0-9)")
});

const sessionIdSchema = z.object({
  id: z.string().uuid("Invalid session id")
});

const snapshotBodySchema = z.object({
  code: z.string(),
  language: z.string().min(1)
});

export const sessionController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const session = await sessionService.create({
        mentorId: req.user.id,
        title: parsed.data.title,
        language: parsed.data.language
      });

      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  },

  join: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = joinSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const session = await sessionService.join({
        studentId: req.user.id,
        joinCode: parsed.data.join_code
      });

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = sessionIdSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const session = await sessionService.getById({
        sessionId: parsed.data.id,
        requesterId: req.user.id
      });

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  },

  end: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = sessionIdSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      await sessionService.end({
        sessionId: parsed.data.id,
        mentorId: req.user.id
      });

      res.status(200).json({ status: "ended" });
    } catch (err) {
      next(err);
    }
  },

  list: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const sessions = await sessionService.list({
        requesterId: req.user.id,
        role: req.user.role
      });

      res.status(200).json({ sessions });
    } catch (err) {
      next(err);
    }
  },

  listSnapshots: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const snapshots = await sessionService.listMySnapshots(req.user.id);
      res.status(200).json({ snapshots });
    } catch (err) {
      next(err);
    }
  },

  getLatestSnapshot: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = sessionIdSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const snapshot = await sessionService.getLatestSnapshot({
        sessionId: parsed.data.id,
        requesterId: req.user.id
      });

      res.status(200).json(snapshot);
    } catch (err) {
      next(err);
    }
  },

  saveSnapshot: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsedParams = sessionIdSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({ error: parsedParams.error.issues[0].message, status: 400 });
        return;
      }

      const parsedBody = snapshotBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: parsedBody.error.issues[0].message, status: 400 });
        return;
      }

      await sessionService.saveSnapshot({
        sessionId: parsedParams.data.id,
        requesterId: req.user.id,
        code: parsedBody.data.code,
        language: parsedBody.data.language
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },

  listMessages: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const parsed = sessionIdSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const result = await sessionService.listMessages({
        sessionId: parsed.data.id,
        requesterId: req.user.id
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
};

