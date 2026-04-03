import { Request, Response, NextFunction } from "express";

type StatusError = {
  status?: number;
  message?: string;
};

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusErr = err as StatusError;
  const status = typeof statusErr.status === "number" ? statusErr.status : 500;
  const message =
    typeof statusErr.message === "string"
      ? statusErr.message
      : err instanceof Error
        ? err.message
        : "Internal Server Error";

  res.status(status).json({ error: message, status });
};

