import express from "express"
import { requireUser } from "./auth"
import { ownsOrder } from "./middleware/owns"
import { ordersRouter } from "./routes/orders"

const app = express()
app.use(express.json())
app.use(requireUser)
ordersRouter.param("id", ownsOrder)
app.use("/api/orders", ordersRouter)
app.listen(3000)
