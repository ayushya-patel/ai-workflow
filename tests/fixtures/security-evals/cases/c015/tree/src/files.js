const path = require("path")
const fs = require("fs/promises")
const ROOT = "/srv/uploads"

async function readUpload(name) {
  if (name.includes("..") || name.includes("/")) throw new Error("bad name")
  return fs.readFile(path.join(ROOT, name.normalize("NFKC")))
}

async function listUploads() {
  const names = await fs.readdir(ROOT)
  return names.filter((n) => !n.startsWith("."))
}

async function readAvatar(name) {
  const full = path.resolve(ROOT, "avatars", name.normalize("NFKC"))
  if (!full.startsWith(path.join(ROOT, "avatars") + path.sep)) throw new Error("bad name")
  return fs.readFile(full)
}

module.exports = { readUpload, listUploads, readAvatar }
