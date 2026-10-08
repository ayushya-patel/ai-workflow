#!/usr/bin/env node
// PostToolUse (Edit|Write): formats the edited file with the repo's own formatter,
// chosen by ai-workflow.json "format": "biome" (default) | "prettier" | "none". Uses the
// project's installed binary; files it ignores are left alone. Never blocks.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { projectRoot, readConfig, readInput } from "./lib.mjs"

const input = await readInput()
const file = input.tool_input?.file_path
const root = projectRoot(input)
const cfg = readConfig(root)

const tools = {
  biome: ["biome", ["format", "--write", "--no-errors-on-unmatched"], /\.(jsx?|tsx?|mjs|cjs|jsonc?|css)$/],
  prettier: ["prettier", ["--write", "--ignore-unknown"], /\.(jsx?|tsx?|mjs|cjs|jsonc?|css|scss|md|ya?ml|html)$/],
}
const tool = tools[cfg.format ?? "biome"] // "none" or unknown → no tool
if (!file || !tool) process.exit(0)
const [name, args, exts] = tool
const bin = path.join(root, "node_modules/.bin", name)
if (!exts.test(file) || !existsSync(bin)) process.exit(0)
try {
  execFileSync(bin, [...args, file], { cwd: root, stdio: "ignore" })
} catch {}
process.exit(0)
