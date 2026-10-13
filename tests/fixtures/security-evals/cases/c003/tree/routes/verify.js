const router = require("express").Router()
const { User } = require("../models")
const mailer = require("../mailer")
const tokens = require("../tokens")

router.post("/resend", async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email : ""
  const user = await User.findOne({ where: { email } })
  if (user) {
    const token = await tokens.issueVerify(user.id)
    await mailer.send({ to: user.email, template: "verify", token })
  }
  res.json({ ok: true })
})

module.exports = router
