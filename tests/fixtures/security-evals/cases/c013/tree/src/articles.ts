import express from "express"
import { z } from "zod"
import { prisma } from "./db"

export const articles = express.Router()
const Filter = z.object({ title: z.string().max(100).optional(), status: z.enum(["draft", "published"]).optional() }).strict()

articles.post("/search", async (req, res) => {
  const f = Filter.parse(req.body.filter ?? {})
  const found = await prisma.article.findMany({ where: { title: f.title ? { contains: f.title } : undefined, status: f.status }, take: 50 })
  res.json(found)
})
