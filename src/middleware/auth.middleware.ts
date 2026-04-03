import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";

type AuthedUser = {
  id: string;
  role: "mentor" | "student";
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized", status: 401 });
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized", status: 401 });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return res.status(401).json({ error: "Unauthorized", status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile) {
    return res.status(401).json({ error: "Unauthorized", status: 401 });
  }

  req.user = {
    id: profile.id as string,
    role: profile.role as "mentor" | "student",
    email: profile.email as string
  };

  next();
};

