#!/usr/bin/env node
// PreToolUse (Edit|Write): blocks edits to secrets, lockfiles, build output, the
// repo's "protected" globs, and already-committed files matching its "append_only"
// globs (e.g. migrations: create new ones, never edit merged ones).
// Config: $CLAUDE_PROJECT_DIR/.claude/ai-workflow.json. Missing or broken → defaults.
// Exit 2 = blocked; the message on stderr is shown to Claude.
import { execFileSync } from "node:child_process"
import path from "node:path"
import { list, matches, projectRoot, readConfig, readInput } from "./lib.mjs"

const input = await readInput()
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path
if (!file) process.exit(0)
const root = projectRoot(input)
const abs = path.resolve(root, file)
const rel = path.relative(root, abs).split(path.sep).join("/")
if (rel.startsWith("..")) process.exit(0) // outside the project

const cfg = readConfig(root)

function block(reason) {
  process.stderr.write(`Blocked by ai-workflow guard-edit (${rel}): ${reason}\n`)
  process.exit(2)
}

const base = path.posix.basename(rel)
if (/^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(base)) {
  block("lockfiles change only through the package manager (`pnpm add --filter <project> <pkg>` or `pnpm install`).")
}
if (/^\.env(\..+)?$/.test(base) && !/\.(template|example)$/.test(base)) {
  block("secrets file. Document new variables in .env.template / .env.example instead.")
}
if (/(^|\/)(node_modules|dist|coverage|\.turbo)\//.test(rel)) {
  block("build output or dependencies; it's regenerated.")
}
const hit = list(cfg.protected).find((g) => matches(g, rel))
if (hit) block(`protected by ai-workflow.json "protected" (${hit}). Ask the user if it really must change.`)

const appendOnly = list(cfg.append_only).find((g) => matches(g, rel))
if (appendOnly) {
  try {
    // Run in the file's own directory so a path inside a submodule asks that repo.
    execFileSync("git", ["-C", path.dirname(abs), "ls-files", "--error-unmatch", path.basename(abs)], {
      stdio: "ignore",
    })
    block(
      `already committed; add a new file instead (ai-workflow.json "append_only": ${appendOnly}). A merged migration may already have run.`,
    )
  } catch {} // new, uncommitted file (or not a git repo): allowed
}
process.exit(0)
