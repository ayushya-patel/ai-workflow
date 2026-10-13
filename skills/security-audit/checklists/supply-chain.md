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
credentials, Azure storage keys, Azure SAS signatures (`sig=` with `sv=`: the scope is in
`sp` permissions, `srt`/`sr` resource types and `se` expiry — write or list on an
account-level token with a far expiry is CRITICAL; Microsoft AI 38 TB, 2023), JWTs,
credential-named keys with literal values. Also
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
Confirm: tracked or in history — existence is enough; never open it. File a candidate
only on a printed `SECRET-FILE`, `secret file in history` or `secrets` line: a
history-only `*.tfvars` or config file with no such line is not evidence.
Fix: remove it, rotate what it held, ignore the pattern.
Not a finding: `*.example`, `*.sample`, `*.template`.

### secret.build — secrets exposed by build and deploy steps · CWE-532, CWE-214
Detect: CI `echo`, `printenv`, `env`, `set -x` near secrets; secrets on command lines
(`helm --set`, `docker build --build-arg TOKEN=`, `curl -u`); secrets written into
artifacts or caches. Dockerfile ARG secrets are `container.dockerfile`; user_data and
function env are `iac.compute`; secrets sent to a network host (`toJSON(secrets)`,
`curl … ${{ secrets.* }}`) are `cicd.backdoor`.
Confirm: the step, and that the value lands in logs, layers or artifacts.
Fix: `--mount=type=secret`; masked variables; files with tight permissions;
`::add-mask::`.
Not a finding: masked secrets passed through `env:` and never echoed.

### data.dumps — data and debug captures committed · CWE-312, CWE-532, CWE-359
Detect: `git ls-files | grep -E '[.](sql|dump|sqlite3?|db|bak|har|log|pcap|csv|xlsx|tsv|dmp|mdmp|hprof|heapsnapshot|crash)$|(^|/)core([.][0-9]+)?$|postman_collection[.]json$|insomnia[^/]*[.](json|ya?ml)$|[.]yarnrc[.]yml$|^(cloud|environment|contents|truffleSecrets|actionsSecrets)[.]json$'`.
Then `audit.mjs secrets` hits inside them; `grep -c` for email or phone shapes; HAR
files (cookies and auth headers — the 2023 support-HAR breach class); API collections
with auth headers; `.yarnrc.yml` `npmAuthToken`. Memory and crash dumps (`*.dmp`,
`*.hprof`, `core`) can hold private keys (Storm-0558, 2023): treat them as
`secret.files` too. Root-level `cloud.json`, `environment.json`, `truffleSecrets.json`
are the Shai-Hulud worm's loot files (2025): `cicd.backdoor`.
Confirm: real data, not synthetic fixtures (column names, counts, `audit.mjs show` of a
few masked lines). Dumps are existence-only evidence: never open them.
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

Also:
- label gates without a pinned SHA (TOCTOU);
- actor gates on a privileged trigger — `if: github.actor == 'dependabot[bot]'`,
  `github.triggering_actor`, `contains(github.actor, …)` — guarding merge, approve or
  secret steps: the actor is whoever caused the latest event, not the PR author;
- `dawidd6/action-download-artifact` (flag a missing `allow_forks: false`) or
  `actions/download-artifact` of `workflow_run.id` extracted into the workspace before
  a run step, or artifact contents written to `$GITHUB_ENV`, `$GITHUB_OUTPUT` or
  `$GITHUB_PATH`;
- the same shapes in workflow files and local actions on other branches: `audit.mjs
  workflows` lists every copy that differs from HEAD; read one with `audit.mjs at <ref>
  <path>` (Nx s1ngularity, 2025, was a stale branch).

Confirm: trigger → checkout of the attacker ref → execution step → secrets in scope,
each with its line. On another branch cite `<ref>:<path>:<line>`; whether the platform
still runs that copy for the trigger is `verify outside repo`, never a downgrade.
Fix: build untrusted code under `pull_request` (forks get no secrets); a separate
`workflow_run` that treats artifacts as data and never executes them; never check out
the PR head under `pull_request_target` — if unavoidable, a separate path,
`persist-credentials: false`, nothing executed; environments with required reviewers.
Not a finding: `pull_request_target` that only labels or comments through the API with
no checkout; actor checks used only for labelling.

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
  (`LD_PRELOAD`, `NODE_OPTIONS`);
- the same on any other branch (`audit.mjs workflows`).

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
- `ACTIONS_ALLOW_UNSECURE_COMMANDS`;
- workflows that approve or auto-merge PRs with `GITHUB_TOKEN` or a PAT
  (`gh pr review --approve`, `hmarr/auto-approve-action`, the reviews API with
  `APPROVE`): the bot satisfies a required review (whether Actions may approve is
  `verify outside repo`).

Confirm: the effective permission per job and what runs in it.
Fix: top-level `permissions: contents: read` (or `{}`), per-job grants;
`persist-credentials: false`; explicit secrets per call.
Not a finding: write scopes on jobs that only run trusted, pinned steps on protected
branches.

### cicd.pinning — mutable third-party code · CWE-829, CWE-494 · OpenSSF Scorecard Pinned-Dependencies · CVE-2025-30066, CVE-2025-30154
Detect:
- `uses:` by tag or branch (not a 40-hex SHA) for actions outside `actions/` and
  `github/` — in workflows and in local composite actions
  (`.github/actions/*/action.ya?ml`, any `action.ya?ml`): a SHA pin on a composite does
  not pin the actions it calls (reviewdog to tj-actions, 2025), so list third-party
  composites as `verify outside repo`;
- security-scanner actions (trivy, kics, checkmarx, snyk, semgrep) on tags in jobs with
  write tokens or secrets: high-value targets (TeamPCP, 2026);
- lookalike owners one or two edits from `actions`, `github`, `docker`, `aws-actions`,
  `google-github-actions`, `azure`, `hashicorp` (CRITICAL if found);
- a SHA whose `# vX` comment disagrees with other pins of the same action;
- `docker://` images by tag; reusable workflows at `@main` with secrets; GitLab
  `include: remote` and `:latest` images; unpinned Bitbucket pipes;
- remote scripts run without a pinned checksum:
  `audit.mjs grep '(curl|wget)[^|]*[|] *(sudo +)?(ba|z)?sh|(ba)?sh +<[(] *(curl|wget)|iex *[(]|Invoke-Expression|irm [^|]*[|] *iex'`
  (Codecov, 2021).

Confirm: list each unpinned reference with its job's privileges. A public repo with
secrets in the job raises Impact: the logs that leak them are public.
Fix: full commit SHA with a version comment (`@<sha> # v4.1.7`); Dependabot or Renovate
for `github-actions` and `docker`; pinned digests; checksum literals in the repo
(`sha256sum -c`); an org policy requiring SHA pins (`verify outside repo`).
Not a finding: local actions (`uses: ./`) whose own `uses:` are pinned; first-party
`actions/*` on major tags in unprivileged jobs (HARDENING); a checksum fetched from the
same origin as the script is not a pin.

### cicd.runners-cache — self-hosted runners, caches, artifacts · CWE-829, CWE-494
Detect — these pair across files; build the per-workflow table first (trigger, cache
key templates, `runs-on`, secrets, `id-token`, publish steps):
- **Cache poisoning:** any job running untrusted code in default-branch context (a kept
  `cicd.pwn-request`, `cicd.script-injection` or `cicd.ai-agents`, or an `issue_comment`,
  `discussion` or `workflow_run` job running code) PLUS any release, publish or deploy
  job, in any workflow, that restores a cache: `actions/cache`, `actions/cache/restore`,
  `actions/setup-(node|python|go|java)` with `cache:`, `pnpm/action-setup`, composite
  setup actions. The poisoning job needs no cache step of its own, and
  `permissions: contents: read` does not stop cache writes (Ultralytics 2024, TanStack
  2026, Clinejection 2026).
- **Runners:** `runs-on` labels other than GitHub-hosted images (`ubuntu-*`,
  `windows-*`, `macos-*`), `runs-on.group` or `self-hosted`, when one label or group
  serves an untrusted trigger and a job with secrets, `id-token` or release steps
  (PyTorch 2024); ARC runner specs without `ephemeral: true`; runner registration
  (`config.sh --url … --token`) in scripts or IaC.
- **Artifacts:** release jobs consuming artifacts from PR-triggered runs and executing
  them.

Confirm: both workflows with `path:line` — the untrusted job and the consumer — the
shared key template or label, and the consumer's secrets or `id-token`.
Fix: release jobs restore no cache (`cache: false`, `lookup-only`, clean install from
the lockfile); ephemeral just-in-time runners in a separate group, never for forks;
artifacts validated as data. Out of band after the fix: purge the cache
(`gh cache delete --all`) — entries outlive the fixed workflow.
Not a finding: release jobs with no cache restore; private repos without fork PRs and
ephemeral runners. A comment or `permissions: read` claiming the job is safe is not a
control.

### cicd.oidc-trust — cloud trust for CI identities · CWE-284, CWE-863 · ATT&CK T1078.004
Detect:
- IaC trust for `token.actions.githubusercontent.com` with no `sub` condition, with
  `StringLike` on `repo:org/*` or `repo:org/repo:*`, or with only an `aud` check;
- GitLab `project_path:group/*`;
- GCP workload identity providers without `attribute_condition`, or conditioned on the
  owner only;
- Azure federated credentials with `pull_request` subjects on prod identities;
- `id-token: write` on PR-triggered jobs;
- any other federated issuer used with `sts:AssumeRoleWithWebIdentity` — enumerate the
  issuers: Terraform Cloud `app.terraform.io:sub` with `workspace:*` or
  `run_phase:*` on an apply-capable role, CircleCI `oidc.circleci.com/org/<id>`,
  Bitbucket, Buildkite — without the issuer's project or repository claim;
- `ForAnyValue:` operators on `sub` or `aud` (a single-valued claim).

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
(`aws-access-key-id: ${{ secrets.… }}`) instead of OIDC. Publish and release jobs
(`npm publish`, `twine upload`, `docker push`, `goreleaser`) with `id-token: write` or
registry tokens and no `environment:` restricted to protected tags, triggered by
`workflow_dispatch`, `workflow_call`, `push` to unprotected branches, or
`if: contains(github.event.head_commit.message, …)` or a label: any write token, or one
pushed commit message, publishes (Nx 2025, AsyncAPI and Bitwarden CLI 2026).
Confirm: who can trigger the deploy, and with what input.
Fix: protected environments with reviewers and branch rules; environment-scoped
secrets; OIDC federation.
Not a finding: single-maintainer private repos (lower likelihood; still list static
keys).

### cicd.ai-agents — AI agents running in CI · CWE-94 · LLM01:2025, LLM06:2025
Detect: AI agent actions or CLIs (`claude-code-action`, `codex`, `aider`,
`gemini-cli`, `run-gemini-cli`, custom) triggered by issues, comments or PRs from
untrusted authors with write tokens, secrets or shell tools; no `author_association`
gate; `allowed_non_write_users` or `allowed_bots` set (`'*'` is anyone);
`--allowedTools`, `allowed_tools` or `claude_args` granting `Bash`, `Write`, `Edit`,
`WebFetch` or `gh` write commands; secrets other than the model key in the agent step's
`env`; `show_full_output` or debug transcripts on a public repo; agent prompts built
from issue or PR text; a cache key shared with a publish workflow (then
`cicd.runners-cache` — Clinejection, 2026).
Confirm: trigger → untrusted text in the agent's context → the tools and tokens it
holds.
Fix: trusted actors only (`MEMBER`, `OWNER`); read-only tokens; no secrets; tool
allowlists; human approval for writes.
Not a finding: agents on maintainer-only triggers with read-only tokens.

### cicd.backdoor — planted workflows, secret exfiltration, CI persistence · CWE-506, CWE-200 · ATT&CK T1567, T1195.002
A workflow can be the attack itself, pushed with a stolen token (GhostAction 2025,
Shai-Hulud 2025, MEGALODON_CI and Miasma 2026). Detect:
- exfiltration sinks in CI files:
  `audit.mjs grep -i 'toJSON[(] *secrets|/proc/[^ ]*/(environ|mem|maps)|Runner[.]Worker|169[.]254[.]169[.]254|metadata[.]google[.]internal|webhook[.]site|pipedream|ngrok|requestbin|interact[.]sh|oast[.](fun|pro|live)|rentry[.]co|pastebin|transfer[.]sh|api[.]telegram[.]org/bot|discord(app)?[.]com/api/webhooks|ipfs|base64 (-d|--decode)[^|]*[|] *(ba)?sh|https?://[0-9]{1,3}([.][0-9]{1,3}){3}|(curl|wget|Invoke-WebRequest)[^\n]*[$][{][{] *(secrets|toJSON)' -- .github .gitlab-ci.yml .circleci Jenkinsfile`
  — a renamed workflow (`ci-optimize.yml`, MEGALODON 2026) has no IOC name, so these
  carry it; `curl`, `wget` or `Invoke-WebRequest` in a `run:` carrying a secret env to a
  host the repo doesn't own;
- persistence: `on: discussion`, `discussion_comment`, `issues`, `issue_comment`,
  `repository_dispatch` or `workflow_dispatch` jobs that run event text or a fetched
  script, especially `runs-on: self-hosted` (Shai-Hulud `discussion.yaml`); runner
  registration in scripts; `audit.mjs grep 'SHA1HULUD|Sha1-Hulud|s1ngularity-repository' --
  .github` (the 2.0 runner label and repo names); `inventory` `IOC` lines and `IOC` tags on
  `audit.mjs workflows` lines (dated indicators in `audit.mjs`: Shai-Hulud 1 and 2 with
  its `formatter_*.yml`, GhostAction, the LiteLLM `.pth`);
- history: `git log --no-merges --format='%h|%an <%ae>|%cn|%s' -- .github` (and lockfiles,
  build files, `*.pth`): bot-like or agent-like authors (`bot`, `ci`, `build`,
  `claude`, `copilot`), author not the committer, `[skip ci]`, titles like "add security
  workflow" or "build optimization", workflow commits with no PR merge. A workflow added
  then deleted is read at its adding commit: `audit.mjs at <commit> <path>`; it ran.

Confirm: quote the line truncated, never a URL's query, with its commit and author;
never fetch the URL. A confirmed exfiltration step or an `IOC` hit is CRITICAL `active
compromise suspected` and goes first in the report.
Fix: revert; rotate every secret the repo, org and environments hold, then
trusted-publisher bindings; purge Actions caches; remove unknown self-hosted runners,
collaborators and deploy keys (`verify outside repo`); CODEOWNERS and rulesets on
`.github/`; fine-grained PATs without the `workflow` scope.
Not a finding: first-party actions posting to github.com APIs only (secret scanning,
SARIF upload); notifications sending only job status to a webhook the repo owns; a
file nothing references (exclusions precedent: shown by grep, never by its path).

### cicd.iac-plan — infrastructure plans on untrusted changes · CWE-94, CWE-829
Detect: `terraform (init|plan)|terragrunt (plan|run-all)|tofu plan|pulumi preview|cdk (diff|synth)`
in jobs on `pull_request`, `pull_request_target` or `issue_comment` (`atlantis plan`)
with cloud credentials in scope (`role-to-assume`, `aws-access-key-id`,
`GOOGLE_CREDENTIALS`, `ARM_CLIENT_SECRET`, `TF_TOKEN_*`); `atlantis.yaml` or
`repos.yaml` with `allow_custom_workflows: true`, `allowed_overrides: [workflow]`, or
autoplan for forks.
Confirm: trigger → plan command → identity, and what that identity reads (state bucket,
secret stores) or writes (`iac.iam`). `plan` runs providers, `data "external"` and
module code from the change.
Fix: no credentials for untrusted plans, or plan only after a maintainer label on a
pinned SHA; a read-only plan role with no access to secret-bearing state; Atlantis
`allow_custom_workflows: false` and no `workflow` override; a provider mirror and the
lock file under CODEOWNERS.
Not a finding: `terraform fmt -check`, or `validate` after `init -backend=false`, with no
credentials.

### cicd.other — GitLab, Jenkins, Bitbucket, CircleCI, Azure Pipelines, AWS CodeBuild
Detect:
- **GitLab:** variables not protected or masked; fork MR pipelines with secrets; broad
  `CI_JOB_TOKEN` scope; static cloud keys instead of `id_tokens`.
- **Jenkins:** `sh` interpolating `${params.*}`; credentials in a `Jenkinsfile`; PR
  builds with credentials.
- **Bitbucket:** secured variables in fork PR pipelines.
- **CircleCI:** contexts on fork builds; static cloud keys in contexts or project env
  instead of CircleCI OIDC (CircleCI 2023).
- **Azure:** secrets on fork PR validation.
- **AWS CodeBuild:** webhook `filter_group` patterns on `ACTOR_ACCOUNT_ID` or
  `HEAD_REF` without `^…$` anchors; PR events (`PULL_REQUEST_CREATED`,
  `PULL_REQUEST_UPDATED`) on projects whose role or source credential can write; comment
  approval off (CodeBreach, 2026).
- **Any CI:** a regex allowlist over actor, account or branch must be anchored
  (`if: contains(…)` on actor names, Jenkins trigger regexes).

Confirm: as for the GitHub classes.
Fix: the platform's equivalent of the GitHub fixes.
Not a finding: as for the GitHub classes.

## Dependencies and releases

### deps.vulnerable — reachable or exploited CVEs · CWE-1104, CWE-1395 · A03:2025 · SSDF RV.1
Detect: `audit.mjs scan osv-scanner` (`--network` downloads the advisory database;
without it the scan uses a cached database or prints `ERROR`). No database:
`not checked — needs --network`. Never cite an advisory id or version range from memory.
High-blast components are never left silent: for each one in a lockfile, manifest,
Helm chart or base image, write `<name>@<locked version> · scan: <ids printed | none | not checked — needs --network>`
in coverage — Next.js and `react-server-dom-*`, SAML libraries (`ruby-saml`,
`xml-crypto`, `@node-saml/*`, `passport-saml`, `samlify`, `python3-saml`), JWT
libraries, auth SDKs (`next-auth`, `passport-*`), Spring, Struts, `log4j-core`,
`ingress-nginx` and other cluster controllers, MCP packages, `torch`, `langchain*`,
language runtimes in base images. Put it at the top of coverage when its reachability
signal is present (App Router with server actions, a SAML route, middleware-only auth,
`torch.load`).
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
- manifest URL specifiers, which registries and scanners never see (PhantomRaven,
  2025): `audit.mjs grep '"[^"]+" *: *"(https?|git[+]https?|git[+]ssh|file|link):' -- package.json`
  in `dependencies`, `devDependencies`, `optionalDependencies`, `overrides`; pip
  `--find-links http:` or `--index-url http:`;
- `*` or `latest` ranges in apps;
- Go `replace` to forks, `GOFLAGS=-insecure`, `GONOSUMDB` misuse.

Confirm: the CI install line and the lockfile entry.
Fix: commit lockfiles; frozen installs; git deps pinned by SHA; registry URLs only.
Not a finding: ranges in published libraries; `git+https` pinned by a full SHA to a repo
the org owns.

### deps.confusion — dependency confusion and typosquats · CWE-1357, CWE-829 · ATT&CK T1195.001
Detect: internal-looking names (company prefix, `@company/` scope) without a scope →
registry mapping in `.npmrc` (`@company:registry=`); `pip --extra-index-url` (resolves
the highest version across indexes — PyTorch `torchtriton`, 2022) in requirements,
Dockerfiles, CI and README install commands; uv `[[tool.uv.index]]` without
`explicit = true` and Poetry sources without `priority = "explicit"` for private names;
names one or two edits from popular packages (`reqeusts`, `lodahs`, `crossenv`,
`electorn`) or containing non-ASCII homoglyphs, especially new in the diff. LEAD: names
added by commits with AI co-author trailers
(`git log --format='%h %(trailers:key=Co-Authored-By)' -- <manifests>`) and absent from
the previous lockfile — hallucinated names get registered (slopsquatting); never looked
up offline.
Confirm: the config line. Never publish or probe a package; no registry lookups.
Fix: scope → private registry with auth; `--index-url` to a private proxy, never
`--extra-index-url`; remove typosquats.
Not a finding: scoped packages pinned to their registry.

### deps.install-scripts — lifecycle scripts and worm indicators · CWE-829 · A03:2025
Detect: `"hasInstallScript": true` in `package-lock.json` for packages not on an
allowlist; root `package.json` `preinstall`, `install`, `postinstall` or `prepare`;
`node_modules/*/package.json` lifecycle scripts only if already present (read only);
`setup.py` making network calls; vendored binaries; worm indicators (2025):
- `bundle.js` postinstall and `trufflehog` (Shai-Hulud, Sep 2025);
- a preinstall that installs a runtime: `setup_bun[.]js|bun_environment[.]js|bun[.]sh/install`
  (Shai-Hulud 2.0, Nov 2025; `inventory` `IOC`);
- AI CLIs run with permission bypass, and shell rc writes (Nx s1ngularity, Aug 2025, wrote
  them from JS): `audit.mjs grep '(dangerously-skip-permissions|[-][-]yolo|trust-all-tools|approval-mode[ =]yolo|dangerously-bypass-approvals|[-][-]full-auto|[.](bash|zsh)rc|[.]z?profile\b)'`
  — confirm an rc or profile hit is a write (`>>`, `appendFile`, `open(…, 'a')`);
  over every tracked file — CRITICAL inside a lifecycle script, a LEAD elsewhere outside
  docs.

Diff mode: a package name new to the lockfile with `hasInstallScript` is a LEAD naming
its parent (`git diff --name-only` then `audit.mjs diff`) — Axios, 2026.
Confirm: quote the risky script line (truncated); never run it.
Fix: `ignore-scripts=true` with an allowlist (pnpm `onlyBuiltDependencies`); a
release-age cooldown (pnpm `minimumReleaseAge`, Renovate `minimumReleaseAge`,
Dependabot `cooldown`, uv `exclude-newer`); remove the package.
Not a finding: known native builds (`esbuild`, `sharp`, `bcrypt`) on the allowlist.

### deps.toolchain — committed executables that run on install or build · CWE-494, CWE-829
Detect: `.yarn/releases/*.cjs` with `yarnPath`, `.yarn/plugins/*`, `.pnpmfile.cjs`,
`gradle/wrapper/gradle-wrapper.jar` without a wrapper-validation step in CI,
`.mvn/wrapper/*.jar` and `mvnw`, `gradlew`, checked-in binaries in `bin/` or `tools/`
(`inventory` `BINARY`), `Makefile` targets fetching and running scripts. App-bundled
native code: `git ls-files | grep -E '[.](dll|dylib|so|node|exe)$'`, especially under
`prebuilds/`, `vendor/` or Electron `extraResources`/`asarUnpack`, with no source build
or checksum manifest; build steps downloading native libraries without a sha256 check
(3CX, 2023). Build scripts that read test data are `build.tamper`.
Confirm: the file is tracked and runs during install or build; changed recently
(`git log -3 --format=%h -- <file>`) by whom the guardrails allow.
Fix: verify wrappers against published checksums (`gradle/actions/wrapper-validation`);
pin Yarn via `packageManager` and Corepack; CODEOWNERS on toolchain paths; no
checked-in binaries without a reproducible source.
Not a finding: wrappers validated in CI on every change.

### build.tamper — build scripts that decode or run hidden data · CWE-506, CWE-829 · ATT&CK T1195.002 · CVE-2024-3094
Detect: build and configure files (`*.m4`, `configure.ac`, `Makefile*`,
`CMakeLists.txt`, `*.cmake`, `meson.build`, `build.rs`, `setup.py`, `*.gyp`,
`build.gradle*`) that
- read paths under `tests?/`, `fixtures?/`, `testdata/` or binary blobs
  (`[.](xz|lzma|gz|bz2|bin|dat)`);
- pipe `tr`, `head -c`, `xxd`, `base64 -d`, `xz -d` or `openssl enc` into `sh`, `eval` or
  a compiler;
- wrap a sandbox or hardening flag (Landlock, seccomp, `-fstack-protector`) in
  `check_c_source_compiles`/`try_compile` whose body cannot compile, so it silently
  turns off;

plus `.gitattributes` `export-ignore` on build files, and release tarballs built
outside CI from the tag (`make dist` uploaded by hand).
Confirm: the build line that consumes the blob, and the blob's history
(`git log -3 --format='%h %an %ad' -- <blob>`); for a feature check, the line that
cannot compile. The test-code cap (law §6) does not apply: the production build reads
it (xz-utils, 2024).
Fix: releases built in CI from `git archive` of a signed tag, reproducibly, with the
tarball diffed against the tag; no build-time reads of test data; feature checks that
fail loudly; CODEOWNERS on build files.
Not a finding: fixtures read only by test code (no build-script reference).

### deps.import-time — code that runs on import or interpreter start · CWE-506, CWE-829 · ATT&CK T1195.002
`--ignore-scripts` and the absence of lifecycle hooks are not mitigations here
(AsyncAPI and LiteLLM, 2026). Detect:
- tracked `*.pth`, `sitecustomize.py`, `usercustomize.py`, and packaging that installs a
  `.pth` (`data_files`, `MANIFEST.in`, wheel `data`);
- in shipped entry or exported files:
  `audit.mjs grep 'detached: *true|[.]unref[(][)]'` together with
  `(^|[^.A-Za-z_])eval[(]|new Function[(]|vm[.]runIn|child_process[^\n]*exec[(]|execPath[^)]*['"]-e['"]|['"]-e['"], *Buffer[.]from`
  in the same file (a timer's `.unref()` next to `RegExp.exec(` is not it; a detached
  `process.execPath -e` child is);
- `_0x[0-9a-f]{4,}` identifiers; `exec[(](base64|zlib|marshal)[.]`;
- invisible-code decoders: `codePointAt[(][^)]*[)] *- *0x(E0100|FE00|E000)` near `eval`
  or `Function` (GlassWorm, 2025; pair with `src.unicode`);
- hard-coded IPFS, rentry, pastebin or gist URLs next to `eval`;
- vendored `node_modules/` or `site-packages/` in the tree.

Confirm: the loader line, and that the file is imported by the package entry or ships in
the package file list.
Fix: remove it; releases built in CI from a reviewed tag (`deps.provenance`); a
release-age cooldown for consumers.
Not a finding: `.pth` files a build tool writes under build output.

### deps.provenance — release integrity · SLSA v1.1 · SSDF PS.2, PS.3 · OpenSSF Scorecard Signed-Releases
Detect: publish workflows (`npm publish`, `docker push`, `goreleaser`, `twine upload`)
without provenance (`--provenance`, `actions/attest-build-provenance`,
slsa-github-generator), signing (`cosign sign`) or an SBOM, or using long-lived
registry tokens instead of trusted publishing; publish jobs with `id-token: write` and
no `environment:` restricted to protected tags or branches; publishing an artifact not
built in the same job (`npm publish <file>.tgz`, `twine upload` of a downloaded or
committed file); tracked `*.tgz`, `*.whl`, `*.nupkg`; release builds on persistent
self-hosted runners or signing in the same job on them; deploys pulling images by tag;
no signature verification at admission.
Confirm: the release workflow end to end. Valid provenance proves which workflow built
an artifact, never that the commit was reviewed (TanStack, AsyncAPI, 2026): it never
downgrades a CI-compromise finding.
Fix: trusted publishing (OIDC) bound to the workflow AND a protected environment
(`verify outside repo`); build and publish in one job from a protected tag; provenance
and SBOM attestations; keyless cosign by digest; deploy by digest; verify at admission;
ephemeral hosted runners for release.
Not a finding: internal apps that publish nothing (INFO).

## Repo-wide

### src.unicode — hidden and bidirectional characters in any file · CWE-1007 · CVE-2021-42574
Detect: `audit.mjs unicode` lines (zero-width, bidi overrides and isolates, invisible
operators, soft hyphen, Hangul fillers, BOM mid-file, tag characters, a lone
`U+E01xx` selector, variation-selector runs — `U+FE00-FE0F run n`, `U+E0100-E01EF run
n`, or both ranges interleaved as GlassWorm encodes bytes — and Private Use Area runs
`U+E000-F8FF run n` outside icon CSS and fonts, os-info-checker-es6 2025). A run of 4 or
more is a hidden payload (GlassWorm, 2025): report the count, never decode it; pair it
with the decoder (`deps.import-time`). `NOT-UTF8 … skipped (binary)` and `TOO-LARGE`
lines are Not audited; `NOT-UTF8 … scanned lossy` on a source file is a LEAD — invalid
bytes in code that still runs.
Confirm: the character sits in code, a string compared for security, an identifier, a
package name or an agent instruction file — not in prose of a language that needs it.
Fix: remove it; an editor and CI check that rejects these ranges; escapes (`\u200B`) where
the character is intended.
Not a finding: RTL text in localisation files; a BOM at file start; one variation
selector after an emoji or one ideographic variation selector after a Han character
(the helper never prints either).

### scan.suppressions — scanner configs, ignore files, inline skips, disabled gates · CWE-693 · ATT&CK T1562.001
Detect: `inventory` `SCANNER-CONFIG` lines; `audit.mjs grep 'nosemgrep|nosec|checkov:skip|tfsec:ignore|trivy:ignore|gitleaks:allow|hadolint ignore|NOSONAR|eslint-disable[^\n]*(security|no-eval|no-unsanitized)|@SuppressWarnings[(][^)]*security|# *type: *ignore'`;
`SUPPRESSED` lines from `audit.mjs scan`; allowlists in `.gitleaks.toml`. CI gates
switched off: `continue-on-error: true` or `if: false` on scanner steps (codeql,
semgrep, trivy, gitleaks, snyk, osv, zizmor, checkov), `paths-ignore` covering source,
`--no-verify`, `HUSKY=0` or `SKIP=` in scripts; in diff mode, a scanner job removed.
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
job; no `SECURITY.md`; no release-age cooldown (pnpm `minimumReleaseAge`, Renovate
`minimumReleaseAge`, Dependabot `cooldown`, uv `exclude-newer`); Dependabot
`insecure-external-code-execution: allow`. GitHub-as-code in the repo
(`github_branch_protection`, `github_repository_ruleset`, `.github/settings.yml`) with
`required_approving_review_count = 0`, `enforce_admins = false`,
`allows_force_pushes = true` or no code-owner review. Otherwise branch protection is not
in the repo — `verify outside repo`.
Confirm: file presence, or the setting line.
Fix: add the missing file or setting.
Not a finding: HARDENING, except LOW when dependency PRs auto-merge without a cooldown
or when codified protection allows force pushes or zero reviews; org-level rulesets may
exist outside the repo.
