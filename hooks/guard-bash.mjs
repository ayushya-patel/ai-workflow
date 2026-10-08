#!/usr/bin/env node
// PreToolUse (Bash): blocks git commands that rewrite shared history, skip the
// repo's git hooks, or push straight to main. Exit 2 = blocked; the message on
// stderr is shown to Claude. Needs no config. A malformed input is allowed through.
import { execFileSync } from "node:child_process"

let input = {}
try {
  input = JSON.parse(
    await new Promise((r) => {
      let s = ""
      process.stdin.on("data", (d) => (s += d)).on("end", () => r(s || "{}"))
    }),
  )
} catch {}
const command = input.tool_input?.command ?? ""
const cwd = input.cwd ?? process.cwd()

function block(reason) {
  process.stderr.write(`Blocked by ai-workflow guard-bash: ${reason}\n`)
  process.exit(2)
}

// Each simple command separately (split on && || ; | and newlines).
for (const part of command.split(/&&|\|\||;|\||\n/).map((p) => p.trim())) {
  if (/(^|\s)(LEFTHOOK|HUSKY)=0\b/.test(part) || /\s--no-verify\b/.test(part)) {
    block(
      "git hooks (format, commit message, submodule checks) must not be skipped. Fix what the hook reports instead.",
    )
  }
  if (!/^(\S+=\S+\s+)*git\b/.test(part)) continue

  if (/\bpush\b/.test(part) && /\s(--force|--force-with-lease|-f)\b|\s\+\S/.test(part)) {
    block("force-pushing rewrites shared history. Ask the user to do it if it's really needed.")
  }
  if (
    /\breset\s+--hard\b/.test(part) ||
    /\bclean\s+-\S*f/.test(part) ||
    /\bcheckout\s+--\s+\./.test(part)
  ) {
    block("this discards local work. Ask the user first, or use git stash.")
  }
  if (/\bpush\b/.test(part)) {
    // Direct pushes to main/master: explicit refspec, or no refspec while on main.
    if (/(\s|:)(main|master)(\s|$)/.test(part)) {
      block("don't push to main/master directly. Push a branch and open a PR (/ai-workflow:create-pr).")
    }
    const args = part
      .replace(/^.*?\bpush\b/, "")
      .trim()
      .split(/\s+/)
      .filter((a) => a && !a.startsWith("-"))
    if (args.length <= 1) {
      const dir = part.match(/\bgit\s+-C\s+(\S+)/)?.[1]
      try {
        const branch = execFileSync(
          "git",
          ["-C", dir ? new URL(dir, `file://${cwd}/`).pathname : cwd, "branch", "--show-current"],
          { encoding: "utf8" },
        ).trim()
        if (branch === "main" || branch === "master") {
          block(
            `the current branch is ${branch}. Push a feature branch and open a PR (/ai-workflow:create-pr).`,
          )
        }
      } catch {}
    }
  }
}
process.exit(0)
