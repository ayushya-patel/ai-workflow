// Shared by the ai-workflow hooks: read the hook input, find the project root, read
// .claude/ai-workflow.json, match its globs. Nothing here throws; a bad input or config
// reads as empty, so a hook never takes the session down.
import { readFileSync } from "node:fs"
import path from "node:path"

export async function readInput() {
  try {
    return JSON.parse(
      await new Promise((r) => {
        let s = ""
        process.stdin.on("data", (d) => (s += d)).on("end", () => r(s || "{}"))
      }),
    )
  } catch {
    return {}
  }
}

export const projectRoot = (input) => process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

export function readConfig(root) {
  try {
    const cfg = JSON.parse(readFileSync(path.join(root, ".claude/ai-workflow.json"), "utf8"))
    return cfg && typeof cfg === "object" ? cfg : {}
  } catch {
    return {}
  }
}

export const list = (v) => (Array.isArray(v) ? v.filter((g) => typeof g === "string") : [])

// Minimal glob: ** any depth, * one segment, ? one char. A pattern with no "/" matches
// the basename anywhere (like .gitignore).
export function matches(glob, p) {
  const target = glob.includes("/") ? p : path.posix.basename(p)
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*|\?/g, (t) =>
      t === "**/" ? "(?:.*/)?" : t === "**" ? ".*" : t === "*" ? "[^/]*" : "[^/]",
    )
  return new RegExp(`^${re}$`).test(target)
}
