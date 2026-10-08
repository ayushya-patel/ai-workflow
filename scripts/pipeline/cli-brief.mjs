#!/usr/bin/env node
// node cli-brief.mjs <module-dir> <task-id>   — print one task's context.
// Exit 0 ok, 1 unknown task or unreadable module, 2 usage.
import path from "node:path"
import { buildBrief, listRulesFrom } from "./brief.mjs"
import { findRoot } from "./repo.mjs"

const [moduleDir, rawId, ...extra] = process.argv.slice(2)
if (!moduleDir || !rawId || extra.length) {
  console.error("usage: cli-brief.mjs <module-dir> <task-id>")
  process.exit(2)
}
try {
  const rulesDir = path.join(findRoot(moduleDir), ".claude", "rules")
  console.log(
    buildBrief({
      moduleDir,
      taskId: rawId.replace(/^t/, "T"),
      listRules: () => listRulesFrom(rulesDir),
    }),
  )
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
