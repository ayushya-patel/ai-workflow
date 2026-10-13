const express = require("express")
const cors = require("cors")

const router = express.Router()
router.use(cors({ origin: ["https://partner.example.com"], credentials: true }))
router.get("/orders", (req, res) => res.json(req.session.partnerOrders ?? []))

module.exports = router
