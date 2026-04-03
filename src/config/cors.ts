import cors, { type CorsOptions } from "cors";
import { env } from "./env";

const devLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const allowOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    cb(null, true);
    return;
  }
  if (origin === env.CLIENT_URL) {
    cb(null, true);
    return;
  }
  if (env.NODE_ENV === "development" && devLocalhost.test(origin)) {
    cb(null, true);
    return;
  }
  cb(null, false);
};

export const corsMiddleware = cors({
  origin: allowOrigin,
  credentials: true
} as CorsOptions);

export const socketCorsConfig: CorsOptions = {
  origin: allowOrigin,
  credentials: true,
  methods: ["GET", "POST"]
};

