#!/usr/bin/env node
// SessionStart: prints the engineering-discipline law, then what is pending.
// Whatever it prints is prepended to every session in the repo.
//
//   · law/engineering-discipline.md, so it applies outside /ai-workflow:task too
//   · pending entries in .claude/learnings.md (the learning loop's inbox)
//   · a leftover .claude/pending-retrospect.md (legacy log) to move into it
//   · .claude/skip-process, the spec gate's override, while it exists
//   · open specs (Approved / In progress), only where the spec gate is on ("code" set)
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { list, projectRoot, readConfig, readInput } from "./lib.mjs"

const root = projectRoot(await readInput())
const cfg = readConfig(root)
const read = (rel) => {
  try {
    return readFileSync(path.join(root, rel), "utf8")
  } catch {
    return ""
  }
}
const out = []
try {
  out.push(readFileSync(new URL("../law/engineering-discipline.md", import.meta.url), "utf8").trim())
} catch {}

// Pending learnings: each entry is a "### <date> — <lesson>" heading followed by a
// "- **Status:** pending" line. Fenced blocks (the format example) don't count.
let fenced = false
let heading = ""
const pending = []
for (const line of read(".claude/learnings.md").split("\n")) {
  if (line.startsWith("```")) fenced = !fenced
  else if (fenced) continue
  else if (line.startsWith("### ")) heading = line.slice(4)
  else if (/^- \*\*Status:\*\* pending\b/.test(line)) pending.push(heading)
}
if (pending.length) {
  out.push(
    `${pending.length} pending learning(s) in .claude/learnings.md. Offer to run /ai-workflow:self-improve before new work:`,
    ...pending.slice(0, 5).map((h) => `    ${h}`),
  )
}

if (read(".claude/pending-retrospect.md").trim()) {
  out.push(
    "Leftover .claude/pending-retrospect.md (replaced by .claude/learnings.md in an earlier version of this plugin): move its notes into learnings.md as pending entries, then delete it.",
  )
}

const skip = read(".claude/skip-process")
if (existsSync(path.join(root, ".claude/skip-process"))) {
  out.push(
    `Spec gate OVERRIDDEN by .claude/skip-process: ${skip.split("\n")[0] || "(no reason given)"}`,
    "    Delete it when the exempt change lands.",
  )
}

if (list(cfg.code).length) {
  const specs = (typeof cfg.specs === "string" ? cfg.specs : "docs/specs").replace(/\/+$/, "")
  let files = []
  try {
    files = readdirSync(path.join(root, specs), { recursive: true }).map(String)
  } catch {}
  const open = files
    .filter((f) => path.basename(f) === "spec.md")
    .filter((f) => /^- \*\*Status:\*\* (Approved|In progress)/m.test(read(path.join(specs, f))))
    .map((f) => path.dirname(f).split(path.sep).join("/"))
    .sort()
  if (open.length) out.push(`Open specs (Approved / In progress): ${open.join(", ")}`)
}

if (out.length) process.stdout.write(`${out.join("\n")}\n`)
