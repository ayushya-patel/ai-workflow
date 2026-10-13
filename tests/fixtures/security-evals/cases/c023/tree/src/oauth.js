const crypto = require("crypto")

function start(req, res) {
  const state = crypto.randomBytes(16).toString("hex")
  res.cookie("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", domain: ".example.com" })
  res.redirect(`https://idp.example.com/authorize?client_id=app&state=${state}&redirect_uri=https://app.example.com/callback`)
}

function callback(req, res, next) {
  if (!req.query.state || req.query.state !== req.cookies.oauth_state) return res.sendStatus(400)
  next()
}

module.exports = { start, callback }
