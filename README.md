# ai-workflow — a spec-first workflow plugin for Claude Code

One Claude Code process shared by every repo that installs it: the workflow, the law,
the guard hooks and the review agents live here once instead of as per-repo copies
that drift apart. Repo-specific rules and QA agents stay in each repo; this plugin
dispatches them.

| Part | What |
|---|---|
| `skills/` | `/ai-workflow:task` (fires on "build / fix / change X"), `spec`, `plan`, `tasks`, `check`, `flow`, `status`, `adr`, `verify`, `review`, `commit`, `create-pr`, `handoff`, `doc-sweep`, `self-improve` |
| `agents/` | `ai-workflow:guardian` (the law, on a diff), `ai-workflow:code-reviewer`, `ai-workflow:spec-auditor` (for `/check`, `/status`), `ai-workflow:task-implementer` (one task each, pinned to `claude-sonnet-5-5`), `ai-workflow:failure-triager` (read-only judge of browser checks that still fail) |
| `hooks/` | `guard-bash`, `guard-edit`, `guard-new-code`, `format`, `session-start`, `detect-feedback` — see [Hooks](#hooks) |
| `law/` | `constitution.md`, `definition-of-done.md`, `engineering-discipline.md` |
| `templates/` | `specs/_template/` (spec, plan, tasks, contracts/provides+requires, changes/), `adr.md`, `delivery-note.md`, `handoff.md`, `learnings.md` |
| `scripts/pipeline/` | Plain Node (builtins only, no dependency): `cli-waves.mjs <module-dir>` prints a task list's parallel waves, `cli-brief.mjs <module-dir> <task-id>` prints one task's context for its implementer. Deterministic, no model call — see [The task pipeline](#the-task-pipeline) |
| `ci/check-process.sh` | CI gate: no application code without a spec touched (Article I), no new runtime dependency without an ADR (Article IV) |
| `tests/` | Self-checks: `bash tests/test-guard-new-code.sh`, `bash tests/test-check-process.sh`, and the pipeline scripts' tests, `node --test tests/*.test.mjs` |

## The process in one picture

```
/ai-workflow:task  (or just "build X")
  Step 0: pending learnings, triage → A new module · B change to shipped module · C trivial
  A: interview → spec (Approved) → /plan (+ contracts) → /tasks → /check
     → waves → a brief per task → task-implementers in the background (≤3) → one browser run
     → failures rerun once, survivors judged → one whole-diff review
     → /flow → /check → /verify → /doc-sweep → /commit → /create-pr
  B: same cycle in <specs>/<module>/changes/<nnn>-<slug>/, then fold back into the parent spec
  C: no spec; PR carries "Skip-Process: <why>"
  end: retrospective → .claude/learnings.md → /ai-workflow:self-improve
```

There is no fast lane: everything that is not Path C goes through a spec, and CI checks it.

## Install

In each repo's `.claude/settings.json` (committed, so everyone gets it):

```json
{
  "extraKnownMarketplaces": {
    "ayushya-patel": {
      "source": { "source": "github", "repo": "ayushya-patel/ai-workflow" }
    }
  },
  "enabledPlugins": { "ai-workflow@ayushya-patel": true }
}
```

Settings only *enable* the plugin; each machine still has to *install* it, and a
dismissed prompt leaves it silently off (no `ai-workflow:*` skills, no guard hooks).
Claude Code offers to install it on first start in the repo. Manually:
`/plugin marketplace add ayushya-patel/ai-workflow` then
`/plugin install ai-workflow@ayushya-patel`. Local development: `claude --plugin-dir <path to this repo>`.

Then, per repo:

1. Add `.claude/ai-workflow.json` (below).
2. Add a **Local rules** section to the repo's `AGENTS.md` or `CLAUDE.md` — the rules
   `guardian` enforces on top of the law (e.g. "every route has an `ErrorBoundary`").
3. Add `.claude/skip-process` to `.gitignore`. Commit `.claude/learnings.md` (it is
   shared); `/ai-workflow:self-improve` creates it from the template if missing.
4. Add the CI gate — see [The CI gate](#the-ci-gate).
5. Remove the repo's old copies of the skills, agents and hooks this plugin replaces.

## `.claude/ai-workflow.json`

Every key is optional. A missing or unreadable file means the defaults; the hooks never
crash on it.

```json
{
  "check": "pnpm check",
  "format": "biome",
  "protected": ["packages/contracts/**/*.gen.ts", "apps/admin/src/**"],
  "append_only": ["**/migrations/**"],
  "specs": "docs/specs",
  "code": ["src/**"],
  "e2e": "pnpm e2e",
  "verify_agents": ["ai-workflow:code-reviewer", "qa-lead"]
}
```

| Key | Type | Default | Used by | Meaning |
|---|---|---|---|---|
| `check` | string | none | `/ai-workflow:verify`, Definition of done | The one command that must pass before a commit or PR (lint + typecheck + tests, or whatever the repo's "everything CI runs" is). Run exactly as written from the repo root. |
| `format` | `"biome"` \| `"prettier"` \| `"none"` | `"biome"` | `format` hook | Formatter run on each file Claude edits, using the repo's own `node_modules/.bin/<tool>` and its config. Skipped silently if the binary isn't installed. |
| `protected` | glob[] | `[]` | `guard-edit` hook | Paths Claude may never Edit/Write (generated code, vendored source). Added to the built-in blocks: `.env` / `.env.*` (except `*.template`, `*.example`), lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock*`), and `node_modules/`, `dist/`, `coverage/`, `.turbo/`. |
| `append_only` | glob[] | `[]` | `guard-edit` hook | Paths that may be **created** but never edited once committed: an Edit/Write to a matching file that `git ls-files --error-unmatch` finds (run in the file's own directory, so submodules work) is blocked with "already committed; add a new file instead". Use for migrations. |
| `specs` | string | `"docs/specs"` | every workflow skill, `guardian`, `spec-auditor`, `ci/check-process.sh` (2nd arg / `SPEC_ROOT`) | The spec root: `<specs>/<nnn>-<slug>/` per module, `<specs>/README.md` as the index, optional `<specs>/_template/` to override the plugin's templates. |
| `code` | glob[] | none (gate off) | `guard-new-code` hook, `session-start` hook | Application code. Turns the spec gate on: creating a **new** file matching these globs is blocked (Write) or reported for removal (a shell command that left an untracked file) unless some `<specs>/**/spec.md` is `Approved` or `In progress`, or `.claude/skip-process` exists. Editing existing files is never blocked. No key → the hook does nothing. Example: `["src/**"]`. |
| `e2e` | string | none (no browser step) | `/ai-workflow:task` (A4), `/ai-workflow:tasks`, `scripts/pipeline` | The command that runs the repo's browser suite. `/ai-workflow:task` runs it **once**, after every task is done; implementers never run it. A browser task's `Accept:` is this command plus the repo's test filter (`pnpm e2e -g "<title>"`); `cli-waves.mjs` tags such a task `[e2e]` by the command's words up to its first flag. Absent: no browser step, no failure triage, no `[e2e]` tags. |
| `verify_agents` | string[] | `[]` | `/ai-workflow:verify` | Agents dispatched in parallel on the diff, alongside `ai-workflow:guardian` (always). Repo-local names (`qa-lead`) or plugin ones (`ai-workflow:code-reviewer`). |

Globs are matched against the path relative to the project root: `**` any depth, `*`
within one segment, `?` one character; a pattern with no `/` matches the file name
anywhere (like `.gitignore`).

## Hooks

All of them read `.claude/ai-workflow.json`, and a missing or broken file, or a malformed
input, means "allow" / "say nothing". Exit 2 is the only blocking code.

| Hook | Event | Does |
|---|---|---|
| `guard-bash` | PreToolUse · Bash | Blocks force-push, skipped git hooks (`--no-verify`, `HUSKY=0`), push to main, discarding work. |
| `guard-edit` | PreToolUse · Edit/Write | Blocks secrets, lockfiles, build output, `protected`, committed `append_only` files. |
| `guard-new-code` | PreToolUse · Write, PostToolUse · Bash | The spec gate (Article I), on only when `code` is set. Write: blocks a new file under `code` with no `Approved`/`In progress` spec. Bash: a command that left an untracked file under `code` gets a message to remove it (PostToolUse can't block). Spec status is read from the working tree and from `HEAD`, so flipping a spec to `Shipped` doesn't unauthorise its own files. Override: `echo "<why>" > .claude/skip-process`. |
| `format` | PostToolUse · Edit/Write | Runs the repo's formatter on the edited file. |
| `session-start` | SessionStart | Always prints `law/engineering-discipline.md`, so the law applies outside `/ai-workflow:task` too. Then: pending `.claude/learnings.md` entries (count + up to 5), an active `.claude/skip-process`, a leftover legacy `.claude/pending-retrospect.md`, and — where `code` is set — the open specs. |
| `detect-feedback` | UserPromptSubmit | When a prompt reads like a correction ("no,", "don't", "from now on", …), one line asking Claude to log it in `.claude/learnings.md`. Silent otherwise. |

## The task pipeline

`/ai-workflow:task` (A4) carries a task list out in small, cheap, parallel steps. Everything
mechanical is a script; the agents are left with the judgement.

1. `node scripts/pipeline/cli-waves.mjs <module-dir> [--cap N] [--json] [--e2e "<cmd>"]`
   groups the pending tasks into waves of at most 3. Two tasks that depend on each other
   or share a file (a directory counts as every file under it) never share a wave, a
   ticked task counts as satisfied, a task naming no files runs alone. An unknown
   `Depends on` id or a cycle exits 1 naming the ids. Ids may carry a letter (`T9a`).
2. `node scripts/pipeline/cli-brief.mjs <module-dir> <task-id>` prints about 100 lines
   (never more than 150): the conventions block, the task block, the spec's Outcomes and
   Out of scope, and the plan's `Touched surface` rows for the task's files. With no
   conventions block it names the `.claude/rules/*.md` whose `paths:` match the task's
   files. It is a slice; the spec stays authoritative.
3. Each wave's `ai-workflow:task-implementer`s run in the background on a pinned model and
   run no browser checks. The session ticks each task on return when its static or unit
   check is green.
4. Once everything is ticked: the repo's `e2e` suite runs once, each failure is rerun
   once, and survivors go to `ai-workflow:failure-triager` (stale check, real defect or
   flake). Fixes are new tasks; a ticked task is never reopened.
5. One review of the whole diff by the strongest model, then `/flow`, `/check`, `/verify`.

Models are pinned by full ID in the agent definitions (`claude-sonnet-5-5` for the
implementer, reviewer and auditor; `claude-opus-5-5` for the triager); an alias would
float with releases.

**The saving is a hypothesis, not yet measured.** Record a baseline in your own repo
before relying on it.

## The learning loop

One loop for every repo, so a mistake gets fixed once instead of repeated:

1. **Capture** — `.claude/learnings.md` in the repo (committed, append-only; format in
   `templates/learnings.md`). Written the moment a correction or lesson happens, and by
   `/ai-workflow:task`'s retrospective, which also appends a short dated summary to
   `docs/retrospective.md` when the repo has one. Subagents report `Setup feedback:`
   lines; the main session logs them.
2. **Nudge** — `detect-feedback`.
3. **Surface** — `session-start` reports the pending count; nothing at zero.
4. **Fix** — `/ai-workflow:self-improve`: strongest fix first (enforcement beats a rule,
   which beats a skill tweak), in the repo's own `.claude/`, or as a proposed change to
   this plugin when the lesson is about the shared process. Security relaxations,
   reversed decisions and deletions need the user's approval. Entries are marked
   `applied → <file>` or `rejected — <why>`, never deleted.
5. **Review** — normal git review.

## The CI gate

`ci/check-process.sh` fails a PR that changes application code without touching a spec
folder (Article I) or adds a runtime dependency without an ADR (Article IV). A PR
description line `Skip-Process: <why>` overrides it, logged as a warning. It needs a
full clone, the base ref, and the spec root (`ai-workflow.json` → `specs`) as its second
argument or `SPEC_ROOT`.

Run it straight from a checkout of this repo, pinned to a tag. A GitHub Actions example
(this repo is public, so no access key is needed; `fetch-depth: 0` gives the full clone):

```yaml
name: Process gate
on: pull_request

jobs:
  process-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/checkout@v4
        with:
          repository: ayushya-patel/ai-workflow
          ref: v1.0.0
          path: .ai-workflow
      - name: Check process
        env:
          BASE_REF: origin/${{ github.base_ref }}
          PR_BODY: ${{ github.event.pull_request.body }}
          SPEC_ROOT: docs/specs
        run: bash .ai-workflow/ci/check-process.sh
```

Set `SPEC_ROOT` to the repo's `specs` value. Its self-test can run against a copy of the
script: `GATE=<path to script> bash <plugin>/tests/test-check-process.sh`.

## How `/ai-workflow:verify` uses `verify_agents`

1. Collects the diff once (uncommitted, else the branch vs `origin/main`).
2. Runs `check`.
3. Runs `/ai-workflow:check` on every spec module the diff touches.
4. In one message, dispatches **every** agent in `verify_agents` plus `ai-workflow:guardian`,
   each given the diff file, the changed files and the module spec. They run in
   parallel. A listed agent that doesn't exist is a FAIL, not a skip.
5. Reports one PASS/FAIL list and a verdict. It fixes nothing.

So each repo's QA lives where it belongs — one repo keeps a `qa-lead`, another keeps
its own reviewers — and the plugin decides only *when* they run and *how* the result
is reported. Add `ai-workflow:code-reviewer` to `verify_agents` for a general bug/security
review.

## Release

1. Change the plugin on a branch; PR to `main` in `ai-workflow`.
2. Bump `version` in `.claude-plugin/plugin.json` (semver: law or repo-facing behaviour
   change → minor at least; wording/fixes → patch).
3. Add a `CHANGELOG.md` entry: what changed, and why (link the retrospective entry that
   earned it — the law grows only from evidence).
4. Run `claude plugin validate .`, `node --check hooks/*.mjs scripts/pipeline/*.mjs`,
   `bash -n ci/check-process.sh tests/*.sh`, `node --test tests/*.test.mjs`,
   `bash tests/test-guard-new-code.sh` and `bash tests/test-check-process.sh`. If
   `ci/check-process.sh` changed, say so in the CHANGELOG: repos re-copy it.
5. Merge, then tag the merge commit `v<version>` so pipelines can pin it. Repos pick it
   up on the next marketplace update (`/plugin marketplace update ayushya-patel`).

Changing a constitution article also needs an ADR (see Article III).
