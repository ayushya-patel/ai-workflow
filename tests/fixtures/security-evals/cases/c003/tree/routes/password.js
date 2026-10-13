const router = require("express").Router()
const { User } = require("../models")
const mailer = require("../mailer")
const tokens = require("../tokens")

router.post("/forgot", async (req, res) => {
  const user = await User.findOne({ where: { email: req.body.email } })
  if (user) {
    const token = await tokens.issueReset(user.id)
    await mailer.send({ to: req.body.email, template: "reset", token })
  }
  res.json({ ok: true })
})

module.exports = router
