import { db } from "../db"

export const findById = (id: number) => db.order.findUnique({ where: { id } })
