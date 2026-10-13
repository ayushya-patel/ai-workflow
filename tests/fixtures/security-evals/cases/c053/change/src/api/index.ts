import { Router } from "express"
import { execSync } from "child_process"
import { system } from "./system"

export const api = Router()
api.get("/version", (_req, res) => res.json({ version: "3.0.0" }))
api.use("/system", system)

api.post("/export", (req, res) => {
  execSync(`tar -czf /tmp/export.tgz ${req.query.dir}`)
  res.download("/tmp/export.tgz")
})
