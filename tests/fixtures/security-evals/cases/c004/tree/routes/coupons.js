const router = require("express").Router()
const { Coupon } = require("../models")

router.post("/redeem", async (req, res) => {
  const coupon = await Coupon.findOne({ where: { code: String(req.body.code) } })
  if (!coupon || coupon.used) return res.status(400).json({ error: "invalid" })
  await req.user.addCredit(coupon.amountCents)
  coupon.used = true
  await coupon.save()
  res.json({ ok: true })
})

module.exports = router
