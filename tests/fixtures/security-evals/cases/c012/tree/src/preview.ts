import express from "express"

const app = express()

app.get("/api/preview", async (req, res) => {
  const target = String(req.query.url)
  const upstream = await fetch(target)
  res.type(upstream.headers.get("content-type") ?? "text/plain").send(await upstream.text())
})

app.listen(8080)
