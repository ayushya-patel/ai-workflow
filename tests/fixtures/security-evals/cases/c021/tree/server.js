const express = require("express")
const cors = require("cors")
const session = require("./session")

const app = express()
app.use(session)
app.use("/api", cors({ origin: true, credentials: true }), require("./api"))
app.use("/partner", require("./partner"))
app.listen(3000)
