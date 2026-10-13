import { pool } from "./db"

const SORT: Record<string, string> = { total: "total_cents DESC", region: "region ASC" }

export async function salesReport(region: string, sort: string) {
  const order = SORT[sort] ?? SORT.total
  const { rows } = await pool.query(`SELECT region, SUM(total_cents) AS total_cents FROM orders WHERE region = $1 GROUP BY region ORDER BY ${order}`, [region])
  return rows
}
