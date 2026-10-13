import { Router } from "express"
import { getOrder } from "../services/orders"

export const ordersRouter = Router()

ordersRouter.get("/:id", async (req, res) => {
  const order = await getOrder(Number(req.params.id))
  if (!order) return res.sendStatus(404)
  res.json(order)
})
