#!/usr/bin/env node
// Read-only helpers for /ai-workflow:security-audit (skills/security-audit/law.md). Builtins
// only. No shell anywhere: every child process gets an argv array, so repo text never
// becomes a command. Secret values never reach stdout: type, place, a 4-character prefix,
// length and distinct-character count only. Run from the repo root.
//
//   preflight                                 stop conditions, plugin root, HEAD, scanner smoke test
//   inventory                                 surfaces, symlinks, submodules, LFS, native, IOCs, gaps
//   files [--diff [<base>]] [-- <pathspec>…]  scope list (no symlinks, no odd names)
//   grep <ERE> [-i] [--max N] [--diff [<base>]] [-- <pathspec>…]   masked hits, capped
//   secrets [--history [<base>] | --diff [<base>]]   redacted secret hits (tree, history or diff)
//   unicode [--diff [<base>]]                 hidden, bidi, tag and variation-selector characters
//   workflows                                 workflow and local-action files on other branches that differ from HEAD
//   at <rev> <path>                           one CI, agent or MCP config file at another branch or commit, masked
//   show <path> [<from> [<to>]]               file lines, credential values masked
//   diff [<base>]                             the change under review, masked
//   render helm <chart> [<values>…] | render kustomize <dir>   rendered manifests, masked
//   scan <tool> [--history] [--network]       an installed scanner, projected to rule · path:line
//   id <rule> <path> <line> <symbol>          stable SA- id
//   chain <SA-id>…                            stable SC- id
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { accessSync, constants, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import { matchesAny } from "../pipeline/glob.mjs"

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
export const LAW_SENTINEL = "<!-- ai-workflow-security-law v1 -->"

// ---------- detection (shared with hooks/guard-audit.mjs) ----------

export const SECRET_FILE =
  /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|tfstate|tfstate\.backup)|id_(rsa|dsa|ecdsa|ed25519)|kubeconfig[^/]*|[^/]*credentials[^/]*\.json|[^/]*service[-_]?account[^/]*\.json|\.netrc|\.git-credentials|\.dockercfg)$/i
const EXAMPLE_FILE = /\.(example|sample|template|dist|defaults)$/i
export const isSecretFile = (p) => SECRET_FILE.test(p) && !EXAMPLE_FILE.test(p)

const PATTERNS = [
  // To end of line or quote: a JSON-embedded key ("-----BEGIN…-----\nMIIE…") is one line.
  ["private-key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[^"'\n]*/dg],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/dg],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20}\b/dg],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/dg],
  ["slack-webhook", /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/dg],
  ["discord-webhook", /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/dg],
  ["stripe-key", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/dg],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/dg],
  ["openai-key", /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/dg],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}/dg],
  ["google-oauth-token", /\bya29\.[0-9A-Za-z_-]{20,}/dg],
  ["gcp-service-account", /"type"\s*:\s*"service_account"/dg],
  ["sendgrid-key", /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/dg],
  ["npm-token", /\bnpm_[A-Za-z0-9]{36}\b/dg],
  ["pypi-token", /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}/dg],
  ["url-credentials", /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^:/\s@'"]+:([^@\s'"]{3,})@/dg],
  ["azure-storage-key", /AccountKey=([A-Za-z0-9+/=]{40,})/dg],
  // Azure SAS signature; kept only on a line that also has a signed version (sv=YYYY-MM-DD).
  ["azure-sas", /[?&]sig=([A-Za-z0-9%+/=]{20,})/dg],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/dg],
]
// A credential-named key with a literal value: `password: hunter22`, DB_PASSWORD=x, "token": "…".
const KEYED =
  /(?:^|[^A-Za-z0-9])((?:[A-Za-z0-9]+[_.-])*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?|dsn|conn(?:ection)?[_-]?str(?:ing)?|signing[_-]?key|encryption[_-]?key|salt)[A-Za-z0-9_.-]*)["']?\s*(?::|=|=>)\s*(["']?)([^\s"',;}#)\]]{6,})\2/dgi
const NOT_SECRET_KEY = /[_.-](length|len|min|max|type|url|uri|endpoint|path|file|name|field|header|policy|ttl|timeout|count|id|enabled|regex|pattern|prefix|format)$/i
const REFERENCE =
  /^(\$\{|\{\{|\$\(|\$[A-Za-z_]|<|%|@|var\.|local\.|data\.|module\.|each\.|!|secretKeyRef|valueFrom|https?:\/\/|(none|null|nil|true|false|undefined|string|number|boolean|str|int|bytes|optional|required|\d+)$)/i
const EXPRESSION = /^[A-Za-z_$][\w$]*(\.|\(|\[|::)/
export const PLACEHOLDER =
  /example|dummy|sample|changeme|change_me|placeholder|redacted|your[_-]|xxx|\*{3}|test123|^(.)\1+$|\.\.\.|^password1?2?3?$|^secret$/i

// Every secret-looking value in one line: { type, start, end, value, placeholder }.
export function findSecrets(line) {
  const hits = []
  for (const [type, re] of PATTERNS) {
    if (type === "azure-sas" && !/[?&]sv=\d{4}-\d{2}-\d{2}/.test(line)) continue
    re.lastIndex = 0
    for (let m; (m = re.exec(line)); ) {
      const [s, e] = m.indices[1] ?? m.indices[0]
      hits.push({ type, start: s, end: e, value: line.slice(s, e) })
    }
  }
  KEYED.lastIndex = 0
  for (let m; (m = KEYED.exec(line)); ) {
    const [s, e] = m.indices[3]
    const v = m[3]
    if (NOT_SECRET_KEY.test(m[1]) || REFERENCE.test(v) || EXPRESSION.test(v)) continue
    if (line.slice(0, m.indices[1][0]).endsWith("{{")) continue // a template slot: {{SECRET:kind}}
    if (hits.some((h) => h.start < e && s < h.end)) continue
    hits.push({ type: "credential-assignment", start: s, end: e, value: v, key: m[1] })
  }
  for (const h of hits) h.placeholder = PLACEHOLDER.test(h.value) || /EXAMPLE$/.test(h.value)
  return hits.sort((a, b) => a.start - b.start)
}

export const describe = (v) => `${v.slice(0, 4)}… (${v.length} chars, ${new Set(v).size} distinct)`

export function mask(line) {
  let out = ""
  let at = 0
  for (const h of findSecrets(line)) {
    if (h.start < at) continue
    out += line.slice(at, h.start) + `‹${h.type} ${h.value.length} chars›`
    at = h.end
  }
  return out + line.slice(at)
}

// PEM bodies: the BEGIN line is a secret hit, the base64 lines under it are not on their own.
const PEM_BEGIN = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/
const PEM_END = /-----END (?:[A-Z]+ )?PRIVATE KEY-----/
// 0-based indexes of lines inside a private-key block (after BEGIN, up to END or EOF).
export function pemBody(lines, strip = 0) {
  const body = new Set()
  let inKey = false
  lines.forEach((raw, i) => {
    const l = raw.slice(strip)
    if (inKey) {
      if (PEM_END.test(l)) inKey = false
      else body.add(i)
    } else if (PEM_BEGIN.test(l) && !PEM_END.test(l)) inKey = true
  })
  return body
}
// mask() over a file or diff, with whole PEM body lines replaced.
export function maskLines(lines, strip = 0) {
  const body = pemBody(lines, strip)
  return lines.map((l, i) => (body.has(i) ? `${l.slice(0, strip)}‹private-key body›` : mask(l)))
}
// 1-based line numbers holding a non-placeholder secret value, PEM bodies included.
export function secretLineNumbers(text) {
  const lines = text.split("\n")
  const body = pemBody(lines)
  const out = []
  lines.forEach((l, i) => (body.has(i) || findSecrets(l).some((h) => !h.placeholder)) && out.push(i + 1))
  return out
}

// Never put these on a command line: quotes, $, backticks, backslashes, control characters, leading -.
export const oddName = (p) => /['"$`\\\x00-\x1f\x7f]|^-/.test(p)

// ---------- git, files, scope ----------

const GIT = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "--no-pager"]
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 1 << 30, env: opts.env ?? ENV, timeout: opts.timeout ?? 600000, killSignal: opts.killSignal })
  return { ok: r.status === 0, status: r.status, out: r.stdout ?? "", err: (r.stderr ?? "").trim().split("\n")[0] ?? "" }
}
// git by absolute path, resolved outside the repo: a repo-local bin/git on PATH never runs.
let GIT_BIN
const gitBin = () => (GIT_BIN ??= which("git") ?? die("git not found on PATH outside the repo"))
function git(args, allowFail = false) {
  const r = run(gitBin(), [...GIT, ...args])
  if (!r.ok && !allowFail) die(`git ${args[0]} failed: ${r.err}`)
  return r.ok ? r.out : null
}
function die(msg) {
  console.log(`ERROR ${msg}`)
  process.exit(1)
}

const BUILD = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|target|__pycache__|\.venv|venv)\//
const VENDORED = /(^|\/)(vendor|third_party|third-party|external)\//
const TESTISH = /(^|\/)(tests?|__tests__|spec|specs|fixtures?|testdata|e2e|stories|examples?|mocks?)\/|\.(test|spec|stories)\.[a-z]+$/i

let tracked
export function trackedFiles() {
  if (tracked) return tracked
  const files = []
  const symlinks = []
  const gitlinks = []
  for (const rec of git(["ls-files", "-s", "-z"]).split("\0")) {
    const tab = rec.indexOf("\t")
    if (tab < 0) continue
    const mode = rec.slice(0, 6)
    const p = rec.slice(tab + 1)
    if (mode === "120000") symlinks.push(p)
    else if (mode === "160000") gitlinks.push(p)
    else files.push(p)
  }
  tracked = { files, symlinks, gitlinks }
  return tracked
}

export function resolveBase(base) {
  if (base) return (git(["merge-base", base, "HEAD"], true) ?? base).trim()
  if (git(["status", "--porcelain"]).trim()) return "HEAD"
  for (const b of ["origin/main", "origin/master", "main", "master"]) {
    const mb = git(["merge-base", b, "HEAD"], true)
    if (mb) return mb.trim()
  }
  die("no base: pass one, e.g. diff origin/develop")
}

// Changed (vs base, working tree included) plus untracked, minus symlinks and deletions.
function diffFiles(base) {
  const b = resolveBase(base)
  const names = git(["diff", "--name-only", "-z", "--no-renames", b]).split("\0")
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")
  const all = [...new Set([...names, ...untracked])].filter(Boolean)
  return { base: b, files: all.filter((p) => existsSync(p) && !lstatSync(p).isSymbolicLink()), untracked: new Set(untracked) }
}

// Shared argument parsing for --diff [<base>], --max N, -i and pathspecs after --.
function scope(args) {
  const o = { diff: null, max: 150, ci: false, specs: [], rest: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--diff") o.diff = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : ""
    else if (a === "--max") o.max = Number(args[++i]) || 150
    else if (a === "-i") o.ci = true
    else if (a === "--") o.specs.push(...args.slice(i + 1)), (i = args.length)
    else if (a.startsWith("-")) die(`unknown flag ${a}: only --diff [base], --max N, -i and -- <pathspec> (a pattern starting with - is written [-]…)`)
    else o.rest.push(a)
  }
  let files = o.diff !== null ? diffFiles(o.diff || undefined).files : trackedFiles().files
  // `.` and `./x` mean what they mean in git: dot-directories included.
  const specs = o.specs.map((s) => s.replace(/^(\.\/)+/, "")).filter((s) => s !== "." && s !== "")
  if (o.specs.length && specs.length === o.specs.length)
    files = files.filter((f) => specs.some((s) => f === s || f.startsWith(s.replace(/\/?$/, "/")) || matchesAny([s], f)))
  o.odd = files.filter(oddName)
  o.files = files.filter((f) => !oddName(f))
  return o
}

const LIMIT = 2 << 20
const tooLarge = []
// readText for scanners: a file over the limit is listed (TOO-LARGE), never silently skipped.
function scanText(f) {
  const t = readText(f)
  if (t === null)
    try {
      const st = lstatSync(f)
      if (st.isFile() && st.size > LIMIT) tooLarge.push(`TOO-LARGE ${f} · ${st.size} bytes · not scanned`)
    } catch {}
  return t
}
const reportLarge = () => tooLarge.splice(0).forEach((l) => console.log(l))

function readText(p, limit = LIMIT) {
  try {
    const st = lstatSync(p)
    if (!st.isFile() || st.size > limit) return null
    const buf = readFileSync(p)
    if (buf.subarray(0, 8000).includes(0)) return null
    return buf.toString("utf8")
  } catch {
    return null
  }
}

const rank = (f) => (TESTISH.test(f) ? 2 : 0) + (VENDORED.test(f) ? 1 : 0)

// ---------- commands ----------

const cmds = {}

cmds.preflight = () => {
  if (!git(["rev-parse", "--is-inside-work-tree"], true)) die("not a git repo: security-audit needs one (git init && git add -A first)")
  const top = git(["rev-parse", "--show-toplevel"]).trim()
  if (path.resolve(top) !== path.resolve(process.cwd())) console.log(`STOP run from the repo root: cd ${JSON.stringify(top)}`)
  const law = readText(path.join(PLUGIN_ROOT, "skills/security-audit/law.md")) ?? ""
  console.log(`PLUGIN ${PLUGIN_ROOT}`)
  console.log(law.includes(LAW_SENTINEL) ? "LAW ok" : "STOP plugin law missing or altered")
  console.log(`HEAD ${(git(["rev-parse", "HEAD"], true) ?? "none (no commits)").trim()}`)
  // Local git config can make read-only git run commands (fsmonitor, filters, textconv, pager).
  const gitDir = git(["rev-parse", "--git-dir"]).trim()
  for (const f of ["config", "config.worktree"]) {
    const text = readText(path.join(gitDir, f)) ?? ""
    let section = ""
    for (const line of text.split("\n")) {
      const s = line.match(/^\s*\[([^\]]+)\]/)
      if (s) section = s[1].trim().toLowerCase()
      const kv = line.match(/^\s*([A-Za-z][\w-]*)\s*=\s*(.*)$/)
      if (!kv) continue
      const key = kv[1].toLowerCase()
      const lfs = /^filter "lfs"$/.test(section) && /^git-lfs /.test(kv[2].trim())
      if (
        (section === "core" && ["fsmonitor", "pager", "sshcommand", "editor", "askpass"].includes(key) && kv[2].trim() !== "false") ||
        (/^diff( |$)/.test(section) && ["textconv", "command", "external"].includes(key)) ||
        (/^filter /.test(section) && !lfs) ||
        /^(pager|alias|include|includeif)( |$)/.test(section)
      )
        console.log(`STOP .git/${f} [${section}] ${key} — git may run a command from here; audit a fresh clone`)
    }
  }
  // The audited repo's own Claude settings and MCP servers are live in this session.
  for (const f of [".claude/settings.json", ".claude/settings.local.json", ".mcp.json"]) {
    let j
    try {
      j = JSON.parse(readText(f) ?? "null")
    } catch {
      continue
    }
    if (!j) continue
    const what = [
      j.hooks && Object.keys(j.hooks).length && `hooks (${Object.keys(j.hooks).join(", ")})`,
      j.permissions?.allow?.length && `permissions.allow (${j.permissions.allow.length})`,
      j.enableAllProjectMcpServers && "enableAllProjectMcpServers",
      j.mcpServers && Object.keys(j.mcpServers).length && `MCP servers (${Object.keys(j.mcpServers).join(", ")})`,
      j.env && Object.keys(j.env).length && "env",
    ].filter(Boolean)
    if (what.length)
      console.log(`ASK ${f} defines ${what.join(", ")} — active in this session if project settings are loaded (not under claude --setting-sources user)`)
  }
  // Smoke test: a tool on PATH that can't print its version is BROKEN, and its layer is
  // not covered. Each runs from an empty temp dir with a minimal env (no repo config, no
  // cloud keys, a dead proxy) and is killed at the timeout. Install lines are printed,
  // never run (law §4). Version-manager shims are skipped: they read the repo's
  // .tool-versions or mise.toml and can run or install a repo-chosen binary.
  const state = {}
  const tmp = mkdtempSync(path.join(tmpdir(), "audit-smoke-"))
  const env = { PATH: process.env.PATH ?? "", HOME: tmp, LANG: "C", ...DEAD_PROXY }
  for (const [t, { version, install }] of Object.entries(TOOLS)) {
    const { bin, shim } = locate(t)
    let s = shim && !bin ? "SKIPPED shim" : "MISSING"
    if (bin) {
      const r = run(bin, version, { cwd: tmp, env, timeout: SMOKE_TIMEOUT, killSignal: "SIGKILL" })
      const v = `${r.out}\n${r.err}`.match(/\d+\.\d+(\.\d+)?/)
      s = r.ok && v ? `ok ${v[0]}` : `BROKEN ${r.status === null ? "timeout" : `exit ${r.status}`}`
    }
    state[t] = s
    console.log(`TOOL ${t} ${s}${s === "SKIPPED shim" ? ` (${shim} reads repo config)` : ""}`)
    if (!s.startsWith("ok")) console.log(`RESTORE ${t} · ${install}${s.startsWith("BROKEN") ? " (reinstall)" : ""}`)
  }
  rmSync(tmp, { recursive: true, force: true })
  // A layer counts the tools relevant to this repo; any one ok covers it, except SAST,
  // where each tool covers its own language.
  const files = trackedFiles().files
  const layer = ([name, tools]) => {
    const rel = tools.filter((t) => !LANG[t] || files.some((f) => LANG[t].test(f)))
    if (!rel.length) return `${name} N/A`
    const bad = rel.filter((t) => !state[t].startsWith("ok"))
    if (name === "sast" ? !bad.length : bad.length < rel.length) return `${name} ok`
    const word = bad.length < rel.length ? "partial" : bad.some((t) => state[t].startsWith("BROKEN")) ? "BROKEN" : "MISSING"
    return `${name} ${word} (${bad.map((t) => `${t} ${state[t].split(" ")[0]}`).join(", ")})`
  }
  console.log(`LAYERS ${Object.entries(LAYERS).map(layer).join(" · ")}`)
}

// Scanner smoke-test table: version argv and the install line printed when degraded.
const TOOLS = {
  gitleaks: { version: ["version"], install: "brew install gitleaks" },
  trufflehog: { version: ["--version"], install: "brew install trufflehog" },
  checkov: { version: ["--version"], install: "pipx install checkov" },
  trivy: { version: ["--version"], install: "brew install trivy" },
  hadolint: { version: ["--version"], install: "brew install hadolint" },
  actionlint: { version: ["-version"], install: "brew install actionlint" },
  zizmor: { version: ["--version"], install: "pipx install zizmor" },
  "osv-scanner": { version: ["--version"], install: "brew install osv-scanner" },
  bandit: { version: ["--version"], install: "pipx install bandit" },
  gosec: { version: ["-version"], install: "brew install gosec" },
  brakeman: { version: ["--version"], install: "gem install brakeman" },
  helm: { version: ["version", "--short"], install: "brew install helm" },
  kustomize: { version: ["version"], install: "brew install kustomize" },
}
const LAYERS = { secrets: ["gitleaks", "trufflehog"], ci: ["actionlint", "zizmor"], iac: ["checkov", "trivy", "hadolint"], deps: ["osv-scanner"], sast: ["bandit", "gosec", "brakeman"], render: ["helm", "kustomize"] }
const LANG = { bandit: /\.py$/, gosec: /\.go$/, brakeman: /\.rb$|(^|\/)Gemfile$/ }
const SMOKE_TIMEOUT = Number(process.env.AUDIT_SMOKE_TIMEOUT_MS) || 5000
// A tool that phones home during a version call fails fast instead.
const DEAD_PROXY = { HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "", no_proxy: "" }
const SHIM_DIR = /(^|\/)(shims|\.asdf|mise|\.pyenv|\.rbenv|\.nodenv|\.volta|\.proto)(\/|$)/

// Absolute path of an installed tool. PATH entries that are relative, inside the repo, or a
// version manager's shim dir are skipped: a repo-supplied or repo-selected `trivy` must
// never run as the scanner.
export function locate(t) {
  const real = (p) => {
    try {
      return realpathSync(p)
    } catch {
      return path.resolve(p)
    }
  }
  const repo = real(process.cwd())
  let shim = null
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(d) || real(d) === repo || real(d).startsWith(repo + path.sep)) continue
    try {
      accessSync(path.join(d, t), constants.X_OK)
    } catch {
      continue
    }
    if (SHIM_DIR.test(d) || SHIM_DIR.test(real(d))) shim ??= path.join(d, t)
    else return { bin: path.join(d, t), shim }
  }
  return { bin: null, shim }
}
export const which = (t) => locate(t).bin

const SURFACES = {
  backend: /\.(js|mjs|cjs|ts|mts|cts|py|rb|go|java|kt|kts|scala|cs|php|ex|exs|rs|swift|graphql|gql|proto|sql|prisma)$/,
  client:
    /\.(tsx|jsx|vue|svelte|astro|html?|erb|ejs|hbs|handlebars|pug|njk|liquid|twig|jinja2?|j2|cshtml)$|(^|\/)(next|vite|nuxt|svelte|astro|webpack|remix|angular)\.config\.|angular\.json$|AndroidManifest\.xml$|Info\.plist$|(^|\/)app\.(json|config\.[jt]s)$|tauri\.conf\.json$|network_security_config\.xml$|(^|\/)_headers$|(^|\/)manifest\.json$/,
  infra:
    /\.(tf|tfvars|hcl|nomad)$|(^|\/)(Dockerfile|Containerfile)[^/]*$|(docker-)?compose[^/]*\.ya?ml$|Chart\.yaml$|values[^/]*\.ya?ml$|kustomization\.ya?ml$|(^|\/)(k8s|kubernetes|manifests|deploy|deployments?|helm|charts|infra|terraform|ansible|argocd|argo|flux|clusters|gitops|playbooks?|roles)\/.*\.ya?ml$|serverless\.ya?ml$|(^|\/)template\.ya?ml$|cdk\.json$|Pulumi[^/]*\.ya?ml$|nginx[^/]*\.conf$|Caddyfile$|envoy[^/]*\.ya?ml$|traefik[^/]*\.(ya?ml|toml)$|vercel\.json$|netlify\.toml$|wrangler\.toml$|fly\.toml$|render\.yaml$|(^|\/)app\.yaml$|Procfile$|\.pkr\.(hcl|json)$/,
  "supply-chain":
    /^\.github\/(workflows|actions)\/|\.gitlab-ci\.ya?ml$|Jenkinsfile|bitbucket-pipelines\.yml$|^\.circleci\/|azure-pipelines\.ya?ml$|(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|pyproject\.toml|uv\.lock|setup\.py|setup\.cfg|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|[^/]*\.gemspec|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.lockfile|\.npmrc|\.yarnrc(\.yml)?|\.pnpmfile\.cjs|pip\.conf|\.pypirc|CODEOWNERS|dependabot\.ya?ml|renovate\.json5?|mvnw|gradlew|\.pre-commit-config\.yaml|SECURITY\.md)$|^\.yarn\/(releases|plugins)\/|gradle-wrapper\.(jar|properties)$|^\.mvn\/wrapper\//,
  // Agent instruction, settings and memory files, any depth, any case (case-insensitive filesystems).
  ai: /(^|\/)(\.mcp\.json|mcp[^/]*\.json|CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|CONVENTIONS\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.goosehints|copilot-instructions\.md|\.aider[^/]*|\.envrc|\.?mise\.toml|\.tool-versions|[^/]*\.code-workspace|\.gitmodules)$|(^|\/)\.(claude|cursor|devcontainer|vscode|idea|husky|windsurf|gemini|amazonq|roo|kiro|continue|junie|codex|clinerules)\/|(^|\/)\.github\/(instructions|prompts|chatmodes)\/|(^|\/)prompts?\/|\.prompt(\.md)?$/i,
}
const LLM_SDK =
  /(from|import|require\(|use)\s*['"]?(openai|anthropic|@anthropic-ai\/|@ai-sdk\/|ai['"]|langchain|@langchain\/|llama_index|llamaindex|@aws-sdk\/client-bedrock|vertexai|google\.generativeai|@google\/genai|ollama|cohere|mistralai|@modelcontextprotocol\/|mcp\.server|fastmcp)/
const NATIVE = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|pyx|pxd)$/
const AGENT_DIRS = ["claude", "cursor", "vscode", "gemini", "windsurf", "amazonq", "codex", "github", "devcontainer"].map((d) => "." + d)
// Exact indicators of known, dated compromises (sources in supply-chain.md cicd.backdoor).
// A hit is reported first as suspected compromise, never triaged as an ordinary finding.
const IOC = [
  [/(^|\/)(setup_bun|bun_environment)\.js$/, "Shai-Hulud 2.0 npm worm loader (Nov 2025)"],
  [/(^|\/)(truffleSecrets|actionsSecrets)\.json$/, "Shai-Hulud worm loot file (Sep-Nov 2025)"],
  [/^\.github\/workflows\/shai-hulud[^/]*\.ya?ml$/, "Shai-Hulud exfiltration workflow (Sep 2025)"],
  [/^\.github\/workflows\/formatter_[^/]*\.ya?ml$/, "Shai-Hulud 2.0 secrets-dump workflow (Nov 2025)"],
  [/^\.github\/workflows\/github_actions_security\.ya?ml$/, "GhostAction exfiltration workflow (Sep 2025)"],
  [/(^|\/)litellm_init\.pth$/, "LiteLLM PyPI import-time loader (Mar 2026)"],
]
const iocs = (f) => IOC.filter(([re]) => re.test(f)).map(([, what]) => what)
const SCANNER_CFG =
  /(^|\/)(\.gitleaks\.toml|\.gitleaksignore|\.semgrepignore|\.semgrep\.ya?ml|\.checkov\.ya?ml|\.trivyignore(\.yaml)?|trivy\.yaml|\.hadolint\.ya?ml|zizmor\.ya?ml|\.bandit|\.snyk|\.secretlintrc[^/]*|sonar-project\.properties|\.secrets\.baseline|\.tfsec\/.*|\.kube-linter\.ya?ml)$/

cmds.inventory = () => {
  const { files, symlinks, gitlinks } = trackedFiles()
  const surf = Object.fromEntries(Object.keys(SURFACES).map((k) => [k, 0]))
  const other = {}
  let llm = 0
  const native = []
  const claimsGenerated = []
  const lfs = []
  const binary = {}
  for (const f of files) {
    if (BUILD.test(f)) continue
    let hit = false
    for (const [k, re] of Object.entries(SURFACES)) if (re.test(f)) (surf[k]++, (hit = true))
    const text = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|ex|swift)$/.test(f) || NATIVE.test(f) || f.length < 200 ? readText(f) : null
    if (text && LLM_SDK.test(text)) (llm++, (hit = true))
    if (NATIVE.test(f) || (text && ((/\.rs$/.test(f) && /\bunsafe\b/.test(text)) || (/\.go$/.test(f) && /import\s+"C"/.test(text))))) native.push(f)
    if (text && /@generated|DO NOT EDIT|Code generated .* DO NOT EDIT/.test(text.split("\n", 6).join("\n"))) claimsGenerated.push(f)
    if (text && text.startsWith("version https://git-lfs.github.com/spec/")) lfs.push(f)
    if (!hit) {
      const ext = (path.posix.extname(f) || path.posix.basename(f)).toLowerCase()
      if (!text && existsSync(f) && statSync(f).size > 0 && readText(f) === null) binary[ext] = (binary[ext] ?? 0) + 1
      else other[ext] = (other[ext] ?? 0) + 1
    }
  }
  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k} ${v}`).join(", ") || "none"
  console.log(`FILES ${files.length} tracked · ${files.filter((f) => BUILD.test(f)).length} under build output`)
  console.log(`SURFACES ${Object.entries(surf).map(([k, v]) => `${k} ${v}`).join(" · ")} · llm-sdk files ${llm}`)
  console.log(`UNCLASSIFIED ${line(other)}`)
  console.log(`BINARY ${line(binary)}`)
  console.log(`NATIVE ${native.length}${native.length ? " · " + native.slice(0, 20).join(" ") : ""}`)
  console.log(`VENDORED ${[...new Set(files.filter((f) => VENDORED.test(f)).map((f) => f.match(VENDORED)[0]))].join(" ") || "none"}`)
  console.log(`CLAIMS-GENERATED ${claimsGenerated.length} (audited anyway unless under build output or linguist-generated)`)
  console.log(`LFS ${lfs.length} pointer files${lfs.length ? " — content not checked" : ""}`)
  for (const s of symlinks) {
    let target = ""
    try {
      target = readlinkSync(s)
    } catch {}
    const out = !path.resolve(path.dirname(s), target).startsWith(process.cwd() + path.sep)
    console.log(`SYMLINK ${JSON.stringify(s)} -> ${JSON.stringify(target)}${out ? " · OUTSIDE ROOT" : ""}`)
  }
  for (const g of gitlinks) console.log(`SUBMODULE ${g} · ${existsSync(path.join(g, ".git")) ? "initialized — audit as its own scope" : "not initialized — not checked"}`)
  for (const f of files.filter(oddName)) console.log(`ODD-NAME ${JSON.stringify(f)}`)
  for (const f of files.filter((f) => SCANNER_CFG.test(f))) console.log(`SCANNER-CONFIG ${f}`)
  for (const f of files.filter(isSecretFile)) console.log(`SECRET-FILE ${f} · tracked`)
  for (const f of files)
    for (const what of iocs(f)) console.log(`IOC ${f} · ${what}${TESTISH.test(f) ? " · under a test path" : ""}`)
  for (const f of files) {
    const seg = f.split("/").find((s) => AGENT_DIRS.includes(s.toLowerCase()) && !AGENT_DIRS.includes(s))
    if (seg) console.log(`AGENT-CASE ${JSON.stringify(f)} · case variant of ${seg.toLowerCase()}`)
  }
}

cmds.files = (args) => {
  const o = scope(args)
  for (const f of o.files) if (!BUILD.test(f)) console.log(f)
  for (const f of o.odd) console.log(`ODD-NAME ${JSON.stringify(f)}`)
}

cmds.grep = (args) => {
  const o = scope(args)
  if (!o.rest[0]) die("grep needs a pattern")
  let re
  try {
    re = new RegExp(o.rest[0], o.ci ? "i" : "")
  } catch (e) {
    die(`bad pattern: ${e.message}`)
  }
  const hits = []
  const files = new Set()
  for (const f of o.files) {
    if (BUILD.test(f)) continue
    const text = scanText(f)
    if (text === null) continue
    const lines = text.split("\n")
    const shown = maskLines(lines)
    lines.forEach((l, i) => {
      if (re.test(l)) (hits.push([f, i + 1, shown[i]]), files.add(f))
    })
  }
  hits.sort((a, b) => rank(a[0]) - rank(b[0]))
  console.log(`TOTAL ${hits.length} hits · ${files.size} files`)
  for (const [f, n, l] of hits.slice(0, o.max)) {
    const m = l.trim()
    console.log(`${f}:${n}: ${m.length > 240 ? m.slice(0, 240) + "…" : m}`)
  }
  if (hits.length > o.max) console.log(`PARTIAL ${o.max} of ${hits.length} shown — narrow with -- <pathspec>`)
  for (const f of o.odd) console.log(`ODD-NAME ${JSON.stringify(f)} · not searched`)
  reportLarge()
}

function secretLine(where, h) {
  return `${where} · ${h.type}${h.key ? ` (${h.key})` : ""} · ${describe(h.value)}${h.placeholder ? " · placeholder" : ""}`
}

cmds.secrets = async (args) => {
  if (args[0] === "--history") return historySecrets(args.slice(1))
  const o = scope(args)
  let n = 0
  for (const f of o.files) {
    if (/(^|\/)node_modules\//.test(f)) continue
    if (isSecretFile(f)) {
      console.log(`${f} · secret file${o.diff !== null ? "" : " · tracked"} · content not read`)
      n++
      continue
    }
    const text = scanText(f)
    if (text === null) continue
    text.split("\n").forEach((l, i) => findSecrets(l).forEach((h) => (console.log(secretLine(`${f}:${i + 1}`, h)), n++)))
  }
  console.log(`TOTAL ${n}`)
  reportLarge()
}

// Streams `git log -p` through the detector; diffs never reach stdout.
async function historySecrets(args) {
  const range = args[0] ? [`${args[0]}..HEAD`] : ["--all"]
  const files = git(["log", ...range, "--diff-filter=A", "--name-only", "--format="]).split("\n").filter((f) => f && isSecretFile(f))
  for (const f of new Set(files)) console.log(`${f} · secret file in history · ${git(["log", ...range, "-1", "--format=%h", "--", f]).trim()}`)
  const child = spawn(gitBin(), [...GIT, "log", ...range, "--reverse", "-p", "-U0", "--no-ext-diff", "--no-textconv", "--format=%x00%h"], { env: ENV })
  let commit = ""
  let file = ""
  let n = 0
  const seen = new Set()
  for await (const line of createInterface({ input: child.stdout })) {
    if (line.startsWith("\0")) commit = line.slice(1)
    else if (line.startsWith("+++ ")) file = line.slice(6)
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const h of findSecrets(line.slice(1))) {
        const k = `${file}|${h.type}|${createHash("sha256").update(h.value).digest("hex")}`
        if (seen.has(k)) continue
        seen.add(k)
        console.log(secretLine(`${commit}:${file}`, h))
        n++
      }
    }
  }
  console.log(`TOTAL ${n} distinct (the commit that first added each)`)
}

// Invisible and reordering code points. Variation selectors count only as runs (GlassWorm,
// 2025: bytes map to FE00-FE0F and E0100-E01EF interleaved, so one class): one U+FE0F after
// an emoji is ordinary text. Tag characters always; a lone supplementary selector unless it
// follows a Han ideograph (an ideographic variation sequence). Private Use Area runs are
// payloads outside icon fonts (os-info-checker-es6, 2025).
export const UNICODE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]|[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]{2,}|[\u{E0000}-\u{E007F}]+|[\u{E0100}-\u{E01EF}]|[\uE000-\uF8FF]{3,}/gu
const RUNS = [
  [0xfe00, 0xfe0f, "U+FE00-FE0F"],
  [0xe0000, 0xe007f, "U+E0000-E007F"],
  [0xe0100, 0xe01ef, "U+E0100-E01EF"],
  [0xe000, 0xf8ff, "U+E000-F8FF"],
]
const ICON_FILE = /\.(svg|css|scss|sass|less|ttf|otf|woff2?|eot)$/i
const BINARY_FILE = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|tiff?|woff2?|ttf|otf|eot|zip|gz|tgz|bz2|xz|7z|jar|war|class|so|dylib|dll|exe|bin|wasm|pyc|mp[34]|mov|avi|webm)$/i
const cpName = (c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")
function unicodeLabel(m) {
  const cps = [...m]
  if (cps.length === 1) return cpName(m)
  const names = [...new Set(cps.map((c) => RUNS.find(([a, b]) => c.codePointAt(0) >= a && c.codePointAt(0) <= b)?.[2] ?? cpName(c)))]
  return `${names.join("+")} run ${cps.length}`
}
const utf8 = new TextDecoder("utf-8", { fatal: true })
function isUtf8(f) {
  try {
    utf8.decode(readFileSync(f))
    return true
  } catch {
    return false
  }
}
const isIvs = (l, m) => /^[\u{E0100}-\u{E01EF}]$/u.test(m[0]) && /\p{Script=Han}/u.test([...l.slice(0, m.index)].at(-1) ?? "")
cmds.unicode = (args) => {
  const o = scope(args)
  let n = 0
  for (const f of o.files) {
    const text = scanText(f)
    if (text === null) continue
    // Invalid UTF-8 skips only known binary formats; source with one bad byte still runs, so
    // it is scanned lossy (the replacement character matches nothing here).
    if (text.includes("\uFFFD") && !isUtf8(f)) {
      if (BINARY_FILE.test(f)) {
        console.log(`NOT-UTF8 ${f} · skipped (binary)`)
        continue
      }
      console.log(`NOT-UTF8 ${f} · scanned lossy`)
    }
    text.split("\n").forEach((l, i) => {
      const hits = [...l.matchAll(UNICODE)].filter(
        (m) => !(i === 0 && m.index === 0 && m[0] === "\uFEFF") && !isIvs(l, m) && !(ICON_FILE.test(f) && m[0].codePointAt(0) >= 0xe000 && m[0].codePointAt(0) <= 0xf8ff),
      )
      if (!hits.length) return
      n++
      console.log(`${f}:${i + 1} · ${[...new Set(hits.map((m) => unicodeLabel(m[0])))].join(" ")}`)
    })
  }
  console.log(`TOTAL ${n} lines`)
  reportLarge()
}

// CI files on branches other than HEAD still run for some triggers (stale-branch pwn
// requests, Nx 2025), and so do the local actions they call. Listing compares blob ids
// only; content is printed masked by `at`.
const WORKFLOW_PATH = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/
function workflowBlobs(ref) {
  const out = git(["ls-tree", "-r", "-z", ref, "--", ".github"], true) ?? ""
  const m = new Map()
  for (const rec of out.split("\0")) {
    const [meta, p] = rec.split("\t")
    if (p && WORKFLOW_PATH.test(p)) m.set(p, meta.split(" ")[2])
  }
  return m
}
const branchRefs = () => (git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], true) ?? "").split("\n").filter((r) => r && !/\/HEAD$/.test(r))
cmds.workflows = ([ref, p]) => {
  if (ref) return cmds.at([ref, p])
  const head = workflowBlobs("HEAD")
  const seen = new Map()
  for (const r of branchRefs()) {
    if (oddName(r)) {
      console.log(`ODD-REF ${JSON.stringify(r)} · not read`)
      continue
    }
    for (const [file, blob] of workflowBlobs(r)) {
      if (head.get(file) === blob) continue
      const k = `${file} ${blob}`
      if (!seen.has(k)) seen.set(k, { file, why: head.has(file) ? "differs from HEAD" : "not on HEAD", refs: [] })
      seen.get(k).refs.push(r)
    }
  }
  for (const { file, why, refs: on } of seen.values())
    console.log(`WORKFLOW ${file} · ${why} · on ${on.join(" ")}${iocs(file).map((w) => ` · IOC ${w}`).join("")}`)
  console.log(`TOTAL ${seen.size} variants`)
}

// One CI, agent or MCP config file at another branch or a commit, masked: the stale-branch
// workflow, or the earlier `command`/`args` of an MCP server (rug pull, MCPoison 2025).
cmds.at = ([rev, p]) => {
  if (!rev || !p) die("at <branch-ref|commit> <path>")
  if (oddName(rev) || oddName(p)) die("odd ref or path: not read")
  if (!branchRefs().includes(rev) && !/^[0-9a-f]{7,40}$/.test(rev)) die(`${rev} is not a branch ref or a commit id — list refs with: workflows`)
  if (!(WORKFLOW_PATH.test(p) || SURFACES.ai.test(p) || SURFACES["supply-chain"].test(p)) || isSecretFile(p)) die(`${p}: only CI, agent and MCP config paths`)
  const commit = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], true)
  if (!commit) die(`${rev} is not a commit`)
  const text = git(["cat-file", "blob", `${commit.trim()}:${p}`], true)
  if (text === null) die(`${p} is not on ${rev}`)
  maskLines(text.split("\n")).forEach((l, i) => console.log(`${i + 1}: ${l}`))
}

function safePath(p) {
  const abs = path.resolve(p)
  if (!abs.startsWith(process.cwd() + path.sep)) die(`${p} is outside the repo`)
  if (!existsSync(abs)) die(`${p} does not exist`)
  if (lstatSync(abs).isSymbolicLink()) die(`${p} is a symlink — not followed`)
  if (isSecretFile(p)) die(`${p} is a secret file — report it by path, never read it`)
  return abs
}

cmds.show = ([p, from, to]) => {
  const text = readText(safePath(p))
  if (text === null) die(`${p} is binary or larger than 2 MB`)
  const lines = text.split("\n")
  const a = Math.max(1, Number(from) || 1)
  const b = Math.min(lines.length, Number(to) || (from ? a : a + 399))
  const shown = maskLines(lines)
  for (let i = a; i <= b; i++) console.log(`${i}: ${shown[i - 1]}`)
  if (!from && lines.length > b) console.log(`PARTIAL lines 1-${b} of ${lines.length}`)
}

cmds.diff = ([base]) => {
  const { base: b, files, untracked } = diffFiles(base)
  console.log(`BASE ${b}`)
  const status = git(["diff", "--name-status", "--no-renames", b]).trim()
  if (status) console.log(status.split("\n").map((l) => `STATUS ${l}`).join("\n"))
  for (const f of files) {
    if (oddName(f)) {
      console.log(`=== ODD-NAME ${JSON.stringify(f)} · not shown`)
      continue
    }
    if (isSecretFile(f)) {
      console.log(`=== ${f} · secret file changed · content not shown`)
      continue
    }
    if (untracked.has(f)) {
      const text = readText(f)
      console.log(`=== ${f} · untracked`)
      if (text === null) console.log("(binary or > 2 MB)")
      else maskLines(text.split("\n")).slice(0, 400).forEach((l, i) => console.log(`+${i + 1}: ${l}`))
      continue
    }
    const out = git(["diff", "--no-ext-diff", "--no-textconv", "-U3", b, "--", f])
    console.log(maskLines(out.split("\n"), 1).join("\n"))
  }
}

cmds.render = ([tool, target, ...values]) => {
  if (tool === "helm") {
    const chart = readText(path.join(safePath(target), "Chart.yaml")) ?? ""
    if (/repository:\s*["']?(https?|oci):/.test(chart) && !existsSync(path.join(target, "charts"))) die("chart has remote dependencies and no vendored charts/ — read templates and values instead (LIKELY)")
    const r = run(which("helm") ?? die("helm not installed"), ["template", "audit", target, ...values.flatMap((v) => ["-f", path.relative(process.cwd(), safePath(v))])])
    return r.ok ? console.log(maskLines(r.out.split("\n")).join("\n")) : die(`helm template: ${r.err}`)
  }
  if (tool === "kustomize") {
    const dir = safePath(target)
    const remote = (d) =>
      readdirSync(d, { withFileTypes: true }).some((e) =>
        e.isDirectory() ? !e.name.startsWith(".") && remote(path.join(d, e.name)) : /^kustomization\.ya?ml$/i.test(e.name) && /(:\/\/|github\.com\/|git::|helmCharts:)/.test(readText(path.join(d, e.name)) ?? ""),
      )
    if (remote(path.dirname(dir)) || remote(dir)) die("kustomization references remote bases or helmCharts — read the overlays instead (LIKELY)")
    const r = run(which("kustomize") ?? die("kustomize not installed"), ["build", target])
    return r.ok ? console.log(maskLines(r.out.split("\n")).join("\n")) : die(`kustomize build: ${r.err}`)
  }
  die("render helm <chart> [values…] | render kustomize <dir>")
}

// Scanners run offline with repo ignore files disabled where a flag exists. Output is
// projected to tool:rule · path:line [· commit]; code, messages, authors and secrets never pass.
const SCANNERS = {
  gitleaks: (h) => {
    const v = (run(which("gitleaks"), ["version"]).out.match(/(\d+)\.(\d+)/) ?? [0, 8, 0]).slice(1).map(Number)
    const modern = v[0] > 8 || (v[0] === 8 && v[1] >= 19)
    const sub = h ? (modern ? ["git", "."] : ["detect", "--source", "."]) : modern ? ["dir", "."] : ["detect", "--no-git", "--source", "."]
    return ["gitleaks", [...sub, ...(h && modern ? ["--log-opts=--all"] : []), "--redact", "--no-banner", "--exit-code", "0", "--config", path.join(PLUGIN_ROOT, "scripts/security/gitleaks.toml"), "--ignore-gitleaks-allow", "--report-format", "json", "--report-path", "/dev/stdout"]]
  },
  trufflehog: (h) => ["trufflehog", [h ? "git" : "filesystem", h ? `file://${process.cwd()}` : ".", "--no-verification", "--no-update", "--json"]],
  checkov: () => ["checkov", ["-d", ".", "--quiet", "--compact", "--skip-download", "--output", "json"]],
  trivy: () => ["trivy", ["config", "--skip-check-update", "--offline-scan", "--ignorefile", "/dev/null", "--format", "json", "--quiet", "."]],
  hadolint: () => ["hadolint", ["--no-fail", "-f", "json", ...trackedFiles().files.filter((f) => /(^|\/)(Docker|Container)file[^/]*$/.test(f) && !oddName(f))]],
  actionlint: () => ["actionlint", ["-format", "{{json .}}", "-no-color"]],
  zizmor: () => ["zizmor", ["--offline", "--format", "json", "."]],
  "osv-scanner": (_h, net) => ["osv-scanner", ["scan", "source", "--offline-vulnerabilities", ...(net ? ["--download-offline-databases"] : []), "--format", "json", "-r", "."]],
  bandit: () => ["bandit", ["-r", ".", "-f", "json", "-q", "--ignore-nosec", "-x", "./node_modules,./.venv,./venv,./tests"]],
  gosec: () => ["gosec", ["-fmt=json", "-nosec", "-quiet", "./..."]],
  brakeman: () => ["brakeman", ["-q", "-f", "json", "--no-pager", "--no-exit-on-warn"]],
}
const RULE_KEYS = ["RuleID", "rule_id", "check_id", "test_id", "ident", "DetectorName", "check_name", "ID", "code", "kind"]
const FILE_KEYS = ["File", "file", "filename", "file_path", "filepath", "given_path", "Target"]
const LINE_KEYS = ["StartLine", "line", "line_number", "file_line_range", "row", "Line"]
const COMMIT_KEYS = ["Commit", "commit"]

// Walks any scanner JSON and keeps only rule id, path, line and commit.
export function project(tool, json) {
  const out = new Set()
  const short = (v) => (typeof v === "string" || typeof v === "number") && /^[\w.:/@-]{1,80}$/.test(String(v))
  const walk = (node, ctx) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ctx))
    if (!node || typeof node !== "object") return
    const c = { ...ctx }
    const rk = RULE_KEYS.find((k) => short(node[k]))
    if (rk) c.rule = String(node[rk])
    for (const k of FILE_KEYS) if (typeof node[k] === "string") c.file = node[k]
    for (const k of COMMIT_KEYS) if (short(node[k])) c.commit = String(node[k])
    let line
    for (const k of LINE_KEYS) {
      const v = Array.isArray(node[k]) ? node[k][0] : node[k]
      if (Number.isFinite(Number.parseInt(v, 10))) line = Number.parseInt(v, 10)
    }
    if (c.rule && c.file && line !== undefined) {
      const f = c.file.replace(process.cwd() + path.sep, "").replace(/^\.\//, "").replace(/[\x00-\x1f]/g, "?")
      out.add(`${c.suppressed ? "SUPPRESSED " : ""}${tool}:${c.rule} · ${f}:${line}${c.commit ? ` · ${c.commit.slice(0, 10)}` : ""}`)
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, { ...c, suppressed: c.suppressed || /skip|suppress|ignor/i.test(k) })
  }
  walk(json, {})
  return [...out]
}

function projectOsv(json) {
  const out = []
  for (const r of json?.results ?? [])
    for (const p of r.packages ?? []) {
      const ids = (p.vulnerabilities ?? []).map((v) => v.id).filter(short2)
      if (ids.length) out.push(`osv:${ids.join(",")} · ${p.package?.ecosystem}/${p.package?.name}@${p.package?.version} · ${r.source?.path?.replace(process.cwd() + path.sep, "")}`)
    }
  return out
}
const short2 = (v) => typeof v === "string" && /^[\w.:-]{1,40}$/.test(v)

cmds.scan = ([tool, ...flags]) => {
  if (!SCANNERS[tool]) die(`scan: one of ${Object.keys(SCANNERS).join(", ")}`)
  const bin = which(tool)
  if (!bin) return console.log(`SKIP ${tool} · not installed`)
  const [, args] = SCANNERS[tool](flags.includes("--history"), flags.includes("--network"))
  const env = Object.fromEntries(Object.entries(ENV).filter(([k]) => !/^(BC_|PRISMA_|SEMGREP_APP|SNYK_|SONAR_)/.test(k)))
  const r = run(bin, args, { env, timeout: 900000 })
  const raw = r.out.trim()
  let json
  try {
    json = raw.startsWith("[") || raw.startsWith("{") ? JSON.parse(raw) : raw.split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return console.log(`ERROR ${tool} · exit ${r.status} · ${r.err.replace(/[^\x20-\x7e]/g, "?").slice(0, 160) || "no JSON output"}`)
  }
  const lines = tool === "osv-scanner" ? projectOsv(json) : project(tool, json)
  lines.forEach((l) => console.log(l))
  console.log(`TOTAL ${tool} ${lines.length}`)
}

export function saId(rule, file, sink, symbol) {
  const s = mask(sink).replace(/\s+/g, " ").trim()
  return "SA-" + createHash("sha256").update([rule, file, symbol, s].join("|")).digest("hex").slice(0, 10)
}

cmds.id = ([rule, file, line, symbol]) => {
  if (!rule || !file || !line || !symbol) die("id <rule> <path> <line> <symbol>")
  const sink = isSecretFile(file) ? "" : (readText(safePath(file)) ?? "").split("\n")[Number(line) - 1]
  if (sink === undefined) die(`${file} has no line ${line}`)
  console.log(saId(rule, file, sink, symbol))
}

cmds.chain = (ids) => {
  if (ids.length < 2 || !ids.every((i) => /^SA-[0-9a-f]{10}$/.test(i))) die("chain <SA-id> <SA-id>…")
  console.log("SC-" + createHash("sha256").update([...ids].sort().join("|")).digest("hex").slice(0, 10))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmds[cmd]) die(`usage: audit.mjs ${Object.keys(cmds).join("|")} — see the header of this file`)
  await cmds[cmd](args)
}
