#!/usr/bin/env node
// Article I guard — no new application code without an approved spec.
// Opt-in: does nothing unless .claude/ai-workflow.json has "code": [globs] (the repo's
// application code, e.g. ["src/**"]). Specs are read from "specs" (default docs/specs).
//
// CI (ci/check-process.sh) catches a missing spec when the PR opens, which is 400 lines
// and forty minutes too late. This catches the first new file instead. Two events,
// because there are two ways a file appears:
//
//   PreToolUse  · Write — a file_path to inspect before anything is written. Blocks
//                         (exit 2). Nothing lands.
//   PostToolUse · Bash  — `cat > src/x.tsx`, cp, tee, python -c. The set of commands
//                         that can create a file is unbounded, so check the *result*:
//                         an untracked file under "code" is a new file however it got
//                         there. PostToolUse cannot block, so exit 2 warns — the file
//                         lands and the next turn is told to remove it.
//
// Editing an existing file always passes: it already came through the process, and a
// hook that blocks UI fixes is a hook the team deletes.
//
// Escape hatch: .claude/skip-process (gitignored; announced at session start).
// Exit: 0 allow · 2 block (Write) or warn to Claude (Bash). Bad input → allow.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { list, matches, projectRoot, readConfig, readInput } from "./lib.mjs"

const input = await readInput()
const root = projectRoot(input)
const cfg = readConfig(root)
const code = list(cfg.code)
if (code.length === 0) process.exit(0)
const specs = (typeof cfg.specs === "string" ? cfg.specs : "docs/specs").replace(/\/+$/, "")
const isCode = (rel) => code.some((g) => matches(g, rel))
const OPEN = /^- \*\*Status:\*\* (Approved|In progress)/m

const git = (args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

// Is any spec Approved or In progress? The marker is the cheap check and the documented
// escape, so it answers before the tree walk.
function authorised() {
  if (existsSync(path.join(root, ".claude/skip-process"))) return true
  let files = []
  try {
    files = readdirSync(path.join(root, specs), { recursive: true })
      .map(String)
      .filter((f) => path.basename(f) === "spec.md")
  } catch {
    return false
  }
  for (const f of files) {
    try {
      if (OPEN.test(readFileSync(path.join(root, specs, f), "utf8"))) return true
    } catch {}
  }
  // A module whose Status was just flipped to Shipped (uncommitted) still authorises the
  // files it created while In progress, so check the last committed status too.
  for (const f of files) {
    const rel = path.posix.join(specs, f.split(path.sep).join("/"))
    try {
      if (OPEN.test(git(["show", `HEAD:${rel}`]))) return true
    } catch {}
  }
  return false
}

const howTo = `  Run /ai-workflow:spec to start the module. Editing existing files is never blocked.

  Genuinely exempt (Path C — scaffolding, config, a one-file fix)? Record why:
      echo "why this needs no spec" > .claude/skip-process
  It is gitignored and announced at every session start until removed.`

if (input.hook_event_name === "PostToolUse") {
  // Scope git status to each glob's literal leading directory ("src/**" → src); a glob
  // with no directory part means the whole tree. -uall lists files, not `?? src/x/`.
  const scopes = code.map((g) => {
    const lit = []
    for (const seg of g.split("/").slice(0, -1)) {
      if (/[*?[]/.test(seg)) break
      lit.push(seg)
    }
    return lit.join("/") || "."
  })
  let out
  try {
    out = git(["status", "--porcelain", "-z", "--untracked-files=all", "--", ...new Set(scopes)])
  } catch {
    process.exit(0) // not a git repo: warning about nothing is worse than silence
  }
  const fresh = out
    .split("\0")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3))
    .filter(isCode)
  if (fresh.length === 0 || authorised()) process.exit(0)
  process.stderr.write(`Article I — untracked application code with no approved spec.

${fresh.map((f) => `  ${f}`).join("\n")}

No spec in ${specs}/ is at status 'Approved' or 'In progress', so nothing authorises a
new application file. A shell redirect bypasses the Write guard, so this fires after
the fact — the file exists and should not. Remove the file(s) above.

${howTo}
`)
  process.exit(2)
}

// PreToolUse · Write
const file = input.tool_input?.file_path
if (!file) process.exit(0)
const abs = path.resolve(root, file)
const rel = path.relative(root, abs).split(path.sep).join("/")
if (rel.startsWith("..") || path.isAbsolute(rel)) process.exit(0) // not ours to police
if (!isCode(rel)) process.exit(0)
if (existsSync(abs)) process.exit(0) // an edit, always fine
if (authorised()) process.exit(0)

process.stderr.write(`Article I — new application code with no approved spec.

  Blocked: ${rel}

No spec in ${specs}/ is at status 'Approved' or 'In progress', so nothing authorises a
new application file (ai-workflow.json "code").

${howTo}
`)
process.exit(2)
