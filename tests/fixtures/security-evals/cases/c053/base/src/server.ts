import express from "express"
import { requireAdmin } from "./auth"
import { api } from "./api"

const app = express()
app.use("/api", requireAdmin, api)
app.listen(3000)
