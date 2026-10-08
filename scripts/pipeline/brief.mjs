// One task's context: a slice of the module, about a hundred lines, never more than MAX_LINES.
// The full spec stays authoritative; the footer says so.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { matchesAny } from "./glob.mjs"
import { pathsOverlap } from "./waves.mjs"
import { conventionsBlock, parseTasks, section } from "./tasks-parse.mjs"

export const MAX_LINES = 150

const FOOTER =
  "This brief is a slice, not the spec; the full spec stays authoritative. If it lacks what you need, return a question and write nothing."

const read = (file) => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

// `paths:` as an inline list (`["a", "b"]`), one scalar, or a dash list.
export function rulePaths(markdown) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(markdown)
  if (!fm) return []
  const lines = fm[1].split("\n")
  const i = lines.findIndex((l) => /^paths:/.test(l))
  if (i < 0) return []
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, "")
  const inline = lines[i].slice("paths:".length).trim()
  if (inline.startsWith("[")) return inline.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean)
  if (inline) return [unquote(inline)]
  const out = []
  for (const l of lines.slice(i + 1)) {
    const m = /^\s+-\s+(.*)$/.exec(l)
    if (!m) break
    out.push(unquote(m[1]))
  }
  return out
}

export function listRulesFrom(rulesDir) {
  let names = []
  try {
    names = readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort()
  } catch {}
  return names.map((name) => ({ name, paths: rulePaths(read(path.join(rulesDir, name)) ?? "") }))
}

// Rows of a plan's `## Touched surface` table whose path column overlaps one of `files`.
function planRows(plan, files) {
  const body = plan === null ? null : section(plan, "Touched surface")
  if (body === null) return ["(no Touched surface section in plan.md)"]
  const table = body.filter((l) => l.startsWith("|"))
  const head = table.slice(0, 2)
  const rows = table.slice(2).filter((row) => {
    const cell = row.split("|")[1] ?? ""
    const paths = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    return paths.some((p) => files.some((f) => pathsOverlap(p, f)))
  })
  return rows.length ? [...head, ...rows] : ["(no rows match this task's Files)"]
}

// listRules(): [{ name, paths }]. readFile(path): string, or null when absent.
export function buildBrief({ moduleDir, taskId, readFile = read, listRules = () => [] }) {
  const tasksMd = readFile(path.join(moduleDir, "tasks.md"))
  if (tasksMd === null) throw new Error(`cannot read ${path.join(moduleDir, "tasks.md")}`)
  const tasks = parseTasks(tasksMd)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error(`unknown task id: ${taskId}`)
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const conventions = conventionsBlock(tasksMd)
  const conv = conventions
    ? conventions.split("\n")
    : [
        "No conventions block in tasks.md. Rules whose `paths:` match this task's Files:",
        ...(task.files.length
          ? listRules()
              .filter((r) => task.files.some((f) => matchesAny(r.paths, f)))
              .map((r) => `- ${r.name}`)
          : []),
      ]
  if (!conventions && conv.length === 1) conv.push("- (none)")

  const taskLines = [
    "## Task",
    ...task.block.split("\n"),
    task.dependsOn.length
      ? `Dependencies: ${task.dependsOn.map((d) => `${d} (${byId.get(d)?.done ? "done" : "pending"})`).join(", ")}`
      : "Dependencies: none",
    ...(task.missing.length ? [`MISSING ${task.missing.join("/")}`] : []),
  ]

  const spec = readFile(path.join(moduleDir, "spec.md"))
  const slice = (heading, absent) => [
    `## ${heading}`,
    ...((spec === null ? null : section(spec, heading)) ?? [absent]),
  ]
  const outcomes = slice("Outcomes", "(no Outcomes section)")
  const outOfScope = slice("Out of scope", "(no Out of scope section)")
  const rows = ["## Plan rows for this task's Files", ...planRows(readFile(path.join(moduleDir, "plan.md")), task.files)]
  const requires = /contracts\//.test(task.block) ? readFile(path.join(moduleDir, "contracts", "requires.md")) : null
  const contracts = requires === null ? [] : ["## contracts/requires.md", ...requires.split("\n")]

  const head = [`# Brief — ${path.basename(path.resolve(moduleDir))} ${task.id}`, ""]
  const render = () => {
    const out = [...head, ...conv, "", ...taskLines, ""]
    for (const s of [outcomes, outOfScope, rows, contracts]) if (s.length) out.push(...s, "")
    out.push(FOOTER)
    return out
  }
  // Over the cap: trim the spec slices, contracts first; the task block and footer stay whole.
  for (const [lines, file] of [
    [contracts, "contracts/requires.md"],
    [rows, "plan.md"],
    [outcomes, "spec.md"],
    [outOfScope, "spec.md"],
    [conv, "tasks.md"],
  ]) {
    const over = render().length - MAX_LINES
    if (over <= 0) break
    const keep = Math.max(2, lines.length - over - 1)
    if (keep < lines.length) lines.splice(keep, lines.length - keep, `… truncated; see ${file}`)
  }
  const out = render()
  return out.join("\n")
}
