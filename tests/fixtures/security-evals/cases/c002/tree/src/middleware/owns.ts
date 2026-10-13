import type { NextFunction, Request, Response } from "express"
import { db } from "../db"

export async function ownsOrder(req: Request, res: Response, next: NextFunction, id: string) {
  const row = await db.order.findUnique({ where: { id: Number(id) }, select: { userId: true } })
  if (!row || row.userId !== (req as any).user.id) return res.sendStatus(404)
  next()
}
