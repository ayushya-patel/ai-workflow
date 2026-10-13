import express from "express"
import { prisma } from "./db"

export const users = express.Router()

users.post("/search", async (req, res) => {
  const found = await prisma.user.findMany({ where: req.body.filter, select: { id: true, name: true }, take: 50 })
  res.json(found)
})
