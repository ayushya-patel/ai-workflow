import type { NextFunction, Request, Response } from "express"

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user?.role !== "admin") return res.sendStatus(403)
  next()
}
