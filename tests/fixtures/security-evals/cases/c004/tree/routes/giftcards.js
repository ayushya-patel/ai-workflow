const router = require("express").Router()
const { pool } = require("../db")

router.post("/claim", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE gift_cards SET claimed_by = $1 WHERE code = $2 AND claimed_by IS NULL RETURNING amount_cents",
    [req.user.id, String(req.body.code)],
  )
  if (rows.length !== 1) return res.status(400).json({ error: "invalid" })
  await req.user.addCredit(rows[0].amount_cents)
  res.json({ ok: true })
})

module.exports = router
