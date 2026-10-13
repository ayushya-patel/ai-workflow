import express from "express"
import { requireUser } from "./auth"
import { ordersRouter } from "./routes/orders"

const app = express()
app.use(express.json())
app.use(requireUser)
app.use("/api/orders", ordersRouter)
app.listen(3000)
