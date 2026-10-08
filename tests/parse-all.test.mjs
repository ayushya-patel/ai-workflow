// Every tasks.md in this repo parses, and the parser finds as many tasks as there are task lines,
// so a mis-parse can go red. The plugin's own template is the format the scripts promise to read.
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { parseTasks } from "../scripts/pipeline/tasks-parse.mjs"

const root = path.resolve(import.meta.dirname, "..")
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? (f === ".git" ? [] : walk(p)) : f === "tasks.md" ? [p] : []
  })

test("every tasks.md parses to as many tasks as it has task lines", () => {
  const files = [...walk(path.join(root, "templates")), ...walk(path.join(root, "tests"))]
  assert.ok(files.some((f) => f.endsWith(path.join("_template", "tasks.md"))))
  for (const f of files) {
    const md = readFileSync(f, "utf8")
    const above = md.split(/^## Deferred/m)[0]
    const lines = above.split("\n").filter((l) => /^- \[[ x]\] \*\*T\d+[a-z]? —\*\*/.test(l)).length
    assert.equal(parseTasks(md).length, lines, path.relative(root, f))
  }
})

test("the plugin template yields T1 and T2 with Files, Accept and the T1 dependency", () => {
  const tasks = parseTasks(readFileSync(path.join(root, "templates/specs/_template/tasks.md"), "utf8"))
  assert.deepEqual(tasks.map((t) => t.id), ["T1", "T2"])
  assert.deepEqual(tasks[1].dependsOn, ["T1"])
  assert.ok(tasks.every((t) => t.files.length === 1 && t.accept && t.missing.length === 0))
})
