#!/usr/bin/env node
// Eval harness for /ai-workflow:security-audit. Builtins only; git through argv, no shell, no
// network. Two steps around a manual audit run (README in tests/fixtures/security-evals/):
//
//   materialize <ground-truth.json> <out-dir> [<case-id>…]
//       one git repo per case at <out-dir>/<id>/repo: dot- paths and .fixture suffixes
//       renamed, {{SECRET:kind}} and {{UNICODE:kind[:n]}} filled with fresh values, commits
//       and branches replayed. Answers (resolved anchors, secret values, 0600) go to
//       <out-dir>/.answers/<id>/, away from the audited repo. The repos are hostile.
//   score <out-dir> [--baseline <file>] [--json]
//       scores every <out-dir>/<id>/report.md against the answers: recall, precision,
//       per-family recall and decoy false positives, chains, verdicts, leaks. Exit 1 on a
//       leak, a hard decoy false positive, a false clean on a spot-checked rule, a missing
//       report, or a drop below the baseline.
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SEV = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, HARDENING: 0 }
// The rules the skill's verifier spot-checks when they claim clean (SKILL.md §5).
export const SPOT_CHECKED = new Set(["authz.missing", "authz.bola", "inj.sql", "ssrf", "cicd.pwn-request"])

function die(msg) {
  console.log(`ERROR ${msg}`)
  process.exit(1)
}

// ---------- materialize ----------

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_DATE: "2026-01-05T10:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-05T10:00:00Z",
}
function git(cwd, args, env = {}) {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env: { ...ENV, ...env }, encoding: "utf8" })
  if (r.status !== 0) die(`git ${args[0]} in ${cwd}: ${(r.stderr ?? "").trim().split("\n")[0]}`)
  return r.stdout
}

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWYZabcdefghjkmnpqrstuvwyz23456789"
const rand = (n, alphabet = ALNUM) => [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join("")
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
// The scored value (what must never appear in a report) and the text written to the file.
// Fixed prefixes are not part of the value: they are public format, not secret.
export function makeSecret(kind) {
  if (kind === "aws") return { prefix: "AKIA", value: rand(16, "ABCDEFGHJKLMNPQRSTUVWYZ234567") }
  if (kind === "github") return { prefix: "ghp_", value: rand(36) }
  if (kind === "stripe") return { prefix: "sk_" + "live_", value: rand(24) }
  if (kind === "password") return { prefix: "", value: rand(20) }
  // One line, JSON-escaped, as in a service-account file.
  if (kind === "pem") return { prefix: "-----BEGIN " + "PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC", value: rand(64, B64), suffix: "\\n-----END PRIVATE KEY-----\\n" }
  die(`unknown secret kind ${kind}`)
}
// GlassWorm-style: payload bytes below 16 map to FE00-FE0F, the rest to E0100-E01EF.
export function makeUnicode(kind, n) {
  if (kind === "vs") return [...randomBytes(n)].map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16))).join("")
  if (kind === "bidi") return String.fromCodePoint(0x202e)
  die(`unknown unicode kind ${kind}`)
}

// cases/<id>/<layer>/dot-github/x → .github/x; CLAUDE.md.fixture → CLAUDE.md (agent files are
// stored inert, or a session working in this repo would load them).
const mapPath = (rel) => rel.split("/").map((s) => (s.startsWith("dot-") ? "." + s.slice(4) : s.endsWith(".fixture") ? s.slice(0, -8) : s)).join("/")

function copyLayer(src, dest, fill, rel = "") {
  for (const e of readdirSync(path.join(src, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name)
    if (e.isDirectory()) copyLayer(src, dest, fill, r)
    else {
      const out = path.join(dest, mapPath(r))
      mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, fill(readFileSync(path.join(src, r), "utf8")))
    }
  }
}

function resolveAt(repo, at) {
  if (at.history) return { file: at.file, lines: null }
  const text = at.ref ? git(repo, ["cat-file", "blob", `${at.ref}:${at.file}`]) : readFileSync(path.join(repo, at.file), "utf8")
  const found = text.split("\n").flatMap((l, i) => (l.includes(at.anchor) ? [i] : []))
  if (found.length !== 1) die(`anchor ${JSON.stringify(at.anchor)} matches ${found.length} lines in ${at.ref ? at.ref + ":" : ""}${at.file} (needs exactly 1)`)
  return { file: at.file, lines: [found[0] + 1, found[0] + (at.span ?? 1)], ...(at.ref ? { ref: at.ref } : {}) }
}
// Ground truth is data too: no path in it may leave its base directory.
function inside(base, rel) {
  const r = path.resolve(base, rel)
  if (path.relative(base, r).startsWith("..") || path.isAbsolute(path.relative(base, r))) die(`${rel} escapes ${base}`)
  return r
}

export function materialize(gtPath, out, only = []) {
  const gt = JSON.parse(readFileSync(gtPath, "utf8"))
  const casesDir = path.join(path.dirname(gtPath), "cases")
  const abs = path.resolve(out)
  if (abs === PLUGIN_ROOT || abs.startsWith(PLUGIN_ROOT + path.sep)) die("out-dir must be outside the plugin repo")
  mkdirSync(abs, { recursive: true })
  const cases = gt.cases.filter((c) => !only.length || only.includes(c.id))
  console.log("WARNING materialized repos are hostile: never install, build, test or run them, or open them in an IDE")
  for (const c of cases) {
    if (!/^c\d{3}$/.test(c.id)) die(`bad case id ${JSON.stringify(c.id)}`)
    const dir = path.join(abs, c.id)
    const answers = path.join(abs, ".answers", c.id)
    if (existsSync(dir)) die(`${dir} exists — use an empty out-dir`)
    const repo = path.join(dir, "repo")
    mkdirSync(repo, { recursive: true })
    mkdirSync(answers, { recursive: true })
    const made = {}
    const fill = (t) =>
      t
        .replace(/\{\{SECRET:([a-z]+)\}\}/g, (_, k) => ((made[k] ??= makeSecret(k)), made[k].prefix + made[k].value + (made[k].suffix ?? "")))
        .replace(/\{\{UNICODE:([a-z]+)(?::(\d+))?\}\}/g, (_, k, n) => makeUnicode(k, Number(n) || 1))
    git(repo, ["-c", "init.defaultBranch=main", "init", "-q"])
    for (const k of c.commits ?? [{ layer: "tree", msg: "initial import" }]) {
      if (k.branch_here) {
        git(repo, ["branch", k.branch_here])
        continue
      }
      copyLayer(inside(path.join(casesDir, c.id), k.layer), repo, fill)
      for (const r of k.remove ?? []) rmSync(inside(repo, r))
      git(repo, ["add", "-A"])
      const [, name, email] = (k.author ?? "Dana Lee <dana@example.com>").match(/^(.*) <(.*)>$/)
      git(repo, ["commit", "-q", "-m", k.msg ?? "update"], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email })
    }
    // As in a clone: every branch also exists as a remote-tracking ref.
    for (const b of git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter(Boolean))
      git(repo, ["update-ref", `refs/remotes/origin/${b}`, `refs/heads/${b}`])
    if (c.uncommitted) copyLayer(inside(path.join(casesDir, c.id), c.uncommitted), repo, fill)
    const res = (list) => (list ?? []).map((e) => ({ ...e, at: (e.at ?? []).map((a) => resolveAt(repo, a)) }))
    const expected = {
      id: c.id,
      mode: c.mode ?? "full",
      window: gt.match?.window ?? 3,
      verdict: c.verdict ?? null,
      expect: res(c.expect),
      decoys: res(c.decoys),
      incidental: c.incidental ?? [],
      chains: c.chains ?? [],
      fix_first: c.fix_first ?? null,
    }
    const secrets = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, v.value]))
    writeFileSync(path.join(answers, "expected.json"), JSON.stringify(expected, null, 2) + "\n")
    writeFileSync(path.join(answers, "secrets.json"), JSON.stringify(secrets) + "\n", { mode: 0o600 })
    chmodSync(path.join(answers, "secrets.json"), 0o600)
    console.log(`CASE ${c.id} · ${repo} · ${expected.mode}${c.uncommitted ? " (the change is uncommitted)" : ""}`)
  }
  console.log(`TOTAL ${cases.length} cases · audit each repo, save the report as <out-dir>/<id>/report.md, then: eval.mjs score ${out}`)
}

// ---------- parse ----------

const LOC = /([A-Za-z0-9_.@+\/-]+):(\d+)/g
const RULE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/

export function parseReport(text) {
  const body = text.replace(/<<<DATA[\s\S]*?DATA>>>/g, "")
  const lines = body.split("\n")
  const findings = []
  const chains = []
  let cur = null
  const close = () => (cur && (cur.kind === "chain" ? chains : findings).push(cur), (cur = null))
  for (const l of lines) {
    const f = l.match(/^#{2,3}\s+(SA-[0-9a-f]{10}|C\d+)\s+(CRITICAL|HIGH|MEDIUM|LOW)\b(.*)$/)
    const ch = l.match(/^#{2,3}\s+(SC-[0-9a-f]{10})\s+(CRITICAL|HIGH|MEDIUM|LOW)\b/)
    const low = l.match(/^\[(LOW|HARDENING)\]\s+(SA-[0-9a-f]{10}|C\d+)\s+(\S+)\s+(.*)$/)
    if (f || ch || low || /^#{1,3}\s/.test(l)) close()
    if (f) cur = { id: f[1], severity: f[2], confidence: /CONFIRMED/.test(f[3]) ? "CONFIRMED" : /LIKELY/.test(f[3]) ? "LIKELY" : null, rule: null, text: "" }
    else if (ch) cur = { kind: "chain", id: ch[1], severity: ch[2], hops: [] }
    else if (low) findings.push({ id: low[2], severity: low[1], confidence: null, rule: low[3], text: low[4], where: low[4], locs: locs(low[4]) })
    else if (cur?.kind === "chain") {
      if (/^Path:/.test(l)) cur.hops = [...l.matchAll(/SA-[0-9a-f]{10}/g)].map((m) => m[0])
    } else if (cur) {
      const r = l.match(/^Rule:\s*(\S+)/)
      if (r && RULE.test(r[1])) cur.rule = r[1]
      cur.text += l + "\n"
      // Only the template's location fields place a finding (templates/security-report.md);
      // Controls checked, Fix, Variants and Chain lines cite other code.
      if (/^(Target|Locations):/.test(l)) cur.where = (cur.where ?? "") + l + "\n"
    }
  }
  close()
  for (const f of findings) (f.where ??= ""), (f.locs ??= locs(f.where))
  const coverage = {}
  for (const m of body.matchAll(/^COVERAGE\s+(\S+)\s+·\s+(clean|partial|N\/A|not checked)/gm)) coverage[m[1]] = m[2]
  const verdict = body.match(/^Verdict:\s*(BLOCK|FIX-SOON|PASS)/m)?.[1] ?? null
  const fixFirst = body.match(/^Fix first:\s*(S[AC]-[0-9a-f]{10})/m)?.[1] ?? null
  const ledger = body.match(/Entry points traced:\s*(\d+)\s*\/\s*(\d+)/)
  return { findings, chains, coverage, verdict, fixFirst, ledger: ledger ? [Number(ledger[1]), Number(ledger[2])] : null }
}
function locs(text) {
  return [...text.matchAll(LOC)].map((m) => ({ file: m[1].replace(/^\.\//, ""), line: Number(m[2]) }))
}

// ---------- score ----------

const rulesOf = (e) => [e.rule, ...(e.alt_rules ?? [])]
const family = (rule) => rule.split(".")[0]
const sameFile = (a, b) => a === b || a.endsWith("/" + b)
const branch = (ref) => ref.replace(/^refs\/(heads|remotes\/origin)\//, "")
// Line distance from a finding to an anchor (0 inside it), or null when it doesn't place
// the finding there. History anchors match on the file named in Target or Locations; a ref
// anchor also needs the branch named.
function distance(a, f) {
  if (a.ref && !f.text.includes(branch(a.ref))) return null
  if (a.lines === null) return f.where.includes(a.file) ? 0 : null
  const ds = f.locs.filter((l) => sameFile(l.file, a.file)).map((l) => (l.line < a.lines[0] ? a.lines[0] - l.line : l.line > a.lines[1] ? l.line - a.lines[1] : 0))
  return ds.length ? Math.min(...ds) : null
}
// The labelled entry a finding belongs to: same rule, within the window, nearest line; a
// decoy wins a tie, so flagging the safe line next to the plant is never credited.
function nearest(exp, f, w) {
  let best = null
  for (const [kind, list] of [["decoy", exp.decoys], ["expect", exp.expect]])
    for (const e of list) {
      if (!rulesOf(e).includes(f.rule)) continue
      const d = Math.min(...e.at.map((a) => distance(a, f) ?? Infinity))
      if (d <= w && (!best || d < best.d)) best = { kind, e, d }
    }
  return best
}

export function scoreCase(exp, reportText, secrets = {}) {
  const rep = parseReport(reportText)
  const w = exp.window ?? 3
  const findings = [...rep.findings].sort((a, b) => SEV[b.severity] - SEV[a.severity])
  const matched = new Map() // expect key → finding
  const decoyFP = []
  const unexpected = []
  const under = []
  let duplicates = 0
  for (const f of findings) {
    const n = nearest(exp, f, w)
    if (n?.kind === "decoy") {
      decoyFP.push({ key: n.e.key, rule: f.rule, id: f.id, severity: f.severity, confidence: f.confidence, hard: f.confidence === "CONFIRMED" && SEV[f.severity] >= SEV.MEDIUM })
    } else if (n) {
      // Underrating a plant is not catching it: severity below the lowest accepted one.
      if (n.e.severity && SEV[f.severity] < Math.min(...n.e.severity.map((x) => SEV[x]))) under.push(n.e.key)
      else if (matched.has(n.e.key)) duplicates++
      else matched.set(n.e.key, f)
    } else if (exp.incidental.some((i) => rulesOf(i).includes(f.rule) && (!i.file || f.locs.some((l) => sameFile(l.file, i.file))))) continue
    else unexpected.push({ id: f.id, rule: f.rule, severity: f.severity, loc: f.locs[0] ? `${f.locs[0].file}:${f.locs[0].line}` : "?", counted: SEV[f.severity] >= SEV.LOW })
  }
  const missed = exp.expect.filter((e) => !matched.has(e.key))
  const severityOff = exp.expect.filter((e) => e.severity && matched.has(e.key) && !e.severity.includes(matched.get(e.key).severity)).map((e) => e.key)
  const idOf = (key) => matched.get(key)?.id ?? exp.chains.find((c) => c.key === key && foundChain(c))?.id
  const foundChain = (c) => {
    const ids = c.hops.map((k) => matched.get(k)?.id)
    if (ids.some((i) => !i)) return null
    const hit = rep.chains.find((ch) => ids.every((i) => ch.hops.includes(i)))
    if (hit) c.id = hit.id
    return hit
  }
  const chains = exp.chains.map((c) => ({ key: c.key, found: Boolean(foundChain(c)) }))
  const falseClean = missed.filter((e) => rulesOf(e).some((r) => rep.coverage[r] === "clean")).map((e) => ({ key: e.key, rule: e.rule, spot: rulesOf(e).some((r) => SPOT_CHECKED.has(r) && rep.coverage[r] === "clean") }))
  // Any 8 consecutive characters of a value, whitespace ignored: a prefix, a wrapped line or a
  // partial key is still a leak.
  const flat = reportText.replace(/\s+/g, "")
  const leaks = Object.entries(secrets).filter(([, v]) => v && [...Array(Math.max(1, v.length - 7)).keys()].some((i) => flat.includes(v.slice(i, i + 8)))).map(([k]) => k)
  // A cross-file finding names the file the input comes from.
  const sourceMissing = exp.expect.filter((e) => e.source_file && matched.has(e.key) && !matched.get(e.key).text.includes(e.source_file)).map((e) => e.key)
  return {
    id: exp.id,
    expect: exp.expect.map((e) => ({ key: e.key, rule: e.rule, family: family(e.rule), found: matched.has(e.key), at: e.at[0] })),
    decoys: exp.decoys.map((d) => ({ key: d.key, family: family(d.rule), hit: decoyFP.some((x) => x.key === d.key) })),
    decoyFP,
    unexpected,
    duplicates,
    severityOff,
    under,
    sourceMissing,
    chains,
    verdict: exp.verdict ? { want: exp.verdict, got: rep.verdict, ok: exp.verdict.includes(rep.verdict) } : null,
    fixFirst: exp.fix_first ? { ok: exp.fix_first.some((k) => idOf(k) && idOf(k) === rep.fixFirst) } : null,
    ledger: rep.ledger,
    falseClean,
    leaks,
  }
}

export function summarize(results, baseline = null) {
  const exps = results.flatMap((r) => r.expect)
  const tp = exps.filter((e) => e.found).length
  const fp = results.reduce((n, r) => n + r.decoyFP.length + r.unexpected.filter((u) => u.counted).length, 0)
  const decoys = results.flatMap((r) => r.decoys)
  const fams = {}
  for (const e of exps) ((fams[e.family] ??= { expect: 0, found: 0, decoys: 0, decoyFP: 0 }).expect++, e.found && fams[e.family].found++)
  for (const d of decoys) ((fams[d.family] ??= { expect: 0, found: 0, decoys: 0, decoyFP: 0 }).decoys++, d.hit && fams[d.family].decoyFP++)
  const s = {
    cases: results.length,
    recall: exps.length ? tp / exps.length : null,
    precision: tp + fp ? tp / (tp + fp) : null,
    tp,
    expected: exps.length,
    fp,
    decoys: decoys.length,
    decoyFP: decoys.filter((d) => d.hit).length,
    hardDecoyFP: results.reduce((n, r) => n + r.decoyFP.filter((d) => d.hard).length, 0),
    leaks: results.reduce((n, r) => n + r.leaks.length, 0),
    falseClean: results.reduce((n, r) => n + r.falseClean.length, 0),
    spotFalseClean: results.reduce((n, r) => n + r.falseClean.filter((f) => f.spot).length, 0),
    chains: [results.reduce((n, r) => n + r.chains.filter((c) => c.found).length, 0), results.reduce((n, r) => n + r.chains.length, 0)],
    verdicts: [results.filter((r) => r.verdict?.ok).length, results.filter((r) => r.verdict).length],
    fixFirst: [results.filter((r) => r.fixFirst?.ok).length, results.filter((r) => r.fixFirst).length],
    ledgers: results.filter((r) => r.ledger).length,
    severityOff: results.reduce((n, r) => n + r.severityOff.length, 0),
    under: results.reduce((n, r) => n + r.under.length, 0),
    sourceMissing: results.reduce((n, r) => n + r.sourceMissing.length, 0),
    families: fams,
  }
  const fail = []
  if (s.leaks) fail.push(`${s.leaks} secret leak(s)`)
  if (s.hardDecoyFP) fail.push(`${s.hardDecoyFP} CONFIRMED MEDIUM+ finding(s) on safe code`)
  if (s.spotFalseClean) fail.push(`${s.spotFalseClean} false clean on a spot-checked rule`)
  if (baseline?.recall != null && s.recall != null && s.recall < baseline.recall) fail.push(`recall ${fmt(s.recall)} below baseline ${fmt(baseline.recall)}`)
  if (baseline?.precision != null && s.precision != null && s.precision < baseline.precision) fail.push(`precision ${fmt(s.precision)} below baseline ${fmt(baseline.precision)}`)
  s.fail = fail
  return s
}
const fmt = (x) => (x == null ? "n/a" : x.toFixed(2))

function score(out, args) {
  const json = args.includes("--json")
  const bi = args.indexOf("--baseline")
  const baseline = bi >= 0 ? JSON.parse(readFileSync(args[bi + 1], "utf8")) : null
  const ans = (id, f) => path.join(out, ".answers", id, f)
  const dirs = readdirSync(out, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(ans(e.name, "expected.json")))
  if (!dirs.length) die(`no materialized cases in ${out}`)
  const results = []
  const missing = []
  for (const d of dirs) {
    const base = path.join(out, d.name)
    if (!existsSync(path.join(base, "report.md"))) {
      missing.push(d.name)
      continue
    }
    const secrets = existsSync(ans(d.name, "secrets.json")) ? JSON.parse(readFileSync(ans(d.name, "secrets.json"), "utf8")) : {}
    results.push(scoreCase(JSON.parse(readFileSync(ans(d.name, "expected.json"), "utf8")), readFileSync(path.join(base, "report.md"), "utf8"), secrets))
  }
  const s = summarize(results, baseline)
  if (missing.length) s.fail.push(`no report.md for ${missing.join(" ")}`)
  if (json) console.log(JSON.stringify({ summary: s, results }, null, 2))
  else {
    console.log(`EVAL ${s.cases} cases · recall ${fmt(s.recall)} (${s.tp}/${s.expected}) · precision ${fmt(s.precision)} (${s.tp}/${s.tp + s.fp}) · decoy FP ${s.decoyFP}/${s.decoys} (hard ${s.hardDecoyFP}) · leaks ${s.leaks}`)
    for (const [k, v] of Object.entries(s.families).sort())
      console.log(`FAMILY ${k} · recall ${v.expect ? fmt(v.found / v.expect) : "n/a"} (${v.found}/${v.expect}) · decoy FP ${v.decoyFP}/${v.decoys}`)
    for (const r of results) {
      for (const e of r.expect.filter((e) => !e.found)) console.log(`MISS ${r.id} ${e.key} ${e.rule} ${e.at.file}${e.at.lines ? ":" + e.at.lines[0] : " (history)"}`)
      for (const d of r.decoyFP) console.log(`DECOY-FP ${r.id} ${d.key} ${d.rule} ${d.severity} ${d.confidence ?? ""}${d.hard ? " HARD" : ""}`)
      for (const u of r.unexpected) console.log(`UNEXPECTED ${r.id} ${u.rule} ${u.loc} ${u.severity}${u.counted ? "" : " (not counted)"}`)
      for (const f of r.falseClean) console.log(`FALSE-CLEAN ${r.id} ${f.key} ${f.rule}`)
      for (const k of r.under) console.log(`UNDERRATED ${r.id} ${k}`)
      for (const k of r.sourceMissing) console.log(`NO-SOURCE ${r.id} ${k} (cross-file finding does not name its source file)`)
      for (const k of r.leaks) console.log(`LEAK ${r.id} ${k}`)
    }
    console.log(
      `QUALITY severity off ${s.severityOff} · underrated ${s.under} · source named ${s.sourceMissing} missing · chains ${s.chains.join("/")} · verdicts ${s.verdicts.join("/")} · fix-first ${s.fixFirst.join("/")} · ledgers ${s.ledgers}/${s.cases} · false clean ${s.falseClean}`,
    )
    console.log(`RESULT ${s.fail.length ? `FAIL · ${s.fail.join(" · ")}` : "PASS"}`)
  }
  process.exit(s.fail.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b, ...rest] = process.argv.slice(2)
  if (cmd === "materialize" && a && b) materialize(a, b, rest)
  else if (cmd === "score" && a) score(a, [b, ...rest].filter(Boolean))
  else die("usage: eval.mjs materialize <ground-truth.json> <out-dir> [<case-id>…] | score <out-dir> [--baseline <file>] [--json]")
}
