const session = require("express-session")
module.exports = session({ secret: process.env.SESSION_SECRET, cookie: { httpOnly: true, secure: true, sameSite: "none" } })
