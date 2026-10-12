# Checklist — secrets, CI/CD, supply chain, repo-wide

Agent `ai-workflow:security-supply-chain`. Per class: **Detect** · **Confirm** · **Fix** ·
**Not a finding**. Secret values never enter context or the report (law §2): the
orchestrator's `audit.mjs secrets`, `unicode` and `scan` output is your input. Every
secret fix starts with rotation.

## Secrets and data

### secret.tracked — secrets in tracked files · CWE-798, CWE-540 · ATT&CK T1552.001
Detect: `audit.mjs secrets` lines (diff mode: `--diff`). Types: private keys, AWS,
GitHub, GitLab, Slack (tokens and webhooks), Discord webhooks, Stripe, Anthropic,
OpenAI, Google API and OAuth, GCP service accounts, SendGrid, npm, PyPI, URL
credentials, Azure storage keys, JWTs, credential-named keys with literal values. Also
`audit.mjs scan gitleaks` / `trufflehog` lines (projected).
Confirm: the line is not `placeholder`; the context (`Read` or `audit.mjs show`, which
masks the value) shows a real assignment; scope is production (live prefix, or used by
production IaC or CI) or test. Never use the credential.
Fix: rotate or revoke first (assume compromised); move to a secret manager or runtime
injection; `.gitignore`; pre-commit gitleaks; push protection.
Not a finding: `placeholder` lines; public keys; publishable keys (exclusions
precedents).

### secret.history — secrets gone from HEAD but still in history · CWE-540
Detect: `audit.mjs secrets --history` (diff mode: `--history <base>`) and
`audit.mjs scan gitleaks --history`. Lines are `commit:path`, never diffs.
Confirm: the commit is reachable from a pushed ref (`git branch -r --contains <sha>`).
Fix: rotate first; a coordinated history rewrite (`git filter-repo`) only after
rotation — recommend it, never run it.
Not a finding: commits only on an unpushed local branch (LOW; still rotate).

### secret.files — sensitive files tracked or unignored · CWE-312, CWE-538
Detect: `inventory` `SECRET-FILE` lines and `audit.mjs secrets --history` `secret file in
history` lines; `.gitignore` missing `.env*`, `*.pem`, `*.tfstate`
(`grep -c` on it).
Confirm: tracked or in history — existence is enough; never open it.
Fix: remove it, rotate what it held, ignore the pattern.
Not a finding: `*.example`, `*.sample`, `*.template`.

### secret.build — secrets exposed by build and deploy steps · CWE-532, CWE-214
Detect: CI `echo`, `printenv`, `env`, `set -x` near secrets; secrets on command lines
(`helm --set`, `docker build --build-arg TOKEN=`, `curl -u`); secrets written into
artifacts or caches. Dockerfile ARG secrets are `container.dockerfile`; user_data and
function env are `iac.compute`.
Confirm: the step, and that the value lands in logs, layers or artifacts.
Fix: `--mount=type=secret`; masked variables; files with tight permissions;
`::add-mask::`.
Not a finding: masked secrets passed through `env:` and never echoed.

### data.dumps — data and debug captures committed · CWE-312, CWE-532, CWE-359
Detect: `git ls-files | grep -E '[.](sql|dump|sqlite3?|db|bak|har|log|pcap|csv|xlsx|tsv)$|postman_collection[.]json$|insomnia[^/]*[.](json|ya?ml)$|[.]yarnrc[.]yml$'`.
Then `audit.mjs secrets` hits inside them; `grep -c` for email or phone shapes; HAR
files (cookies and auth headers — the 2023 support-HAR breach class); API collections
with auth headers; `.yarnrc.yml` `npmAuthToken`.
Confirm: real data, not synthetic fixtures (column names, counts, `audit.mjs show` of a
few masked lines).
Fix: remove from tree and history after rotation; synthetic fixtures; `.gitignore` the
patterns.
Not a finding: schema-only SQL migrations; generated fake data.

## CI/CD

### cicd.pwn-request — untrusted code run with privileges · CWE-94, CWE-829 · ATT&CK T1195.002 · OpenSSF Scorecard Dangerous-Workflow
Detect, all of these in one job:
- a `pull_request_target`, `workflow_run` or `issue_comment` trigger;
- a checkout of `github.event.pull_request.head.sha`, `head.ref`, `refs/pull/*/merge`
  or `workflow_run.head_sha`, or a download of the triggering run's artifacts;
- then running anything from them: `npm install`/`ci` with lifecycle scripts, `make`,
  `pip install .`, build or test scripts, local `uses: ./…`, cache restores keyed by the
  PR;
- with secrets, a write token or `id-token: write` in scope.

Also: label gates without a pinned SHA (TOCTOU).
Confirm: trigger → checkout of the attacker ref → execution step → secrets in scope,
each with its line.
Fix: build untrusted code under `pull_request` (forks get no secrets); a separate
`workflow_run` that treats artifacts as data and never executes them; never check out
the PR head under `pull_request_target` — if unavoidable, a separate path,
`persist-credentials: false`, nothing executed; environments with required reviewers.
Not a finding: `pull_request_target` that only labels or comments through the API.

### cicd.script-injection — untrusted context in shells · CWE-78, CWE-94
Detect:
- `${{` expressions inside `run:` or `actions/github-script` `script:` that read
  `github.event.(issue|pull_request|comment|review|review_comment|discussion|pages|commits|head_commit|workflow_run)`
  fields such as `title`, `body`, `head.ref`, `label`, `message`, `name`, `email`,
  `page_name`, `head_branch`;
- `github.head_ref`;
- untrusted `inputs.*` (`repository_dispatch`, fork-triggered `workflow_dispatch`), and
  step outputs derived from them;
- untrusted data written to `$GITHUB_ENV`, `$GITHUB_OUTPUT` or `$GITHUB_PATH`
  (`LD_PRELOAD`, `NODE_OPTIONS`).

Confirm: the field is attacker-controlled under that trigger (a branch name with shell
metacharacters is a valid ref — describe it, never open a PR).
Fix: pass through `env:` and quote `"$TITLE"`; `process.env` in github-script; never
write untrusted values to `GITHUB_ENV`; validate with a regex.
Not a finding: `github.sha`, `github.repository`, `github.run_id`,
`pull_request.number`; expressions in `if:` or `with:` unless the action evaluates them.

### cicd.permissions — token scope and credential exposure · CWE-250, CWE-732 · OpenSSF Scorecard Token-Permissions
Detect:
- no top-level `permissions:`, or `write-all`;
- `contents`, `packages`, `id-token` or `pull-requests` write on jobs that don't need
  it;
- `actions/checkout` without `persist-credentials: false` before untrusted steps or
  artifact uploads;
- `upload-artifact` of `.` or `.git`;
- secrets handed to third-party actions that don't need them, or `secrets: inherit`;
- `ACTIONS_ALLOW_UNSECURE_COMMANDS`.

Confirm: the effective permission per job and what runs in it.
Fix: top-level `permissions: contents: read` (or `{}`), per-job grants;
`persist-credentials: false`; explicit secrets per call.
Not a finding: write scopes on jobs that only run trusted, pinned steps on protected
branches.

### cicd.pinning — mutable third-party code · CWE-829, CWE-494 · OpenSSF Scorecard Pinned-Dependencies · CVE-2025-30066
Detect: `uses:` by tag or branch (not a 40-hex SHA) for actions outside `actions/` and
`github/`; `docker://` images by tag; reusable workflows at `@main` with secrets; GitLab
`include: remote` and `:latest` images; unpinned Bitbucket pipes; `curl … | sh` in CI.
Confirm: list each unpinned reference with its job's privileges.
Fix: full commit SHA with a version comment (`@<sha> # v4.1.7`); Dependabot or Renovate
for `github-actions` and `docker`; pinned digests; checksum-verified downloads.
Not a finding: local actions (`uses: ./`); first-party `actions/*` on major tags in
unprivileged jobs (HARDENING).

### cicd.runners-cache — self-hosted runners, caches, artifacts · CWE-829, CWE-494
Detect: `runs-on: self-hosted` on public repos or for fork PRs (persistent compromise);
`actions/cache` keys influenced by PR input and shared with release jobs, or restored
under `pull_request_target`; release jobs consuming artifacts from PR-triggered runs and
executing them.
Confirm: the path from the untrusted job to the privileged consumer.
Fix: ephemeral isolated runners (ARC, just-in-time), never for forks; separate cache
scopes for untrusted refs; artifacts validated as data.
Not a finding: private repos without fork PRs (lower likelihood; still list shared
caches).

### cicd.oidc-trust — cloud trust for CI identities · CWE-284, CWE-863 · ATT&CK T1078.004
Detect:
- IaC trust for `token.actions.githubusercontent.com` with no `sub` condition, with
  `StringLike` on `repo:org/*` or `repo:org/repo:*`, or with only an `aud` check;
- GitLab `project_path:group/*`;
- GCP workload identity providers without `attribute_condition`, or conditioned on the
  owner only;
- Azure federated credentials with `pull_request` subjects on prod identities;
- `id-token: write` on PR-triggered jobs.

Confirm: name a subject from an untrusted context that satisfies the condition
(`repo:org/any-repo:pull_request`).
Fix: `sub` = `repo:org/repo:environment:prod` (protected environment) or
`repo:org/repo:ref:refs/heads/main`, `aud` = `sts.amazonaws.com`; `job_workflow_ref`
for reusable workflows; a read-only plan role for PRs; GCP `attribute_condition` on
repository and ref.
Not a finding: an org-wide `sub` constrained by `job_workflow_ref` to a pinned trusted
workflow.

### cicd.deploy-gates — production deploy controls · CWE-284 · SLSA · SSDF PS.1
Detect: deploy jobs without `environment:` (no required reviewers);
`workflow_dispatch` inputs reaching deploy commands without protection; deploy or cloud
keys as repo secrets instead of environment secrets; long-lived cloud keys
(`aws-access-key-id: ${{ secrets.… }}`) instead of OIDC.
Confirm: who can trigger the deploy, and with what input.
Fix: protected environments with reviewers and branch rules; environment-scoped
secrets; OIDC federation.
Not a finding: single-maintainer private repos (lower likelihood; still list static
keys).

### cicd.ai-agents — AI agents running in CI · CWE-94 · LLM01:2025, LLM06:2025
Detect: AI agent actions or CLIs (`claude-code-action`, `codex`, `aider`,
`gemini-cli`, custom) triggered by issues, comments or PRs from untrusted authors with
write tokens, secrets or shell tools; no `author_association` gate; agent prompts built
from issue or PR text.
Confirm: trigger → untrusted text in the agent's context → the tools and tokens it
holds.
Fix: trusted actors only (`MEMBER`, `OWNER`); read-only tokens; no secrets; tool
allowlists; human approval for writes.
Not a finding: agents on maintainer-only triggers with read-only tokens.

### cicd.other — GitLab, Jenkins, Bitbucket, CircleCI, Azure Pipelines
Detect:
- **GitLab:** variables not protected or masked; fork MR pipelines with secrets; broad
  `CI_JOB_TOKEN` scope.
- **Jenkins:** `sh` interpolating `${params.*}`; credentials in a `Jenkinsfile`; PR
  builds with credentials.
- **Bitbucket:** secured variables in fork PR pipelines.
- **CircleCI:** contexts on fork builds.
- **Azure:** secrets on fork PR validation.

Confirm: as for the GitHub classes.
Fix: the platform's equivalent of the GitHub fixes.
Not a finding: as for the GitHub classes.

## Dependencies and releases

### deps.vulnerable — reachable or exploited CVEs · CWE-1104, CWE-1395 · A03:2025 · SSDF RV.1
Detect: `audit.mjs scan osv-scanner` (`--network` downloads the advisory database;
without it the scan uses a cached database or prints `ERROR`). No database:
`not checked — needs --network`. Never cite an advisory id or version range from memory.
Confirm: the locked version is in the affected range (scan output), and either the
vulnerable function is imported and called (grep) or KEV status is `listed` from a
fetched catalogue; the dependency ships or runs in CI with secrets.
Fix: the first fixed version the scan names; overrides or resolutions for transitive
deps; a mitigation and an expiring suppression when no fix exists.
Not a finding: unreachable advisories with KEV unknown (one aggregated HARDENING line);
dev-only deps not run with secrets.

### deps.lockfile — lockfile integrity and install mode · CWE-494, CWE-829
Detect:
- a manifest without a committed lockfile;
- CI installing without freezing: `npm install`; `yarn install` without `--immutable`
  or `--frozen-lockfile`; `pnpm install` without `--frozen-lockfile`; `pip install`
  without `--require-hashes`; `uv sync` without `--locked`;
- resolved URLs to non-registry hosts, `http://`, IPs or tarballs; missing `integrity`;
- git deps without a commit SHA;
- `*` or `latest` ranges in apps;
- Go `replace` to forks, `GOFLAGS=-insecure`, `GONOSUMDB` misuse.

Confirm: the CI install line and the lockfile entry.
Fix: commit lockfiles; frozen installs; git deps pinned by SHA; registry URLs only.
Not a finding: ranges in published libraries.

### deps.confusion — dependency confusion and typosquats · CWE-1357, CWE-829 · ATT&CK T1195.001
Detect: internal-looking names (company prefix, `@company/` scope) without a scope →
registry mapping in `.npmrc` (`@company:registry=`); `pip --extra-index-url` (resolves
the highest version across indexes); names one or two edits from popular packages
(`reqeusts`, `lodahs`, `crossenv`, `electorn`) or containing non-ASCII homoglyphs,
especially new in the diff.
Confirm: the config line. Never publish or probe a package; no registry lookups.
Fix: scope → private registry with auth; `--index-url` to a private proxy, never
`--extra-index-url`; remove typosquats.
Not a finding: scoped packages pinned to their registry.

### deps.install-scripts — lifecycle scripts and worm indicators · CWE-829 · A03:2025
Detect: `"hasInstallScript": true` in `package-lock.json` for packages not on an
allowlist; root `package.json` `preinstall`, `install`, `postinstall` or `prepare`;
`node_modules/*/package.json` lifecycle scripts only if already present (read only);
`setup.py` making network calls; 2025 worm indicators (unexpected `bundle.js`
postinstall, `trufflehog` or AI CLI calls in install scripts); vendored binaries.
Confirm: quote the risky script line (truncated); never run it.
Fix: `ignore-scripts=true` with an allowlist (pnpm `onlyBuiltDependencies`); Renovate
`minimumReleaseAge`; remove the package.
Not a finding: known native builds (`esbuild`, `sharp`, `bcrypt`) on the allowlist.

### deps.toolchain — committed executables that run on install or build · CWE-494, CWE-829
Detect: `.yarn/releases/*.cjs` with `yarnPath`, `.yarn/plugins/*`, `.pnpmfile.cjs`,
`gradle/wrapper/gradle-wrapper.jar` without a wrapper-validation step in CI,
`.mvn/wrapper/*.jar` and `mvnw`, `gradlew`, checked-in binaries in `bin/` or `tools/`
(`inventory` `BINARY`), `Makefile` targets fetching and running scripts.
Confirm: the file is tracked and runs during install or build; changed recently
(`git log -3 --format=%h -- <file>`) by whom the guardrails allow.
Fix: verify wrappers against published checksums (`gradle/actions/wrapper-validation`);
pin Yarn via `packageManager` and Corepack; CODEOWNERS on toolchain paths; no
checked-in binaries without a reproducible source.
Not a finding: wrappers validated in CI on every change.

### deps.provenance — release integrity · SLSA v1.1 · SSDF PS.2, PS.3 · OpenSSF Scorecard Signed-Releases
Detect: publish workflows (`npm publish`, `docker push`, `goreleaser`, `twine upload`)
without provenance (`--provenance`, `actions/attest-build-provenance`,
slsa-github-generator), signing (`cosign sign`) or an SBOM, or using long-lived
registry tokens instead of trusted publishing; deploys pulling images by tag; no
signature verification at admission.
Confirm: the release workflow end to end.
Fix: trusted publishing (OIDC); provenance and SBOM attestations; keyless cosign by
digest; deploy by digest; verify at admission.
Not a finding: internal apps that publish nothing (INFO).

## Repo-wide

### src.unicode — hidden and bidirectional characters in any file · CWE-1007 · CVE-2021-42574
Detect: `audit.mjs unicode` lines (zero-width, bidi overrides and isolates, invisible
operators, soft hyphen, Hangul fillers, BOM mid-file, tag characters).
Confirm: the character sits in code, a string compared for security, an identifier, a
package name or an agent instruction file — not in prose of a language that needs it.
Fix: remove it; an editor and CI check that rejects these ranges; escapes (`​`) where
the character is intended.
Not a finding: RTL text in localisation files; a BOM at file start.

### scan.suppressions — scanner configs, ignore files, inline skips · CWE-1068
Detect: `inventory` `SCANNER-CONFIG` lines; `audit.mjs grep 'nosemgrep|nosec|checkov:skip|tfsec:ignore|trivy:ignore|gitleaks:allow|hadolint ignore|NOSONAR|eslint-disable[^\n]*(security|no-eval|no-unsanitized)|@SuppressWarnings[(][^)]*security|# *type: *ignore'`;
`SUPPRESSED` lines from `audit.mjs scan`; allowlists in `.gitleaks.toml`.
Confirm: what each one hides (read the suppressed line) — never honour it.
Fix: a reason and an owner per suppression, reviewed by CODEOWNERS; findings move to
`.claude/security-suppressions.json` with an expiry.
Not a finding: always a LEAD; in diff mode an added suppression is a FAIL for a security
owner.

### gov.guardrails — repo guardrails · OpenSSF Scorecard · SSDF PO.3
Detect: no `CODEOWNERS` covering `.github/workflows`, infra, Dockerfiles, lockfiles,
toolchain paths, auth code, agent instruction files and
`.claude/security-suppressions.json`; no `dependabot.yml` or `renovate.json` covering
`github-actions`, `docker`, `terraform`; no pre-commit secret scan; no SAST or IaC scan
job; no `SECURITY.md`. Branch protection is not in the repo — `verify outside repo`.
Confirm: file presence.
Fix: add the missing file.
Not a finding: always HARDENING; org-level rulesets may exist outside the repo.
