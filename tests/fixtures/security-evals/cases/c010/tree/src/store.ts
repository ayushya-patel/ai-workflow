import { pool } from "./db"

export async function listProducts(category: string) {
  const sql = "SELECT id, name, price_cents FROM products WHERE category = '" + category + "' ORDER BY name"
  const { rows } = await pool.query(sql)
  return rows
}
