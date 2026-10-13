#!/usr/bin/env node
// PreToolUse guard for the ai-workflow:security-* agents. Registered in hooks.json (plugin
// agents ignore frontmatter hooks) and a no-op outside them, keyed on agent_type. It enforces
// skills/security-audit/law.md mechanically instead of trusting the model: read only, no
// network, no repo code, nothing outside the repo and the plugin, no secret file or secret
// value into context. Bash is an allowlist, not a denylist. Exit 2 = blocked; anything it
// can't parse is blocked.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { PLUGIN_ROOT, isSecretFile, secretLineNumbers } from "../scripts/security/audit.mjs"
import { projectRoot, readInput } from "./lib.mjs"

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
const input = await readInput()
if (!/^(ai-workflow:)?security-[a-z-]+$/.test(input.agent_type ?? "")) process.exit(0)
const cwd = real(input.cwd ?? process.cwd())
const root = real(projectRoot(input))
const plugin = real(PLUGIN_ROOT)
const AUDIT = path.join(plugin, "scripts/security/audit.mjs")
const tool = input.tool_name ?? ""
const ti = input.tool_input ?? {}

function block(msg) {
  process.stderr.write(`Blocked by ai-workflow guard-audit (security audit is read-only, offline, zero-leak): ${msg}\n`)
  process.exit(2)
}
const under = (p, base) => p === base || p.startsWith(base + path.sep)
const rel = (p) => path.relative(root, p).split(path.sep).join("/")

// A path the audit may touch: inside the repo or the plugin, never a secret file, never an
// impostor law or checklist planted in the audited repo.
// `window` limits the secret check to the lines a Read will return, so a large file with one
// label-like hit can still be read around it. PEM bodies count as secret lines.
function checkPath(p, { content = false, meta = false, window = null } = {}) {
  if (/^~/.test(p)) block(`${p}: nothing outside the repo`)
  const r = real(path.resolve(cwd, p))
  if (["/dev/null", "/dev/stdout", "/dev/stderr"].includes(r)) return r
  if (!under(r, root) && !under(r, plugin)) block(`${p} is outside the repo (${root})`)
  if (under(r, plugin)) return r
  if (/(^|\/)(skills\/security-audit\/|templates\/security-report\.md$)/.test(rel(r)))
    block(`${p} is the audited repo's copy. Load the plugin's: ${plugin}/${rel(r).replace(/^.*?(skills\/|templates\/)/, "$1")}`)
  if (!meta && isSecretFile(rel(r))) block(`${p} is a secret file: report it by path, never read it`)
  if (content && existsSync(r) && lstatSync(r).isFile() && lstatSync(r).size < 32 << 20) {
    const buf = readFileSync(r)
    if (!buf.subarray(0, 8000).includes(0)) {
      const lines = secretLineNumbers(buf.toString("utf8"))
      const hit = lines.filter((n) => !window || (n >= window[0] && n <= window[1]))
      if (hit.length)
        block(
          `${p} holds secret-format values at lines ${hit.slice(0, 10).join(",")}. Read around them (Read offset/limit that skip those lines) or masked: node ${AUDIT} show '${rel(r)}' <from> <to>`,
        )
    }
  }
  return r
}

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) block("no edits; fixes are proposed, never applied")
if (["WebFetch", "WebSearch", "Artifact"].includes(tool) || tool.startsWith("mcp__"))
  block(`${tool}: nothing leaves the machine during an audit; the report is printed here only`)
if (tool === "Read" || tool === "NotebookRead") {
  // A window only with an explicit positive limit, no allow_large, and not a notebook (rendered
  // as cells, so offsets are not raw lines). Padded a line each side for 0- vs 1-based offsets.
  const p = ti.file_path ?? ti.notebook_path ?? ""
  const from = Math.max(1, Number(ti.offset) || 1)
  const lim = Number(ti.limit)
  const windowed = tool === "Read" && lim >= 1 && ti.allow_large !== true && !/\.ipynb$/i.test(p)
  checkPath(p, { content: true, window: windowed ? [from - 1, from + lim] : null })
}
if (tool === "Glob") checkPath(ti.path ?? ".")
if (tool === "Grep") {
  checkPath(ti.path ?? ".")
  if (ti.output_mode === "content")
    block(`Grep content mode prints raw lines. Use output_mode files_with_matches or count, or the masked search: node ${AUDIT} grep '<ERE>' [-- <path>]`)
}
if (tool !== "Bash") process.exit(0)

// ---------- Bash ----------

// Split into simple commands. Anything that could run, redirect or expand is refused.
function parse(cmd) {
  const segs = [[]]
  let tok = null
  const push = () => (tok !== null && segs.at(-1).push(tok), (tok = null))
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    const rest = cmd.slice(i)
    const atStart = i === 0 || /\s/.test(cmd[i - 1])
    if (atStart && tok === null) {
      const quiet = rest.match(/^(?:[12&]?>\s*\/dev\/null|2>&1)(?=\s|$|;|\||&&)/)
      if (quiet) {
        i += quiet[0].length - 1
        continue
      }
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1)
      if (j < 0) block("unbalanced quote")
      tok = (tok ?? "") + cmd.slice(i + 1, j)
      i = j
    } else if (c === '"') {
      let j = i + 1
      let s = ""
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === "$" || cmd[j] === "`") block("no $ or backticks: single-quote patterns and paths")
        if (cmd[j] === "\\") j++
        s += cmd[j] ?? ""
      }
      if (j >= cmd.length) block("unbalanced quote")
      tok = (tok ?? "") + s
      i = j
    } else if (c === "\\") {
      tok = (tok ?? "") + (cmd[++i] ?? "")
    } else if (/\s/.test(c) && c !== "\n") {
      push()
    } else if (c === "\n" || c === ";" || c === "|" || (c === "&" && cmd[i + 1] === "&")) {
      push()
      if ((c === "|" || c === "&") && cmd[i + 1] === c) i++
      if (segs.at(-1).length) segs.push([])
    } else if ("$`<>&(){}".includes(c)) {
      block(`no ${c === "$" ? "$ expansion" : c === "`" ? "backticks" : `'${c}'`} in audit commands (only 2>/dev/null redirects)`)
    } else {
      tok = (tok ?? "") + c
    }
  }
  push()
  return segs.filter((s) => s.length)
}

const COUNT_ONLY = (args) => args.some((a) => /^-[a-zA-Z]*[clLq]/.test(a) || /^--(count|files-with(out)?-match(es)?|quiet|silent)$/.test(a))
const operands = (args) => args.filter((a) => !a.startsWith("-"))
// grep's file operands: skip option values and the pattern (unless given with -e).
function grepFiles(args) {
  const out = []
  for (let k = 0; k < args.length; k++) {
    if (/^-(e|m|A|B|C)$/.test(args[k])) k++
    else if (args[k] === "--") (out.push(...args.slice(k + 1)), (k = args.length))
    else if (!args[k].startsWith("-")) out.push(args[k])
  }
  return args.includes("-e") ? out : out.slice(1)
}

const GIT_READ = new Set(["ls-files", "log", "rev-parse", "rev-list", "show", "diff", "status", "branch", "merge-base", "submodule", "ls-tree", "describe", "shortlog", "show-ref", "for-each-ref", "name-rev", "check-ignore", "version", "lfs", "cat-file"])
const NO_PATCH = /^(--stat|--name-only|--name-status|--numstat|--shortstat|--no-patch|-s|--quiet|--exit-code|--oneline|--format=.*|--pretty=.*)$/

function checkGit(args) {
  let i = 0
  for (; i < args.length && args[i].startsWith("-"); i++) {
    if (args[i] === "-C") checkPath(args[++i])
    else if (args[i] !== "--no-pager") block(`git ${args[i]}: no global options but -C and --no-pager`)
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (!GIT_READ.has(sub)) block(`git ${sub}: read-only subcommands only (${[...GIT_READ].join(", ")})`)
  if (rest.some((a) => /^--(output|ext-diff|textconv)\b|^-p$|^--patch$|^-u$|^-U\d*$|^--patch-with-stat$/.test(a)))
    block(`git ${sub}: no patch output or writes. For the change under review use: node ${AUDIT} diff [base]`)
  if (sub === "diff" && !rest.some((a) => NO_PATCH.test(a))) block(`git diff prints file content. Use --stat/--name-only, or: node ${AUDIT} diff [base]`)
  if (sub === "show") {
    for (const a of operands(rest)) {
      if (a.includes(":") && !/^[^:]+:\.claude\/security-suppressions\.json$/.test(a))
        block(`git show <rev>:<path> prints old content unmasked; only <base>:.claude/security-suppressions.json is allowed`)
    }
    if (!operands(rest).some((a) => a.includes(":")) && !rest.some((a) => NO_PATCH.test(a))) block("git show <commit> prints a patch. Add --stat or --name-only")
  }
  if (sub === "branch" && rest.some((a, k) => !a.startsWith("-") && !/^--(contains|merged|no-merged|points-at)$/.test(rest[k - 1] ?? "")))
    block("git branch: listing only (-r, -a, --contains <sha>, --show-current)")
  if (sub === "branch" && rest.some((a) => /^-(d|D|m|M|c|C|u|f)$|^--(delete|move|copy|set-upstream-to|unset-upstream|edit-description|force)/.test(a))) block("git branch: listing only")
  if (sub === "submodule" && rest[0] !== "status") block("git submodule: status only")
  if (sub === "lfs" && rest[0] !== "ls-files") block("git lfs: ls-files only")
  if (sub === "cat-file" && !rest.some((a) => /^-[tse]$/.test(a))) block("git cat-file: -t, -s or -e only")
}

const FILTERS = new Set(["sort", "uniq", "cut", "tr", "head", "tail", "jq"]) // stdin only
const META = new Set(["wc", "ls", "test", "[", "file", "stat", "realpath", "readlink", "basename", "dirname", "echo", "printf", "true", "false", "which"])

for (const seg of parse(ti.command ?? "")) {
  const [cmd, ...args] = seg
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) block("no variable assignments")
  for (const a of args) if (a.startsWith("~") || (/^(\/|\.\.)/.test(a) && existsSync(path.resolve(cwd, a)))) checkPath(a)
  if (cmd === "git") checkGit(args)
  else if (cmd === "node") {
    if (real(path.resolve(cwd, args[0] ?? "")) !== AUDIT) block(`node runs only the audit helper: node ${AUDIT} <command>`)
  } else if (cmd === "grep" || cmd === "egrep") {
    if (args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--file")) block("grep -f: no pattern files")
    const files = grepFiles(args)
    if ((files.length || args.some((a) => /^-[a-zA-Z]*[rR]/.test(a))) && !COUNT_ONLY(args))
      block(`grep on files prints raw lines. Use -c or -l, or the masked search: node ${AUDIT} grep '<ERE>' [-- <path>]`)
    files.forEach((f) => checkPath(f))
  } else if (cmd === "find") {
    if (args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a))) block("find: no -exec, -delete or -fprint")
    operands(args).filter((a) => !/[*?[]/.test(a) && existsSync(path.resolve(cwd, a))).forEach((a) => checkPath(a))
  } else if (FILTERS.has(cmd)) {
    if (cmd === "jq" && args.some((a) => /^--?(rawfile|slurpfile|from-file|f)$/.test(a))) block("jq: no file reads")
    const files = operands(args).slice(cmd === "jq" || cmd === "cut" || cmd === "tr" ? 1 : 0).filter((a) => existsSync(path.resolve(cwd, a)))
    if (files.length) block(`${cmd} reads only from a pipe here; read files with Read or: node ${AUDIT} show <path>`)
  } else if (cmd === "command") {
    if (args[0] !== "-v") block("command -v only")
  } else if (META.has(cmd)) {
    operands(args).filter((a) => existsSync(path.resolve(cwd, a))).forEach((a) => checkPath(a, { meta: true }))
  } else {
    block(
      `${cmd} is not on the audit allowlist (git reads, grep -c/-l, find, wc, ls, test, sort, uniq, cut, tr, head, tail, jq on pipes, command -v, and node ${AUDIT} for search, secrets, scanners, render and ids)`,
    )
  }
}
process.exit(0)
