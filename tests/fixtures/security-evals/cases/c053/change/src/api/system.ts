import { Router } from "express"
import { execFileSync } from "child_process"

export const system = Router()
system.get("/uptime", (_req, res) => {
  res.type("text").send(execFileSync("uptime", [], { encoding: "utf8" }))
})
