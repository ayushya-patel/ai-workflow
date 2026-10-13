import { findById } from "../repo/orders"

export async function getOrder(id: number) {
  const order = await findById(id)
  return order ? { ...order, total: order.totalCents / 100 } : null
}
