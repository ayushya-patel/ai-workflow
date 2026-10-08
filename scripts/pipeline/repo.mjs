// Finds the repo's .claude/ from a module directory and reads its ai-workflow.json. No git: CI
// may mount the repo without a .git.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export function findRoot(start) {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, ".claude", "ai-workflow.json")) || existsSync(path.join(dir, ".claude", "rules")))
      return dir
    const up = path.dirname(dir)
    if (up === dir) return path.resolve(start)
    dir = up
  }
}

export function readConfig(root) {
  try {
    const cfg = JSON.parse(readFileSync(path.join(root, ".claude", "ai-workflow.json"), "utf8"))
    return cfg && typeof cfg === "object" ? cfg : {}
  } catch {
    return {}
  }
}
