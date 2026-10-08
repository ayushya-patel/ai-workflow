import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { MAX_LINES, buildBrief, rulePaths } from "../scripts/pipeline/brief.mjs"

const moduleDir = new URL("./fixtures/module-a", import.meta.url).pathname
const rules = [
  { name: "testing.md", paths: ["**/*.test.mjs", "tests/**"] },
  { name: "src.md", paths: ["src/**"] },
  { name: "unscoped.md", paths: [] },
]
const brief = (taskId, extra = {}) => buildBrief({ moduleDir, taskId, listRules: () => rules, ...extra })

test("the brief carries the conventions, the whole task block with its Accept, and out of scope", () => {
  const b = brief("T6")
  assert.match(b, /^# Brief — module-a T6/)
  assert.match(b, /\*\*Conventions every task follows\*\*/)
  assert.match(b, /  - Accept: `node --test tests\/a2.test.mjs`/)
  assert.match(b, /## Out of scope\n- Nothing about the moon\./)
  assert.match(b, /## Outcomes\n- \[ \] Outcome one/)
  assert.ok(!b.includes("must not reach the brief"))
  assert.match(b, /the full spec stays authoritative/)
})

test("dependencies are marked done or pending", () => {
  assert.match(brief("T6"), /Dependencies: T1 \(done\), T2 \(pending\)/)
  assert.match(brief("T2"), /Dependencies: none/)
})

test("only the plan rows matching the task's Files are included", () => {
  const b = brief("T2")
  assert.match(b, /\| `src\/a\.mjs` \| new \|/)
  assert.ok(!b.includes("lib/x.mjs"))
  assert.match(brief("T3"), /`src\/b\.mjs`, `src\/c\.mjs`/)
  assert.match(brief("T9"), /\(no rows match this task's Files\)/)
})

test("contracts/requires.md only when the task mentions contracts/", () => {
  assert.ok(!brief("T2").includes("price-engine"))
  const md = readFileSync(path.join(moduleDir, "tasks.md"), "utf8").replace(
    "Files: `src/a.mjs`\n  - Accept: `node --test tests/a.test.mjs`",
    "Files: `src/a.mjs`\n  - What: read contracts/requires.md\n  - Accept: `node --test tests/a.test.mjs`",
  )
  const readFile = (p) => (p.endsWith("tasks.md") ? md : readFileSync(p, "utf8"))
  assert.match(buildBrief({ moduleDir, taskId: "T2", readFile }), /price-engine/)
})

test("no conventions block: lists the rules whose paths match the task's Files", () => {
  const readFile = (p) => {
    const s = readFileSync(p, "utf8")
    return p.endsWith("tasks.md") ? s.replace(/\*\*Conventions every task follows\*\*[^\n]*\n[^\n]*\n/, "") : s
  }
  const b = buildBrief({ moduleDir, taskId: "T2", readFile, listRules: () => rules })
  assert.match(b, /No conventions block in tasks\.md/)
  assert.match(b, /- src\.md/)
  assert.ok(!b.includes("- testing.md") && !b.includes("unscoped"))
  const none = buildBrief({ moduleDir, taskId: "T9", readFile, listRules: () => rules })
  assert.match(none, /- \(none\)/)
})

test("a missing spec says so; a task missing Accept is flagged", () => {
  const dir = "/virtual/mod"
  const files = {
    "/virtual/mod/tasks.md": "- [ ] **T1 —** x\n  - Files: `a.mjs`\n",
  }
  const b = buildBrief({ moduleDir: dir, taskId: "T1", readFile: (p) => files[p] ?? null })
  assert.match(b, /MISSING Accept/)
  assert.match(b, /\(no Outcomes section\)/)
  assert.match(b, /\(no Out of scope section\)/)
  assert.match(b, /\(no Touched surface section in plan\.md\)/)
})

test("unknown task id throws, naming it", () => {
  assert.throws(() => brief("T99"), /unknown task id: T99/)
})

test("over the cap the spec slices are trimmed, never the task block or Out of scope", () => {
  const big = Array.from({ length: 400 }, (_, i) => `- [ ] outcome line ${i}`).join("\n")
  const spec = `## Outcomes\n\n${big}\n\n## Out of scope\n\n- Nothing about the moon.\n`
  const readFile = (p) => (p.endsWith("spec.md") ? spec : readFileSync(p, "utf8"))
  const b = buildBrief({ moduleDir, taskId: "T6", readFile, listRules: () => rules })
  const n = b.split("\n").length
  assert.ok(n <= MAX_LINES, `${n} lines`)
  assert.match(b, /… truncated; see spec\.md/)
  assert.match(b, /Accept: `node --test tests\/a2\.test\.mjs`/)
  assert.match(b, /Nothing about the moon/)
})

test("a typical brief is about a hundred lines or fewer", () => {
  assert.ok(brief("T6").split("\n").length <= 100)
})

test("rule paths: inline list, scalar, and dash list", () => {
  assert.deepEqual(rulePaths('---\npaths: ["a/**", \'b\']\n---\nx'), ["a/**", "b"])
  assert.deepEqual(rulePaths("---\npaths: a/**\n---\n"), ["a/**"])
  assert.deepEqual(rulePaths('---\npaths:\n  - "a"\n  - b\nother: 1\n---\n'), ["a", "b"])
  assert.deepEqual(rulePaths("# no frontmatter"), [])
})
