import express from "express"
import { listProducts } from "./store"
import { salesReport } from "./report"

const app = express()
app.get("/products", async (req, res) => res.json(await listProducts(String(req.query.category))))
app.get("/reports/sales", async (req, res) => res.json(await salesReport(String(req.query.region), String(req.query.sort))))
app.listen(3000)
