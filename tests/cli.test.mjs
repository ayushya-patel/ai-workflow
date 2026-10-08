import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const bin = (n) => path.resolve(import.meta.dirname, "../scripts/pipeline", n)
const run = (script, ...args) => spawnSync(process.execPath, [bin(script), ...args], { encoding: "utf8" })
const moduleA = path.resolve(import.meta.dirname, "fixtures/module-a")
const template = path.resolve(import.meta.dirname, "../templates/specs/_template")

test("waves: prints one line per wave", () => {
  const r = run("cli-waves.mjs", moduleA)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.split("\n").filter(Boolean).length, 7)
  assert.match(r.stdout, /^W1: T2 T3 T4\nW2: T5\nW3: T6 T7\n/)
})

test("waves: --cap and --json", () => {
  assert.match(run("cli-waves.mjs", moduleA, "--cap", "1").stdout, /^W1: T2\nW2: T3\n/)
  const j = JSON.parse(run("cli-waves.mjs", moduleA, "--json", "--e2e", "pnpm e2e").stdout)
  assert.deepEqual(j.waves[0], ["T2", "T3", "T4"])
  assert.deepEqual(j.e2e, ["T4"])
})

test("waves: --e2e tags browser tasks, and so does ai-workflow.json e2e found from the module", () => {
  assert.match(run("cli-waves.mjs", moduleA, "--e2e", "pnpm e2e --full").stdout, /W1: T2 T3 T4 \[e2e\]/)
  assert.doesNotMatch(run("cli-waves.mjs", moduleA).stdout, /\[e2e\]/)
  const root = mkdtempSync(path.join(os.tmpdir(), "waves-"))
  mkdirSync(path.join(root, ".claude"))
  mkdirSync(path.join(root, "docs/specs/001"), { recursive: true })
  writeFileSync(path.join(root, ".claude/ai-workflow.json"), '{"e2e":"pnpm e2e"}')
  writeFileSync(
    path.join(root, "docs/specs/001/tasks.md"),
    '- [ ] **T1 —** x\n  - Files: `a`\n  - Accept: `pnpm e2e -g "x"`\n',
  )
  assert.equal(run("cli-waves.mjs", path.join(root, "docs/specs/001")).stdout.trim(), "W1: T1 [e2e]")
})

test("waves: cycle and unknown dependency exit 1 naming the ids; usage exits 2", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "waves-"))
  const task = (id, dep) => `- [ ] **${id} —** x\n  - Files: \`${id}.mjs\`\n  - Accept: \`true\`\n  - Depends on: ${dep}\n`
  writeFileSync(path.join(dir, "tasks.md"), task("T1", "T2") + task("T2", "T1"))
  let r = run("cli-waves.mjs", dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /cycle: T1, T2/)
  writeFileSync(path.join(dir, "tasks.md"), task("T1", "T8"))
  r = run("cli-waves.mjs", dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown dependency: T8/)
  assert.equal(run("cli-waves.mjs").status, 2)
  assert.equal(run("cli-waves.mjs", dir, "--cap", "0").status, 2)
  assert.equal(run("cli-waves.mjs", path.join(dir, "nope")).status, 1)
})

test("brief: prints the task's context; unknown id exits 1; usage exits 2", () => {
  const r = run("cli-brief.mjs", moduleA, "T6")
  assert.equal(r.status, 0)
  assert.match(r.stdout, /# Brief — module-a T6/)
  assert.ok(r.stdout.split("\n").length <= 150)
  const bad = run("cli-brief.mjs", moduleA, "T99")
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /unknown task id: T99/)
  assert.equal(run("cli-brief.mjs", moduleA).status, 2)
  assert.match(run("cli-brief.mjs", moduleA, "t9a").stdout, /T9a/)
})

test("brief: with no conventions block, lists .claude/rules whose paths match", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "brief-"))
  mkdirSync(path.join(root, ".claude/rules"), { recursive: true })
  mkdirSync(path.join(root, "specs/001"), { recursive: true })
  writeFileSync(path.join(root, ".claude/rules/style.md"), '---\npaths: ["src/**"]\n---\nbody')
  writeFileSync(path.join(root, ".claude/rules/docs.md"), '---\npaths: ["docs/**"]\n---\nbody')
  writeFileSync(
    path.join(root, "specs/001/tasks.md"),
    "- [ ] **T1 —** x\n  - Files: `src/a.ts`\n  - Accept: `true`\n",
  )
  const out = run("cli-brief.mjs", path.join(root, "specs/001"), "T1").stdout
  assert.match(out, /- style\.md/)
  assert.doesNotMatch(out, /docs\.md/)
})

test("the plugin's own template: waves and a brief that carry the Accept line", () => {
  assert.equal(run("cli-waves.mjs", template).stdout, "W1: T1\nW2: T2\n")
  const b = run("cli-brief.mjs", template, "T2").stdout
  assert.match(b, /Accept:/)
  assert.match(b, /Out of scope/)
  assert.ok(b.split("\n").length <= 150)
})
