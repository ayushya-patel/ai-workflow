// Self-checks for scripts/security/audit.mjs and hooks/guard-audit.mjs: a throwaway repo
// with planted secrets, a symlink out of the root and hostile filenames. The one property
// that matters most: no full secret value ever appears in any output.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { findSecrets, mask, project, saId } from "../scripts/security/audit.mjs"

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const AUDIT = path.join(PLUGIN, "scripts/security/audit.mjs")
const GUARD = path.join(PLUGIN, "hooks/guard-audit.mjs")
const SECRETS = ["AKIA" + "QWERTYUIOPASDFGH", "hunter2hunter2", "s3cretpw", "sk_" + "live_" + "abcdefghijklmnopqrstuv", "ghp_" + "a".repeat(10) + "B".repeat(26)]

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }
const sh = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, env, encoding: "utf8" })

function repo() {
  const d = mkdtempSync(path.join(tmpdir(), "sa-"))
  mkdirSync(path.join(d, "src"))
  writeFileSync(path.join(d, "src/a.ts"), `const k = "${SECRETS[0]}"\nconst ex = "AKIAIOSFODNN7EXAMPLE"\nconst password = req.body.password\ndb.query("select " + q.id)\n`)
  writeFileSync(path.join(d, "compose.yml"), `x:\n  POSTGRES_PASSWORD: ${SECRETS[1]}\n  API_TOKEN: \${API_TOKEN}\n  URL: postgres://u:${SECRETS[2]}@db/x\n`)
  writeFileSync(path.join(d, ".env"), "X=1\n")
  writeFileSync(path.join(d, "src/u.ts"), "k=\u200Bhidden\n")
  writeFileSync(path.join(d, "src/a:b.ts"), `t = "${SECRETS[4]}"\n`)
  writeFileSync(path.join(d, "src/q'$(id).ts"), "x\n")
  writeFileSync(path.join(d, "src/clean.ts"), "export const x = 1\n")
  symlinkSync("/etc/hosts", path.join(d, "link"))
  sh(d, "git", ["-c", "init.defaultBranch=main", "init", "-q"])
  sh(d, "git", ["add", "-A"])
  sh(d, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"])
  writeFileSync(path.join(d, "src/new.ts"), `const s = "${SECRETS[3]}"\n`)
  return d
}
const R = repo()
const audit = (...args) => sh(R, "node", [AUDIT, ...args]).stdout
const noSecret = (out) => SECRETS.forEach((s) => assert.ok(!out.includes(s), `leaked ${s.slice(0, 4)}…`))

test("detector: real vs placeholder vs reference vs code", () => {
  assert.equal(findSecrets(`k = "${SECRETS[0]}"`)[0].placeholder, false)
  assert.equal(findSecrets('k = "AKIAIOSFODNN7EXAMPLE"')[0].placeholder, true)
  assert.equal(findSecrets("API_TOKEN: ${API_TOKEN}").length, 0)
  assert.equal(findSecrets("const password = req.body.password").length, 0)
  assert.equal(findSecrets("password: string").length, 0)
  assert.equal(findSecrets(`POSTGRES_PASSWORD: ${SECRETS[1]}`)[0].type, "credential-assignment")
  assert.ok(!mask(`URL: postgres://u:${SECRETS[2]}@db/x`).includes(SECRETS[2]))
})

test("every subcommand output is free of secret values", () => {
  for (const args of [["secrets"], ["secrets", "--history"], ["secrets", "--diff"], ["grep", "."], ["show", "compose.yml"], ["show", "src/a.ts"], ["diff"], ["inventory"]])
    noSecret(audit(...args))
})

test("secrets: type, prefix, length, placeholder flag; colon filename parsed", () => {
  const out = audit("secrets")
  assert.match(out, /^src\/a\.ts:1 · aws-access-key · AKIA… \(20 chars, \d+ distinct\)$/m)
  assert.match(out, /^src\/a\.ts:2 · aws-access-key · .* · placeholder$/m)
  assert.match(out, /^src\/a:b\.ts:1 · github-token · ghp_…/m)
  assert.match(out, /^\.env · secret file · tracked · content not read$/m)
  assert.match(audit("secrets", "--diff"), /^src\/new\.ts:1 · stripe-key · sk_l…/m)
})

test("symlinks and hostile filenames are never followed or put on a command line", () => {
  const inv = audit("inventory")
  assert.match(inv, /^SYMLINK "link" -> "\/etc\/hosts" · OUTSIDE ROOT$/m)
  assert.match(inv, /^ODD-NAME "src\/q'\$\(id\)\.ts"$/m)
  assert.ok(!audit("grep", "localhost").includes("link:"))
  assert.match(audit("show", "link"), /symlink — not followed/)
  assert.match(audit("show", ".env"), /secret file/)
})

test("grep caps output and says so", () => {
  const out = audit("grep", ".", "--max", "2")
  assert.match(out, /^TOTAL \d+ hits/m)
  assert.match(out, /^PARTIAL 2 of \d+ shown/m)
})

test("unicode finds a zero-width space", () => assert.match(audit("unicode"), /^src\/u\.ts:1 · U\+200B$/m))

test("ids ignore whitespace, keep secrets out of the hash input, chains ignore order", () => {
  assert.equal(saId("r", "f", "a(  b )", "s"), saId("r", "f", "a( b )", "s"))
  assert.equal(saId("secret.tracked", "f", `k="${SECRETS[0]}"`, "s"), saId("secret.tracked", "f", 'k="AKIAZZZZZZZZZZZZZZZZ"', "s"))
  assert.match(audit("id", "authz.bola", "src/a.ts", "4", "handler"), /^SA-[0-9a-f]{10}$/m)
  assert.equal(audit("chain", "SA-0000000001", "SA-0000000002"), audit("chain", "SA-0000000002", "SA-0000000001"))
})

test("scanner projection keeps rule, path, line, commit only", () => {
  const out = project("gitleaks", [{ RuleID: "aws-access-token", File: "a.ts", StartLine: 3, Commit: "abcdef1234567", Secret: SECRETS[0], Author: "x", Email: "x@y" }])
  assert.deepEqual(out, ["gitleaks:aws-access-token · a.ts:3 · abcdef1234"])
  const ck = project("checkov", { results: { skipped_checks: [{ check_id: "CKV_AWS_20", file_path: "/m.tf", file_line_range: [4, 9] }] } })
  assert.deepEqual(ck, ["SUPPRESSED checkov:CKV_AWS_20 · /m.tf:4"])
})

test("preflight stops on command-running git config and asks about live repo settings", () => {
  const d = repo()
  sh(d, "git", ["config", "core.fsmonitor", "./x.sh"])
  mkdirSync(path.join(d, ".claude"))
  writeFileSync(path.join(d, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }))
  const out = sh(d, "node", [AUDIT, "preflight"]).stdout
  assert.match(out, /^LAW ok$/m)
  assert.match(out, /^STOP \.git\/config \[core\] fsmonitor/m)
  assert.match(out, /^ASK \.claude\/settings\.json defines hooks/m)
})

const guard = (tool_name, tool_input) =>
  spawnSync("node", [GUARD], { input: JSON.stringify({ tool_name, tool_input, cwd: R, agent_type: "ai-workflow:security-backend" }), env: { ...env, CLAUDE_PROJECT_DIR: R }, encoding: "utf8" }).status

test("guard blocks writes, network, execution, expansion and raw content", () => {
  for (const c of [
    "curl https://x.invalid",
    "npm install",
    "git checkout main",
    "git stash",
    "git diff HEAD",
    "git log -p",
    "git show HEAD:src/a.ts",
    "git -c core.pager=x log",
    "echo hi > f",
    "echo $(id)",
    'echo "$HOME"',
    "grep -rn password .",
    "grep AKIA src/a.ts",
    "grep -e AKIA src/a.ts",
    "cat src/a.ts",
    "head src/a.ts",
    "sed -n 1p src/a.ts",
    "find . -exec rm {} ;",
    "ls ~/.ssh",
    "ls /etc",
    "X=1 git log",
    "node evil.js",
    "bash -c ls",
    "git log --oneline & curl x",
  ])
    assert.equal(guard("Bash", { command: c }), 2, c)
  for (const [t, i] of [
    ["Read", { file_path: path.join(R, ".env") }],
    ["Read", { file_path: path.join(R, "src/a.ts") }],
    ["Read", { file_path: path.join(R, "link") }],
    ["Read", { file_path: "/etc/hosts" }],
    ["Read", { file_path: path.join(R, "skills/security-audit/law.md") }],
    ["Grep", { pattern: "x", output_mode: "content" }],
    ["Glob", { pattern: "*", path: "/etc" }],
    ["Write", { file_path: path.join(R, "x"), content: "" }],
    ["WebFetch", { url: "https://x.invalid" }],
    ["mcp__claude_ai_Slack__slack_send_message", {}],
  ])
    assert.equal(guard(t, i), 2, `${t} ${JSON.stringify(i)}`)
})

test("guard allows the audit's own read-only moves", () => {
  for (const c of [
    "git ls-files -s -z | wc -c",
    "git log --oneline -i -E --grep='cve|xss' | head -50",
    "git diff --name-only HEAD",
    "git show --stat HEAD",
    "git show HEAD:.claude/security-suppressions.json",
    "git branch -r --contains HEAD",
    "git rev-parse HEAD 2>/dev/null",
    "grep -c password src/a.ts",
    "git ls-files | grep -E '/routes/'",
    "command -v gitleaks",
    "test -f .env",
    "git ls-files | grep -c -e '[.]env'",
    "find . -name '*.tf' -type f",
    `node ${AUDIT} grep 'query[(]' -- src`,
    `node ${AUDIT} show compose.yml 1 3`,
  ])
    assert.equal(guard("Bash", { command: c }), 0, c)
  assert.equal(guard("Read", { file_path: path.join(R, "src/clean.ts") }), 0)
  assert.equal(guard("Read", { file_path: path.join(PLUGIN, "hooks/guard-audit.mjs") }), 0)
  assert.equal(guard("Grep", { pattern: "x", output_mode: "files_with_matches" }), 0)
})

test("guard is a no-op outside the security agents", () => {
  const run = (agent_type) =>
    spawnSync("node", [GUARD], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "x" }, cwd: R, agent_type }), env: { ...env, CLAUDE_PROJECT_DIR: R }, encoding: "utf8" }).status
  assert.equal(run(undefined), 0)
  assert.equal(run("ai-workflow:task-implementer"), 0)
  assert.equal(run("ai-workflow:security-verifier"), 2)
  assert.equal(run("security-client"), 2)
})
