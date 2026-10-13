import { Router } from "express"

export const api = Router()
api.get("/version", (_req, res) => res.json({ version: "3.0.0" }))
