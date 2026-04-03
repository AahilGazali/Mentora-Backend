import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authService } from "./auth.service";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  role: z.enum(["mentor", "student"])
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authController = {
  register: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const user = await authService.register(parsed.data);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message, status: 400 });
        return;
      }

      const result = await authService.login(parsed.data);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  me: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized", status: 401 });
        return;
      }

      const profile = await authService.me(req.user.id);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  }
};

