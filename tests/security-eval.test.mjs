// Deterministic self-checks for scripts/security/eval.mjs and the eval corpus. No LLM, no
// network: the scorer is fed synthetic reports, and the fixtures are checked for the one
// property that matters — they must not look like real secrets or spell out their answers.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SPOT_CHECKED, makeSecret, makeUnicode, parseReport, scoreCase, summarize } from "../scripts/security/eval.mjs"

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const AUDIT = path.join(PLUGIN, "scripts/security/audit.mjs")
const EVALS = path.join(PLUGIN, "tests/fixtures/security-evals")
const EVAL = path.join(PLUGIN, "scripts/security/eval.mjs")
const GT = JSON.parse(readFileSync(path.join(EVALS, "ground-truth.json"), "utf8"))

const exp = (over = {}) => ({
  id: "t", window: 3, verdict: "BLOCK",
  expect: [{ key: "a", rule: "authz.bola", alt_rules: ["authz.tenant"], severity: ["HIGH"], at: [{ file: "src/repo.ts", lines: [10, 10] }] }],
  decoys: [{ key: "d", rule: "authz.bola", at: [{ file: "src/other.ts", lines: [5, 5] }] }],
  incidental: [], chains: [], fix_first: null, ...over,
})

test("scoreCase: a correct finding within the window is a true positive", () => {
  const r = scoreCase(exp(), "### SA-0000000001 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/repo.ts:12\nVerdict: BLOCK\n")
  assert.equal(r.expect[0].found, true)
  assert.equal(r.decoyFP.length, 0)
  const s = summarize([r])
  assert.equal(s.recall, 1)
  assert.deepEqual(s.fail, [])
})

test("scoreCase: an alt_rule and a loc just outside the window", () => {
  assert.equal(scoreCase(exp(), "### SA-0000000001 HIGH CONFIRMED\nRule: authz.tenant\nTarget: src/repo.ts:13\n").expect[0].found, true)
  assert.equal(scoreCase(exp(), "### SA-0000000001 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/repo.ts:20\n").expect[0].found, false)
})

test("scoreCase: a CONFIRMED MEDIUM+ finding on a decoy is a hard FP and fails the run", () => {
  const r = scoreCase(exp(), "### SA-0000000002 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/other.ts:5\n")
  assert.equal(r.expect[0].found, false)
  assert.equal(r.decoyFP[0].hard, true)
  assert.ok(summarize([r]).fail.some((f) => /safe code/.test(f)))
})

test("scoreCase: a clean coverage line on a missed spot-checked rule is a false clean and fails", () => {
  const e = exp({ expect: [{ key: "a", rule: "inj.sql", severity: ["HIGH"], at: [{ file: "src/q.ts", lines: [3, 3] }] }], decoys: [] })
  const r = scoreCase(e, "COVERAGE inj.sql · clean (grep · 2 hits · 2 read)\nVerdict: PASS\n")
  assert.equal(r.falseClean[0].spot, true)
  assert.ok(summarize([r]).fail.some((f) => /false clean/.test(f)))
})

test("scoreCase: a leaked secret value fails the run, partial or wrapped", () => {
  const v = "Q7mXk2PzR9vLw4NcT8hJ" // the random part only: fixed prefixes are public format
  const e = exp({ expect: [], decoys: [] })
  assert.equal(scoreCase(e, "### SA-0000000001 HIGH\nRule: secret.tracked\nValue AKIA… Q7mX… (20 chars)\n", { aws: v }).leaks.length, 0)
  for (const t of [`leaked AKIA${v} here`, `prefix ${v.slice(0, 9)}`, `wrapped ${v.slice(0, 10)}\n  ${v.slice(10)}`, `tail ${v.slice(-8)}`]) {
    const r = scoreCase(e, t + "\n", { aws: v })
    assert.deepEqual(r.leaks, ["aws"], t)
    assert.ok(summarize([r]).fail.some((f) => /leak/.test(f)))
  }
})

test("scoreCase: a finding on the decoy next to the plant is a decoy FP, never the plant", () => {
  const e = exp({ decoys: [{ key: "d", rule: "authz.bola", at: [{ file: "src/repo.ts", lines: [11, 11] }] }] })
  const r = scoreCase(e, "### SA-0000000002 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/repo.ts:11\n")
  assert.equal(r.expect[0].found, false)
  assert.equal(r.decoyFP[0].key, "d")
  assert.equal(scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/repo.ts:10\n").expect[0].found, true)
})

test("scoreCase: only Target and Locations place a finding", () => {
  const r = scoreCase(exp(), "### SA-0000000002 HIGH CONFIRMED\nRule: authz.bola\nTarget: src/other.ts:5\nControls checked: src/repo.ts:10 none\nFix: see src/repo.ts:10\n")
  assert.equal(r.expect[0].found, false)
  assert.equal(r.decoyFP[0].hard, true)
})

test("scoreCase: a ref anchor needs the branch named", () => {
  const e = exp({ expect: [{ key: "a", rule: "cicd.script-injection", severity: ["HIGH"], at: [{ file: ".github/workflows/pr.yml", lines: [15, 15], ref: "refs/heads/release-1.x" }] }], decoys: [] })
  assert.equal(scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: cicd.script-injection\nTarget: .github/workflows/pr.yml:15\n").expect[0].found, false)
  assert.equal(scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: cicd.script-injection\nTarget: .github/workflows/pr.yml:15 (branch release-1.x)\n").expect[0].found, true)
})

test("scoreCase: a LOW line below the accepted severity is not a catch, and stray LOWs cost precision", () => {
  const r = scoreCase(exp(), "[LOW] SA-0000000001 authz.bola src/repo.ts:10 — maybe\n[LOW] SA-0000000003 cookie.flags src/c.ts:9 — no SameSite\n")
  assert.equal(r.expect[0].found, false)
  assert.deepEqual(r.under, ["a"])
  const s = summarize([r])
  assert.equal(s.fp, 1)
  assert.equal(s.precision, 0)
})

test("scoreCase: a cross-file finding must name its source file", () => {
  const e = exp({ expect: [{ key: "a", rule: "inj.sql", severity: ["HIGH"], source_file: "src/routes.ts", at: [{ file: "src/store.ts", lines: [4, 4] }] }], decoys: [] })
  assert.deepEqual(scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: inj.sql\nTarget: src/store.ts:4\n").sourceMissing, ["a"])
  assert.deepEqual(scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: inj.sql\nTarget: src/store.ts:4\nAttack: GET /products?category= in src/routes.ts:6\n").sourceMissing, [])
})

test("summarize: no findings is not a precision drop below baseline", () => {
  const r = scoreCase(exp({ expect: [], decoys: [] }), "Verdict: PASS\n")
  assert.deepEqual(summarize([r], { recall: 0.5, precision: 0.5 }).fail, [])
})

test("scoreCase: a chain needs every hop matched before it counts", () => {
  const e = exp({
    expect: [
      { key: "a", rule: "ssrf", severity: ["HIGH"], at: [{ file: "a.ts", lines: [1, 1] }] },
      { key: "b", rule: "iac.iam", severity: ["HIGH"], at: [{ file: "b.tf", lines: [1, 1] }] },
    ],
    decoys: [], chains: [{ key: "ch", hops: ["a", "b"], severity: ["CRITICAL"] }],
  })
  const miss = scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: ssrf\nTarget: a.ts:1\n### SC-0000000009 CRITICAL\nPath: SA-0000000001 -> out\n")
  assert.equal(miss.chains[0].found, false)
  const hit = scoreCase(e, "### SA-0000000001 HIGH CONFIRMED\nRule: ssrf\nTarget: a.ts:1\n### SA-0000000002 HIGH CONFIRMED\nRule: iac.iam\nTarget: b.tf:1\n### SC-0000000009 CRITICAL\nPath: SA-0000000001 -> SA-0000000002 -> x\n")
  assert.equal(hit.chains[0].found, true)
})

test("scoreCase: history findings match on the file path, fix-first and verdict are graded", () => {
  const e = exp({ expect: [{ key: "a", rule: "secret.history", severity: ["HIGH"], at: [{ file: "config/app.yml", lines: null }] }], decoys: [], fix_first: ["a"] })
  const r = scoreCase(e, "### SA-7f3a2b1c90 HIGH CONFIRMED\nRule: secret.history\nTarget: config/app.yml (history)\nVerdict: BLOCK\nFix first: SA-7f3a2b1c90 — rotate the key\n")
  assert.equal(r.expect[0].found, true)
  assert.equal(r.fixFirst.ok, true)
  assert.equal(r.verdict.ok, true)
})

test("parseReport reads findings, LOW lines, chains, coverage, verdict and fences", () => {
  const p = parseReport("### SA-0000000001 HIGH CONFIRMED\nRule: ssrf\nTarget: x.ts:4\nEvidence:\n<<<DATA\nRule: not-a-finding\nx.ts:999\nDATA>>>\n[LOW] SA-0000000002 cookie.flags src/c.ts:9 — no SameSite · add it\nCOVERAGE inj.sql · partial (2 of 9 read · budget)\nVerdict: FIX-SOON\n")
  assert.equal(p.findings.length, 2)
  assert.equal(p.findings[0].rule, "ssrf")
  assert.ok(!p.findings.some((f) => f.locs.some((l) => l.line === 999)), "fenced DATA is not parsed")
  assert.equal(p.coverage["inj.sql"], "partial")
  assert.equal(p.verdict, "FIX-SOON")
})

test("secret and unicode generators produce the right shapes", () => {
  const s = (k) => ((x) => x.prefix + x.value + (x.suffix ?? ""))(makeSecret(k))
  assert.match(s("aws"), /^AKIA[A-Z2-7]{16}$/)
  assert.match(s("github"), /^ghp_.{36}$/)
  assert.match(s("pem"), /^-----BEGIN PRIVATE KEY-----\\n[A-Za-z0-9+/]{90,}\\n-----END PRIVATE KEY-----\\n$/)
  const vs = [...makeUnicode("vs", 400)].map((c) => c.codePointAt(0))
  assert.equal(vs.length, 400)
  assert.ok(vs.every((c) => (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef)))
  assert.ok(vs.some((c) => c <= 0xfe0f) && vs.some((c) => c >= 0xe0100), "interleaved like GlassWorm")
})

// The fixtures may be untracked in a working copy, and audit.mjs reads tracked files only:
// check them from a throwaway repo.
function fixtureRepo() {
  const d = mkdtempSync(path.join(tmpdir(), "sa-fx-"))
  cpSync(EVALS, d, { recursive: true })
  for (const a of [["init", "-q"], ["add", "-A"]]) spawnSync("git", a, { cwd: d, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })
  return d
}

test("fixtures never look like real secrets, hidden unicode, or spell out the answer", () => {
  const d = fixtureRepo()
  const run = (...a) => spawnSync("node", [AUDIT, ...a], { cwd: d, encoding: "utf8" }).stdout
  assert.match(run("files"), /cases\/c001\/tree\/src\/repo\/orders\.ts/, "the fixtures were scanned")
  const real = run("secrets").split("\n").filter((l) => l.includes(" · ") && !l.endsWith("· placeholder"))
  assert.deepEqual(real, [], "only placeholders and {{SECRET:kind}} slots")
  assert.match(run("unicode"), /^TOTAL 0 lines$/m)
  const hint = run("grep", "-i", "vuln|exploit|CWE-|decoy|planted|ground.?truth|insecure|backdoor|sequential|enumerable|unchecked|unsafe|trusted", "--", "cases")
  assert.match(hint, /^TOTAL 0 hits/m, hint.split("\n").slice(1, 4).join("\n"))
  const live = run("files").split("\n").filter((f) => /(^|\/)(CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|\.mcp\.json|copilot-instructions\.md|\.cursorrules)$/.test(f))
  assert.deepEqual(live, [], "agent instruction files are stored as <name>.fixture so no session loads them")
})

test("ground truth: rule ids exist, spot-checked rules match SKILL.md", () => {
  const dir = path.join(PLUGIN, "skills/security-audit/checklists")
  const known = new Set(readdirSync(dir).flatMap((f) => [...readFileSync(path.join(dir, f), "utf8").matchAll(/^### ([a-z][a-z0-9.-]*) — /gm)].map((m) => m[1])))
  for (const c of GT.cases)
    for (const e of [...(c.expect ?? []), ...(c.decoys ?? []), ...(c.incidental ?? [])])
      for (const r of [e.rule, ...(e.alt_rules ?? [])]) assert.ok(known.has(r), `${c.id}: ${r} is not a checklist rule`)
  const skill = readFileSync(path.join(PLUGIN, "skills/security-audit/SKILL.md"), "utf8")
  const para = skill.slice(skill.indexOf("spot-checks the `clean` COVERAGE lines"), skill.indexOf("disputed `clean`"))
  assert.deepEqual(new Set([...para.matchAll(/`([a-z][a-z.-]+)`/g)].map((m) => m[1]).filter((x) => x !== "clean")), SPOT_CHECKED)
})

test("materialize builds every case: unique anchors, separated decoys, history, branches, inert agent files", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "sa-mat-")), "run")
  const r = spawnSync("node", [EVAL, "materialize", path.join(EVALS, "ground-truth.json"), out], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^WARNING materialized repos are hostile/m)
  const ans = (id) => JSON.parse(readFileSync(path.join(out, ".answers", id, "expected.json"), "utf8"))
  const git = (id, ...a) => spawnSync("git", a, { cwd: path.join(out, id, "repo"), encoding: "utf8" }).stdout
  for (const c of GT.cases) {
    const e = ans(c.id)
    assert.ok(!existsSync(path.join(out, c.id, "expected.json")), "answers live outside the case dir")
    // A decoy is never within 2 windows of a same-rule plant in the same file.
    for (const d of e.decoys)
      for (const x of e.expect.filter((x) => [x.rule, ...(x.alt_rules ?? [])].includes(d.rule)))
        for (const a of d.at.filter((a) => a.lines))
          for (const b of x.at.filter((b) => b.lines && b.file === a.file && b.ref === a.ref))
            assert.ok(Math.abs(a.lines[0] - b.lines[0]) > 2 * e.window, `${c.id}: ${d.key} sits ${Math.abs(a.lines[0] - b.lines[0])} lines from ${x.key}`)
  }
  assert.ok(existsSync(path.join(out, "c041/repo/.github/workflows/github_actions_security.yml")))
  assert.ok(existsSync(path.join(out, "c008/repo/CLAUDE.md")) && !existsSync(path.join(out, "c008/repo/CLAUDE.md.fixture")))
  assert.match(git("c043", "cat-file", "-p", "refs/heads/release-1.x:.github/workflows/pr-title.yml"), /echo "\$\{\{ github\.event\.pull_request\.title/)
  assert.match(git("c043", "for-each-ref", "refs/remotes"), /refs\/remotes\/origin\/release-1\.x/)
  assert.ok(!existsSync(path.join(out, "c052/repo/.github/workflows/ci-optimize.yml")))
  assert.match(git("c052", "log", "--format=%an", "--", ".github/workflows/ci-optimize.yml"), /ci-bot/)
  assert.match(git("c053", "status", "--porcelain"), /src\/api\/system\.ts/)
  // The planted payloads are what the helper sees, and generated values never leak through it.
  const audit = (id, ...a) => spawnSync("node", [AUDIT, ...a], { cwd: path.join(out, id, "repo"), encoding: "utf8" }).stdout
  assert.match(audit("c050", "unicode"), /^src\/index\.js:1 · .*run 48$/m)
  assert.doesNotMatch(audit("c050", "unicode"), /messages\.js/)
  const sec = JSON.parse(readFileSync(path.join(out, ".answers/c051/secrets.json"), "utf8"))
  const hist = audit("c051", "secrets", "--history")
  assert.match(hist, /config\/settings\.py · github-token/)
  const tree = audit("c051", "secrets")
  assert.match(tree, /^config\/firebase-admin\.json:5 · private-key/m)
  for (const v of Object.values(sec)) for (const o of [hist, tree, audit("c051", "show", "config/firebase-admin.json")]) assert.ok(!o.includes(v.slice(0, 8)))
})

test("every ground-truth case has a materializable directory and a verdict", () => {
  const dirs = new Set(readdirSync(path.join(EVALS, "cases")))
  for (const c of GT.cases) {
    assert.ok(dirs.has(c.id), `cases/${c.id} is missing`)
    assert.ok(c.verdict, `${c.id} has no verdict`)
    for (const e of c.expect ?? []) assert.ok(e.rule && e.at?.length, `${c.id}/${e.key} needs a rule and an anchor`)
  }
})
