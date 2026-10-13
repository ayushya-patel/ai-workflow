import type { NextFunction, Request, Response } from "express"
import { sessions } from "./sessions"

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await sessions.lookup(req.cookies?.sid)
  if (!user) return res.sendStatus(401)
  ;(req as any).user = user
  next()
}
