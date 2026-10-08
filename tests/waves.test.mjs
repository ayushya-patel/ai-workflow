import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parseTasks } from "../scripts/pipeline/tasks-parse.mjs"
import { computeWaves, formatWaves, overlaps } from "../scripts/pipeline/waves.mjs"

const md = readFileSync(new URL("./fixtures/module-a/tasks.md", import.meta.url), "utf8")
const tasks = parseTasks(md, { e2e: "pnpm e2e" })
const t = (id, files, dependsOn = [], done = false) => ({ id, files, dependsOn, done, browser: false })

// Worked by hand from fixtures/module-a/tasks.md (T1 is done):
//   level 1  T2 T3 T4 T5  -> cap 3 splits it: W1 T2 T3 T4, W2 T5
//   level 2  T6 (a.mjs) T7 (lib/) T8 (lib/x.mjs) -> T8 overlaps T7: W3 T6 T7, W4 T8
//   level 3  T9 (no files) and T9a, both after T6 -> T9 runs alone: W5 T9, W6 T9a
//   level 4  T10 after T9a: W7
test("waves match the hand-computed answer", () => {
  assert.deepEqual(computeWaves(tasks).waves, [
    ["T2", "T3", "T4"],
    ["T5"],
    ["T6", "T7"],
    ["T8"],
    ["T9"],
    ["T9a"],
    ["T10"],
  ])
})

test("output format tags browser tasks", () => {
  const out = formatWaves(computeWaves(tasks).waves, tasks).split("\n")
  assert.equal(out[0], "W1: T2 T3 T4 [e2e]")
  assert.equal(out[6], "W7: T10")
})

test("a done task is satisfied and never scheduled", () => {
  const flat = computeWaves(tasks).waves.flat()
  assert.ok(!flat.includes("T1"))
  assert.ok(flat.includes("T6"))
})

test("cap of 3 by default, and --cap is honoured", () => {
  const four = [t("T1", ["a"]), t("T2", ["b"]), t("T3", ["c"]), t("T4", ["d"])]
  assert.deepEqual(computeWaves(four).waves, [["T1", "T2", "T3"], ["T4"]])
  assert.deepEqual(computeWaves(four, { cap: 2 }).waves, [["T1", "T2"], ["T3", "T4"]])
  assert.deepEqual(computeWaves(four, { cap: 4 }).waves, [["T1", "T2", "T3", "T4"]])
})

test("tasks that share a file never share a wave, dependency or not", () => {
  const r = computeWaves([t("T1", ["a.mjs"]), t("T2", ["a.mjs"]), t("T3", ["b.mjs"])])
  assert.deepEqual(r.waves, [["T1", "T3"], ["T2"]])
})

test("a directory overlaps the files under it, at segment boundaries only", () => {
  assert.ok(overlaps(t("A", ["lib/"]), t("B", ["lib/x.mjs"])))
  assert.ok(overlaps(t("A", ["lib"]), t("B", ["lib/x.mjs"])))
  assert.ok(!overlaps(t("A", ["lib"]), t("B", ["library/x.mjs"])))
  assert.ok(overlaps(t("A", ["src/**/*.ts"]), t("B", ["src/a/b.ts"])))
  assert.ok(!overlaps(t("A", ["src/**/*.ts"]), t("B", ["docs/a.md"])))
})

test("a task naming no files runs alone", () => {
  const r = computeWaves([t("T1", ["a"]), t("T2", []), t("T3", ["c"])])
  assert.deepEqual(r.waves, [["T1", "T3"], ["T2"]])
  assert.deepEqual(computeWaves([t("T1", []), t("T2", ["b"])]).waves, [["T1"], ["T2"]])
})

test("a dependent task waits for its dependency's wave", () => {
  const r = computeWaves([t("T1", ["a"]), t("T2", ["b"], ["T1"])])
  assert.deepEqual(r.waves, [["T1"], ["T2"]])
})

test("lettered ids sort and depend like any other", () => {
  const r = computeWaves([t("T10", ["x"], ["T9a"]), t("T9a", ["y"], ["T9"]), t("T9", ["z"])])
  assert.deepEqual(r.waves, [["T9"], ["T9a"], ["T10"]])
})

test("unknown dependency is an error naming the id", () => {
  const r = computeWaves([t("T1", ["a"], ["T7", "T9a"])])
  assert.deepEqual(r.error.ids, ["T7", "T9a"])
  assert.match(r.error.message, /unknown dependency: T7, T9a/)
})

test("a cycle is an error naming its members, not what waits on it", () => {
  const r = computeWaves([
    t("T1", ["a"]),
    t("T2", ["b"], ["T3", "T1"]),
    t("T3", ["c"], ["T2"]),
    t("T4", ["d"], ["T3"]),
  ])
  assert.deepEqual(r.error.ids, ["T2", "T3"])
  assert.match(r.error.message, /cycle: T2, T3/)
})

test("a task depending on itself is a cycle", () => {
  assert.deepEqual(computeWaves([t("T1", ["a"], ["T1"])]).error.ids, ["T1"])
})

test("duplicate ids are an error", () => {
  assert.deepEqual(computeWaves([t("T1", ["a"]), t("T1", ["b"])]).error.ids, ["T1"])
})

test("same input, same output", () => {
  assert.deepEqual(computeWaves(tasks), computeWaves(parseTasks(md, { e2e: "pnpm e2e" })))
})
