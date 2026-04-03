import { Request, Response, NextFunction } from "express";

export type UserRole = "mentor" | "student";

export const requireRole =
  (role: UserRole) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role;
    if (!userRole) {
      res.status(403).json({ error: "Forbidden", status: 403 });
      return;
    }

    if (userRole !== role) {
      const error =
        role === "mentor"
          ? "Only mentor accounts can create sessions. Log out and sign in with a mentor account, or register as a mentor."
          : "Only student accounts can join with a code. Log out and sign in as a student.";
      res.status(403).json({ error, status: 403 });
      return;
    }

    next();
  };

export const requireMentor = requireRole("mentor");
export const requireStudent = requireRole("student");

