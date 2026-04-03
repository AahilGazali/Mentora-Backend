import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireMentor, requireStudent } from "../../middleware/role.middleware";
import { sessionController } from "./session.controller";

export const sessionRouter = Router();

sessionRouter.post("/", authMiddleware, requireMentor, sessionController.create);
sessionRouter.post("/join", authMiddleware, requireStudent, sessionController.join);
sessionRouter.get("/", authMiddleware, sessionController.list);
sessionRouter.get("/snapshots", authMiddleware, sessionController.listSnapshots);
sessionRouter.get("/:id/snapshot/latest", authMiddleware, sessionController.getLatestSnapshot);
sessionRouter.post("/:id/snapshot", authMiddleware, sessionController.saveSnapshot);
sessionRouter.get("/:id/messages", authMiddleware, sessionController.listMessages);
sessionRouter.get("/:id", authMiddleware, sessionController.getById);
sessionRouter.patch("/:id/end", authMiddleware, requireMentor, sessionController.end);

