import express from "express"
import { search } from "./search"

const app = express()
app.get("/search", async (req, res) => res.json(await search(String(req.query.q ?? ""))))
app.listen(3000)
