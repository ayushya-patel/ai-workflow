#!/usr/bin/env node
// node cli-waves.mjs <module-dir> [--cap N] [--json] [--e2e "<command>"]
// Prints the parallel waves of the pending tasks. --e2e defaults to ai-workflow.json "e2e";
// with neither, no task is tagged [e2e]. Exit 0 ok, 1 unknown dependency or cycle, 2 usage.
import { readFileSync } from "node:fs"
import path from "node:path"
import { findRoot, readConfig } from "./repo.mjs"
import { parseTasks } from "./tasks-parse.mjs"
import { computeWaves, formatWaves } from "./waves.mjs"

const usage = (msg) => {
  if (msg) console.error(msg)
  console.error('usage: cli-waves.mjs <module-dir> [--cap N] [--json] [--e2e "<command>"]')
  process.exit(2)
}

const args = process.argv.slice(2)
let moduleDir
let cap = 3
let json = false
let e2e
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--json") json = true
  else if (a === "--cap") {
    cap = Number(args[++i])
    if (!Number.isInteger(cap) || cap < 1) usage("--cap needs a positive integer")
  } else if (a === "--e2e") {
    e2e = args[++i]
    if (!e2e) usage("--e2e needs a command")
  } else if (a.startsWith("-") || moduleDir) usage(`unexpected argument: ${a}`)
  else moduleDir = a
}
if (!moduleDir) usage()

let markdown
try {
  markdown = readFileSync(path.join(moduleDir, "tasks.md"), "utf8")
} catch {
  console.error(`cannot read ${path.join(moduleDir, "tasks.md")}`)
  process.exit(1)
}
e2e ??= readConfig(findRoot(moduleDir)).e2e
const tasks = parseTasks(markdown, { e2e: typeof e2e === "string" ? e2e : undefined })
const result = computeWaves(tasks, { cap })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (json) {
  console.log(JSON.stringify({ waves: result.waves, e2e: tasks.filter((t) => t.browser && !t.done).map((t) => t.id) }))
} else console.log(result.waves.length ? formatWaves(result.waves, tasks) : "No pending tasks.")
