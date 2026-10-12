#!/usr/bin/env node
// Read-only helpers for /ai-workflow:security-audit (skills/security-audit/law.md). Builtins
// only. No shell anywhere: every child process gets an argv array, so repo text never
// becomes a command. Secret values never reach stdout: type, place, a 4-character prefix,
// length and distinct-character count only. Run from the repo root.
//
//   preflight                                 stop conditions, plugin root, HEAD, tools
//   inventory                                 surfaces, symlinks, submodules, LFS, native, gaps
//   files [--diff [<base>]] [-- <pathspec>…]  scope list (no symlinks, no odd names)
//   grep <ERE> [-i] [--max N] [--diff [<base>]] [-- <pathspec>…]   masked hits, capped
//   secrets [--history [<base>] | --diff [<base>]]   redacted secret hits (tree, history or diff)
//   unicode [--diff [<base>]]                 hidden, bidi and tag characters
//   show <path> [<from> [<to>]]               file lines, credential values masked
//   diff [<base>]                             the change under review, masked
//   render helm <chart> [<values>…] | render kustomize <dir>   rendered manifests, masked
//   scan <tool> [--history] [--network]       an installed scanner, projected to rule · path:line
//   id <rule> <path> <line> <symbol>          stable SA- id
//   chain <SA-id>…                            stable SC- id
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { accessSync, constants, existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs"
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
  ["private-key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/dg],
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

// Never put these on a command line: quotes, $, backticks, backslashes, control characters, leading -.
export const oddName = (p) => /['"$`\\\x00-\x1f\x7f]|^-/.test(p)

// ---------- git, files, scope ----------

const GIT = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "--no-pager"]
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 30, env: opts.env ?? ENV, timeout: opts.timeout ?? 600000 })
  return { ok: r.status === 0, status: r.status, out: r.stdout ?? "", err: (r.stderr ?? "").trim().split("\n")[0] ?? "" }
}
function git(args, allowFail = false) {
  const r = run("git", [...GIT, ...args])
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
    else o.rest.push(a)
  }
  let files = o.diff !== null ? diffFiles(o.diff || undefined).files : trackedFiles().files
  if (o.specs.length) files = files.filter((f) => o.specs.some((s) => f === s || f.startsWith(s.replace(/\/?$/, "/")) || matchesAny([s], f)))
  o.odd = files.filter(oddName)
  o.files = files.filter((f) => !oddName(f))
  return o
}

function readText(p, limit = 2 << 20) {
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
    if (what.length) console.log(`ASK ${f} defines ${what.join(", ")} — active in this session`)
  }
  const tools = ["gitleaks", "trufflehog", "checkov", "trivy", "hadolint", "actionlint", "zizmor", "osv-scanner", "bandit", "gosec", "brakeman", "helm", "kustomize"]
  console.log(`TOOLS ${tools.filter(onPath).join(" ") || "none"}`)
  console.log(`MISSING ${tools.filter((t) => !onPath(t)).join(" ") || "none"}`)
}

function onPath(t) {
  return (process.env.PATH ?? "").split(path.delimiter).some((d) => {
    try {
      accessSync(path.join(d, t), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

const SURFACES = {
  backend: /\.(js|mjs|cjs|ts|mts|cts|py|rb|go|java|kt|kts|scala|cs|php|ex|exs|rs|swift|graphql|gql|proto|sql|prisma)$/,
  client:
    /\.(tsx|jsx|vue|svelte|astro|html?|erb|ejs|hbs|handlebars|pug|njk|liquid|twig|jinja2?|j2|cshtml)$|(^|\/)(next|vite|nuxt|svelte|astro|webpack|remix|angular)\.config\.|angular\.json$|AndroidManifest\.xml$|Info\.plist$|(^|\/)app\.(json|config\.[jt]s)$|tauri\.conf\.json$|network_security_config\.xml$|(^|\/)_headers$|(^|\/)manifest\.json$/,
  infra:
    /\.(tf|tfvars|hcl|nomad)$|(^|\/)(Dockerfile|Containerfile)[^/]*$|(docker-)?compose[^/]*\.ya?ml$|Chart\.yaml$|values[^/]*\.ya?ml$|kustomization\.ya?ml$|(^|\/)(k8s|kubernetes|manifests|deploy|deployments?|helm|charts|infra|terraform|ansible|argocd|argo|flux|clusters|gitops|playbooks?|roles)\/.*\.ya?ml$|serverless\.ya?ml$|(^|\/)template\.ya?ml$|cdk\.json$|Pulumi[^/]*\.ya?ml$|nginx[^/]*\.conf$|Caddyfile$|envoy[^/]*\.ya?ml$|traefik[^/]*\.(ya?ml|toml)$|vercel\.json$|netlify\.toml$|wrangler\.toml$|fly\.toml$|render\.yaml$|(^|\/)app\.yaml$|Procfile$|\.pkr\.(hcl|json)$/,
  "supply-chain":
    /^\.github\/(workflows|actions)\/|\.gitlab-ci\.ya?ml$|Jenkinsfile|bitbucket-pipelines\.yml$|^\.circleci\/|azure-pipelines\.ya?ml$|(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|pyproject\.toml|uv\.lock|setup\.py|setup\.cfg|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|[^/]*\.gemspec|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.lockfile|\.npmrc|\.yarnrc(\.yml)?|\.pnpmfile\.cjs|pip\.conf|\.pypirc|CODEOWNERS|dependabot\.ya?ml|renovate\.json5?|mvnw|gradlew|\.pre-commit-config\.yaml|SECURITY\.md)$|^\.yarn\/(releases|plugins)\/|gradle-wrapper\.(jar|properties)$|^\.mvn\/wrapper\//,
  ai: /(^|\/)(\.mcp\.json|mcp[^/]*\.json|CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md|\.envrc|\.?mise\.toml|\.tool-versions)$|^\.(claude|cursor|devcontainer|vscode|idea|husky|windsurf)\/|(^|\/)prompts?\/|\.prompt(\.md)?$/,
}
const LLM_SDK =
  /(from|import|require\(|use)\s*['"]?(openai|anthropic|@anthropic-ai\/|@ai-sdk\/|ai['"]|langchain|@langchain\/|llama_index|llamaindex|@aws-sdk\/client-bedrock|vertexai|google\.generativeai|@google\/genai|ollama|cohere|mistralai|@modelcontextprotocol\/|mcp\.server|fastmcp)/
const NATIVE = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|pyx|pxd)$/
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
    const text = readText(f)
    if (text === null) continue
    text.split("\n").forEach((l, i) => {
      if (re.test(l)) (hits.push([f, i + 1, l]), files.add(f))
    })
  }
  hits.sort((a, b) => rank(a[0]) - rank(b[0]))
  console.log(`TOTAL ${hits.length} hits · ${files.size} files`)
  for (const [f, n, l] of hits.slice(0, o.max)) {
    const m = mask(l).trim()
    console.log(`${f}:${n}: ${m.length > 240 ? m.slice(0, 240) + "…" : m}`)
  }
  if (hits.length > o.max) console.log(`PARTIAL ${o.max} of ${hits.length} shown — narrow with -- <pathspec>`)
  for (const f of o.odd) console.log(`ODD-NAME ${JSON.stringify(f)} · not searched`)
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
    const text = readText(f)
    if (text === null) continue
    text.split("\n").forEach((l, i) => findSecrets(l).forEach((h) => (console.log(secretLine(`${f}:${i + 1}`, h)), n++)))
  }
  console.log(`TOTAL ${n}`)
}

// Streams `git log -p` through the detector; diffs never reach stdout.
async function historySecrets(args) {
  const range = args[0] ? [`${args[0]}..HEAD`] : ["--all"]
  const files = git(["log", ...range, "--diff-filter=A", "--name-only", "--format="]).split("\n").filter((f) => f && isSecretFile(f))
  for (const f of new Set(files)) console.log(`${f} · secret file in history · ${git(["log", ...range, "-1", "--format=%h", "--", f]).trim()}`)
  const child = spawn("git", [...GIT, "log", ...range, "--reverse", "-p", "-U0", "--no-ext-diff", "--no-textconv", "--format=%x00%h"], { env: ENV })
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

const UNICODE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ]|[\u{E0000}-\u{E007F}]/gu
cmds.unicode = (args) => {
  const o = scope(args)
  let n = 0
  for (const f of o.files) {
    const text = readText(f)
    if (text === null) continue
    text.split("\n").forEach((l, i) => {
      const cps = [...l.matchAll(UNICODE)].filter((m) => !(i === 0 && m.index === 0 && m[0] === "﻿"))
      if (!cps.length) return
      n++
      console.log(`${f}:${i + 1} · ${[...new Set(cps.map((m) => "U+" + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")))].join(" ")}`)
    })
  }
  console.log(`TOTAL ${n} lines`)
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
  for (let i = a; i <= b; i++) console.log(`${i}: ${mask(lines[i - 1])}`)
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
      else text.split("\n").slice(0, 400).forEach((l, i) => console.log(`+${i + 1}: ${mask(l)}`))
      continue
    }
    const out = git(["diff", "--no-ext-diff", "--no-textconv", "-U3", b, "--", f])
    console.log(out.split("\n").map(mask).join("\n"))
  }
}

cmds.render = ([tool, target, ...values]) => {
  if (tool === "helm") {
    const chart = readText(path.join(safePath(target), "Chart.yaml")) ?? ""
    if (/repository:\s*["']?(https?|oci):/.test(chart) && !existsSync(path.join(target, "charts"))) die("chart has remote dependencies and no vendored charts/ — read templates and values instead (LIKELY)")
    const r = run("helm", ["template", "audit", target, ...values.flatMap((v) => ["-f", path.relative(process.cwd(), safePath(v))])])
    return r.ok ? console.log(r.out.split("\n").map(mask).join("\n")) : die(`helm template: ${r.err}`)
  }
  if (tool === "kustomize") {
    const dir = safePath(target)
    const remote = (d) =>
      readdirSync(d, { withFileTypes: true }).some((e) =>
        e.isDirectory() ? !e.name.startsWith(".") && remote(path.join(d, e.name)) : /^kustomization\.ya?ml$/i.test(e.name) && /(:\/\/|github\.com\/|git::|helmCharts:)/.test(readText(path.join(d, e.name)) ?? ""),
      )
    if (remote(path.dirname(dir)) || remote(dir)) die("kustomization references remote bases or helmCharts — read the overlays instead (LIKELY)")
    const r = run("kustomize", ["build", target])
    return r.ok ? console.log(r.out.split("\n").map(mask).join("\n")) : die(`kustomize build: ${r.err}`)
  }
  die("render helm <chart> [values…] | render kustomize <dir>")
}

// Scanners run offline with repo ignore files disabled where a flag exists. Output is
// projected to tool:rule · path:line [· commit]; code, messages, authors and secrets never pass.
const SCANNERS = {
  gitleaks: (h) => {
    const v = (run("gitleaks", ["version"]).out.match(/(\d+)\.(\d+)/) ?? [0, 8, 0]).slice(1).map(Number)
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
  if (!onPath(tool)) return console.log(`SKIP ${tool} · not installed`)
  const [cmd, args] = SCANNERS[tool](flags.includes("--history"), flags.includes("--network"))
  const env = Object.fromEntries(Object.entries(ENV).filter(([k]) => !/^(BC_|PRISMA_|SEMGREP_APP|SNYK_|SONAR_)/.test(k)))
  const r = run(cmd, args, { env, timeout: 900000 })
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
