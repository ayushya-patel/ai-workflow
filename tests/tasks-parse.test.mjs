import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { compareIds, conventionsBlock, invokesBrowser, parseTasks, section } from "../scripts/pipeline/tasks-parse.mjs"

const shapes = readFileSync(new URL("./fixtures/tasks-shapes.md", import.meta.url), "utf8")
const tasks = parseTasks(shapes, { e2e: "pnpm e2e" })
const by = (id) => tasks.find((t) => t.id === id)

test("parses ids, done state and titles; the Deferred item is not a task", () => {
  assert.deepEqual(tasks.map((t) => t.id), ["T1", "T2", "T3", "T3a", "T4", "T5"])
  assert.equal(by("T2").done, true)
  assert.equal(by("T1").done, false)
  assert.equal(by("T3a").title, "A lettered follow-up")
})

test("Files: single line, wrapped, none, and only paths before a parenthetical", () => {
  assert.deepEqual(by("T1").files, ["scripts/a.mjs", "scripts/a.test.mjs"])
  assert.deepEqual(by("T2").files, ["scripts/b.mjs", "scripts/b.test.mjs"])
  assert.deepEqual(by("T3").files, [])
  assert.deepEqual(by("T3a").files, ["vite.config.ts"])
  assert.deepEqual(by("T5").files, ["app/(auth)/login.tsx"])
})

test("wrapped What continues on the more-indented line", () => {
  assert.equal(by("T1").what, "do the thing and keep going on a wrapped line")
})

test("Depends on yields ids and ignores prose", () => {
  assert.deepEqual(by("T2").dependsOn, ["T1"])
  assert.deepEqual(by("T3a").dependsOn, ["T1", "T3", "T2"])
  assert.deepEqual(by("T3").dependsOn, [])
})

test("a missing Accept is flagged, not thrown", () => {
  assert.deepEqual(by("T4").missing, ["Accept"])
  assert.equal(by("T4").accept, "")
  assert.deepEqual(by("T1").missing, [])
})

test("block keeps the task's own lines verbatim", () => {
  assert.ok(by("T1").block.startsWith("- [ ] **T1 —** Single-line files\n  - Files:"))
  assert.ok(!by("T1").block.includes("T2"))
})

test("browser: Accept invoking the repo's e2e command counts, a grep naming it does not", () => {
  assert.equal(by("T5").browser, true)
  assert.equal(by("T1").browser, false)
  assert.equal(invokesBrowser("`CI=1 pnpm e2e -g \"x\" && echo ok`", "pnpm e2e"), true)
  assert.equal(invokesBrowser("`grep -q 'pnpm e2e --full' a.md`", "pnpm e2e"), false)
  assert.equal(invokesBrowser("`pnpm e2e -g x`", "pnpm e2e --full"), true)
  assert.equal(invokesBrowser("`pnpm e2e -g x`", undefined), false)
})

test("without an e2e command no task is a browser task", () => {
  assert.ok(parseTasks(shapes).every((t) => !t.browser))
})

test("compareIds orders T9 < T9a < T10", () => {
  assert.deepEqual(["T10", "T9a", "T9", "T2"].sort(compareIds), ["T2", "T9", "T9a", "T10"])
})

test("conventionsBlock is the paragraph, or null", () => {
  const md = "x\n\n**Conventions every task follows** (a).\nmore\n\nnext paragraph\n"
  assert.equal(conventionsBlock(md), "**Conventions every task follows** (a).\nmore")
  assert.equal(conventionsBlock(shapes), null)
})

test("section returns the body without the heading, or null", () => {
  const md = "## A\n\nbody\nmore\n\n## B\nother\n"
  assert.deepEqual(section(md, "A"), ["body", "more"])
  assert.equal(section(md, "C"), null)
})
