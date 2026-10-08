---
name: check
description: Consistency gate — validate a module's spec, plan, tasks and contracts against each other and the constitution. Report only.
argument-hint: "[module slug — default: every module not Shipped]"
---

Check module: $ARGUMENTS

**Dispatch the `ai-workflow:spec-auditor` subagent to do this, and relay its report.** Pass
it this file's path (`${CLAUDE_PLUGIN_ROOT}/skills/check/SKILL.md`) as its checklist.
Reading a module's spec, plan, tasks, and both contract files to produce a short report
is the textbook case for context isolation — and the session that wrote those
artifacts is the worst judge of whether they drifted.

Run this before implementing, and again before opening a PR. You are looking for
**drift between artifacts**, not for code quality. Report only; change nothing.

`<specs>` is `.claude/ai-workflow.json` → `"specs"` (default `docs/specs`). Read
`${CLAUDE_PLUGIN_ROOT}/law/constitution.md` and the repo's AGENTS.md / CLAUDE.md →
**Local rules**, then the module's `spec.md`, `plan.md`, and `tasks.md` (and each open
`changes/<nnn>-<slug>/`). If a module was not named, check every module whose status is
not `Shipped`.

## Checks

**Completeness**
- Any `TBD`, `TODO`, or unreplaced `<placeholder>` left in a non-template file
- **Out of scope** empty — an agent with no scope boundary invents one
- A `## Deferred` entry with no `Revisit when` (it is a wish, not a deferral)
- `spec.md` at status `Shipped` with the `## How it works` placeholder still present
- A change at status `Shipped` whose parent `spec.md` has no `## History` row for it

**Coverage**
- A spec **Outcome** with no task producing it → report the unmapped outcome
- A spec **Verification** item with no corresponding check anywhere
- A task with no acceptance check, or whose objective needs the word "and"
- An `Accept:` that is not **runnable as written** or cannot go red: not a `git diff`,
  not a `grep` for text the output never contains, not a flag the tool rejects with
  several paths; no number measured on another day or suite; and a test-path filter
  that matches the intended file only (a substring that also matches another file's
  name is a finding)
- A task depending on a task that does not exist

**Constitution compliance**
- Library names, file paths, or function signatures in `spec.md` (Article II)
- A `plan.md` decision that is expensive to reverse with no ADR linked (Article III)
- A dependency added in `plan.md` with no ADR (Article IV)
- A value (a price, a total, a status, a name) originated outside the system that
  owns it — including a fallback like `price ?? 0` (Article V)
- A network call outside the repo's single client layer
- A contract restated in markdown instead of linked to the repo's shared type location
- Anything the repo's **Local rules** add

**Contracts** — the cross-module checks, and the most valuable ones here
- A sibling dependency in `contracts/requires.md` that is **not** listed in that
  sibling's `contracts/provides.md` → depending on internals. **Blocking.**
- A `requires.md` row with no `throw` / `degrade` behaviour stated
- Upstream fields restated in markdown instead of referenced from the shared types
- A `provides.md` route, endpoint or output shape that no longer matches the shipped code
- An empty **Consumed by** table on a shipped module, with no explicit "nothing
  consumes this" note — almost always stale rather than true
- Anything a module provides that changed since the last commit, where the
  **Consumed by** modules were not checked

**Drift**
- `plan.md` **Touched surface** paths that do not exist, or shipped files not listed
- Code diverging from the plan with no ADR recording the change of mind
- An **Open question** marked blocking on a module already in progress

## Report

Group as **Blocking** / **Should fix** / **Nit**. One line each, citing the article
or the specific artifact. State plainly if nothing is wrong — do not manufacture
findings.

Finish with the outcome-to-task mapping as a table, so gaps are visible rather than
asserted.
