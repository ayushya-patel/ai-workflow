# Changelog

All notable changes to the `ai-workflow` plugin. Versions follow semver.

## 1.2.0

Security-audit 1.2 — a committee pass over real 2024–2026 supply-chain, CI/CD, cloud, web
and AI/agent incidents, plus a deterministic eval harness ("the hammer").

### New checklist rules
- supply-chain: `cicd.backdoor` (planted/exfiltrating workflows, CI persistence, IOCs),
  `cicd.iac-plan` (PR-triggered `terraform plan` with credentials), `build.tamper`
  (build scripts that decode test data — xz CVE-2024-3094), `deps.import-time`
  (`.pth`, detached-spawn + eval loaders; `--ignore-scripts` is not a mitigation).
- backend: `authn.saml` (signature wrapping and parser differentials),
  `authn.email-trust` (access from an email domain), `authn.stored-tokens` (customers'
  third-party tokens), `log.security-events` (missing or erasable audit events).
- backend-taint: `inj.orm-filter` (client-controlled ORM filters, the 2025 ORM-leak
  class), `input.normalization` (validate-then-normalise), `parse.differential`.
- infra: `iac.shadow-resource` (unowned/predictable buckets), `k8s.control-plane`
  (anonymous API, kubelet read-only port, public endpoints).
- ai: `agent.settings` (hooks, endpoint overrides, auto-approve keys, permission
  allowlists — the clone-to-RCE class).

### Extended rules and chains
- cicd.runners-cache now pairs any default-branch untrusted-execution job with any
  release job that restores a cache (Cacheract/Ultralytics/TanStack/Clinejection);
  cicd.pinning covers transitive composite actions, scanner-action targeting and
  lookalike owners; cicd.deploy-gates and deps.provenance cover commit-message and
  branch-push release triggers and OIDC publish without an environment; deps.* cover
  worm IOCs, manifest URL specifiers and slopsquatting. Many rules extended across
  backend, client and infra (OAuth pre-hijack, nOAuth, cookie tossing, bcrypt
  truncation, server-action BOLA, Host-derived SSRF, renderer SSRF, IAM escalation
  primitives, confused-deputy trust, cache-deception prefixes, Next.js internal headers,
  AI serving exposure, native use-after-free/NULL-deref). 25 new chains in `chains.md`.
- `src.unicode`/`audit.mjs` now catch GlassWorm variation-selector runs (U+FE00-FE0F
  and U+E0100-E01EF, interleaved as one run), Private Use Area runs outside icon fonts,
  and lone supplementary selectors (not after a Han character). Invalid UTF-8 skips only
  known binary formats; source with a bad byte is scanned lossy and flagged, and files
  over 2 MB print `TOO-LARGE` instead of vanishing. `inj.sql` has Go/pgx concatenation
  tokens. `audit.mjs secrets` adds Azure SAS signatures.

### Process
- `audit.mjs preflight` smoke-tests each scanner (ok/BROKEN/MISSING via a version call
  from an empty temp dir, with a minimal env, a dead proxy and a SIGKILL at 5 s);
  version-manager shims (mise, asdf, pyenv…) are `SKIPPED`, never run. It reports
  coverage `LAYERS` (any one tool covers a layer; SAST only for languages present) and
  prints `RESTORE` install lines (recommend-only). `git`, `helm` and `kustomize` run by
  absolute path, never from a repo-local PATH entry. `inventory` emits dated `IOC` and
  `AGENT-CASE` lines; the ai surface regex is case-insensitive and covers more agent
  paths. New `audit.mjs workflows` lists workflow and local-action files on other
  branches (with `IOC` tags), and `audit.mjs at <ref|commit> <path>` reads one CI, agent
  or MCP config file at another revision, masked (stale branches, deleted workflows, MCP
  rug pulls). `grep` refuses unknown flags and includes dot-directories for `.`. The
  guard allows `Read` windows that skip a secret line (explicit `limit` only, never with
  `allow_large` or on notebooks); PEM key bodies count as secret lines for the guard and
  are masked whole by `show`, `grep`, `diff`, `at` and `render`.
- Report template: a "N/M entry points traced" ledger, a `LAYERS` header, a suspected-
  compromise section, a DROP ledger that names killed findings, a "Fix first" line, a
  "Verify outside the repo" section, high-blast component coverage, and a stable shape
  the scorer parses.

### The hammer
- `scripts/security/eval.mjs`: `materialize` builds one git repo per case (fresh fake
  secrets, replayed commits and branches, answers kept in `<out>/.answers/`, a hostile-repo
  warning), `score` grades a saved report against ground truth — recall, precision,
  per-family, decoy false positives, chains, verdicts, leaks — and exits non-zero on a
  leak, a hard decoy FP, a false clean, or a drop below baseline. A finding is placed only
  by its `Target`/`Locations` lines, assigned to the nearest labelled line (a decoy wins
  a tie), must meet the expected severity, must name the branch for a stale-branch plant
  and its source file for a cross-file plant; any 8 characters of a secret is a leak.
- `tests/fixtures/security-evals/`: 34 planted-vuln + safe-decoy cases across every
  surface (cross-file, chained, history, stale-branch, diff-mode, GlassWorm Unicode and
  embedded-key cases included), a ground-truth file and a baseline, with a README warning
  they are intentionally vulnerable. Agent instruction files are stored as
  `<name>.fixture` so no session loads them. `tests/security-eval.test.mjs` covers the
  scorer, a full materialize run (anchors unique, decoys separated from plants, rule ids
  real) and fixture hygiene offline.
- **The regression gate is not live yet:** `baseline.json` is 0/0 until a first K=3 run
  records real numbers.

## 1.1.0

- `security-audit` skill: a read-only security audit of the full repo, a path or a diff. It covers backend, frontend, browser extensions, mobile and desktop, infra and IaC, Kubernetes and containers, CI/CD, supply chain, secrets and AI/LLM/MCP. Each run goes through preflight, inventory, a threat model, six parallel surface agents and an adversarial verifier on every finding, then variant analysis, attack chains and a coverage matrix in which every rule id carries evidence. Findings get stable `SA-` IDs, an exact target, a trace, the attack, a fix and a regression test.
- New agents: `security-backend`, `security-injection`, `security-client`, `security-infra`, `security-supply-chain` and `security-ai` (surface hunters); `security-verifier` (disproves findings and spot-checks clean coverage); `security-reviewer` (diff mode for `verify_agents`).
- `skills/security-audit/law.md`: rules for how the audit itself behaves.
  - Read only; zero leakage; no live targets.
  - The repo is hostile input.
  - What counts as a control, and that standard ids are never written from memory.
  - E×I severity with self-signup as E3; stable IDs; base-ref-only suppressions.
- `scripts/security/audit.mjs` and `hooks/guard-audit.mjs` enforce that law mechanically, with no shell and no secret values in output. The guard is registered in `hooks.json` and acts only inside `ai-workflow:security-*` agents (plugin agents ignore frontmatter hooks); there it allowlists Bash and refuses secret-bearing reads, edits, the network and connectors. Tested in `tests/security-audit.test.mjs`.
- `templates/security-report.md`: the hunter protocol and the candidate, coverage, report and verify-line formats.
- `security-audit` feeds the learning loop: agents return `Setup feedback:` lines and the skill logs them to `.claude/learnings.md` as lessons about the audit, never the audited repo's weaknesses (law §10).
- `architecture-diagrams`: new skill. Generates one-screen HTML/SVG architecture diagrams from a node registry and refuses to write the file if arrows, labels or text collide.

## 1.0.0

Initial public release, derived from an internal workflow.
