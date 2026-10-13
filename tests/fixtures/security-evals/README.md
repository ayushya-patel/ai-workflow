# Security-audit eval corpus (the hammer)

**These fixtures are intentionally vulnerable.** They plant SQL injection, SSRF, IDOR,
prompt injection, exfiltrating CI workflows, insecure IaC and more, next to safe decoys
that look almost identical. **Never deploy, install, build, test, run, or open any of this
(or a materialized repo) in an IDE, and never copy it into real code** — some cases are
lifecycle scripts and import-time loaders (their hosts are `.invalid` or documentation IPs
and their binaries absent, but treat them as live). Secrets are fake, assembled at
materialize time so GitHub push protection won't flag them; nothing here is a working
credential.

The corpus measures whether `/ai-workflow:security-audit` still catches what it should.
Run it before and after any change to the checklists, agents, `audit.mjs`, the law or the
report template, and keep `recall`/`precision` from dropping below `baseline.json`.

## Layout

- `ground-truth.json` — one entry per case: the `expect` findings (rule, an `anchor`
  substring on the vulnerable line, acceptable severities), the `decoys` (safe code that
  must NOT be flagged), `incidental` rules allowed, `chains`, the `verdict`, and
  `fix_first`. `match.window` is the line tolerance (±3).
- `cases/<id>/<layer>/…` — the repo content, with real dotfile names stored as `dot-`
  (`dot-github/` → `.github/`), agent instruction files as `<name>.fixture`
  (`CLAUDE.md.fixture` → `CLAUDE.md`, so a session working in this repo never loads
  them), secrets as `{{SECRET:aws|github|stripe|password|pem}}` and hidden characters as
  `{{UNICODE:vs|bidi[:n]}}`, so the corpus itself trips no scanner. Multi-commit cases
  (history, stale branches) list `commits` with `layer`, `author`, `branch_here`,
  `remove`; diff-mode cases set `"mode": "diff"` and an `uncommitted` layer.
- Anchors must match exactly one line; a decoy sits more than two windows from any
  same-rule plant in its file. `history: true` anchors match a finding naming the file;
  `ref` anchors also need the branch named; `source_file` must appear in a cross-file
  finding. The tests enforce all of this on a full materialize.
- `baseline.json` — the recall/precision floor. **0/0 until a first K=3 run records a real
  one: until then the below-baseline gate is not live.**

Case files use neutral names and no hint words (`vuln`, `decoy`, `CWE-…`): the auditor
reads these paths, so they must not leak the answer. A test enforces that.

## Running it

```sh
cd <plugin>
# 1. Build one git repo per case outside the plugin (fresh secrets, replayed commits).
#    Answers go to /tmp/eval-run/.answers/, away from the audited repos:
node scripts/security/eval.mjs materialize tests/fixtures/security-evals/ground-truth.json /tmp/eval-run

# 2. Audit each repo and save its report. From a session started with
#    `claude --setting-sources user` (so the fixture's own .claude settings are inert),
#    for each /tmp/eval-run/<id>/repo:
#      cd /tmp/eval-run/<id>/repo
#      /ai-workflow:security-audit        # mode "diff" cases: /ai-workflow:security-audit diff
#    At the preflight ASK answer "not my repo; this session runs under --setting-sources
#    user" — the law then records it and continues. Save the printed report to
#    /tmp/eval-run/<id>/report.md

# 3. Score every report against ground truth:
node scripts/security/eval.mjs score /tmp/eval-run --baseline tests/fixtures/security-evals/baseline.json
```

`score` prints recall, precision, per-family recall and decoy false positives, chain and
verdict hit-rates, and the fix-first and ledger checks. It **exits 1** on a secret leak,
a CONFIRMED MEDIUM-or-above finding on a decoy, a false clean on a spot-checked rule, a
missing report, or a score below the baseline — so it gates a checklist change in CI.
Audits are non-deterministic: run K=3 and compare the median.

The deterministic parts (scorer, materializer, hygiene) are covered by
`node --test tests/security-eval.test.mjs`; that runs offline with no audit.

## Adding a case

Every new incident, missed finding or rejected false positive becomes a plant **and** a
decoy twin before the checklist edit, then a `ground-truth.json` entry. Update
`baseline.json` only in the same change, pasting the `score` output in the description.
