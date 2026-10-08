---
name: commit
description: Use when asked to commit. Commits the current changes with Conventional Commits (subject ≤100 chars, body = why), in the repo that owns each file. No push.
argument-hint: "[short description or ticket]"
---

# Commit

Context: $ARGUMENTS

A commit subject says **what changed and where**. A body says **why it had to change**,
in terms a reviewer cannot reconstruct from the diff.

## 1. See what changed, per repo

```sh
git status --short
git submodule foreach --quiet 'test -n "$(git status --porcelain)" && echo "$sm_path"'   # if the repo has submodules
```

A file belongs to the repo that contains it: files inside a submodule are committed in
that submodule, everything else in the parent. Each repo gets its own commit(s),
submodules first.

## 2. Be on a branch

```sh
git branch --show-current                # empty = detached
git switch -c <type>/<ticket>-<short-desc>   # e.g. feat/DVX-136-account-page
```

Branch names: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/` + ticket (if any)
+ kebab-case summary. Never commit feature work on `main`.

## 3. Derive the convention from THIS repo

```sh
cat commitlint.config.* .commitlintrc* 2>/dev/null   # the enforced rule, if any
git log --pretty=format:'%s' -30                     # the lived convention
```

A commitlint config is law — use its `type-enum` and `scope-enum` verbatim. Otherwise
Conventional Commits; **scope is per-repo**: in a monorepo, the app or package changed
(`api`, `web`, `contracts`); in a single-purpose repo, the area inside it
(`checkout`, `auth`) — or none if the log carries none. Never carry a scope list across
repos.

## 4. Stage and commit

- Stage the files that belong to this change by name (`git add <files>`) — never
  secrets (`.env*` other than templates/examples) or build output.
- One logical change per commit. Split unrelated changes, and split by kind in this
  order: **code** (source, tests, and the spec `tasks.md` ticks for it) → **docs** →
  **config/tooling** (`.claude/`, CI, lint).
- Format:
  ```
  <type>(<scope>): <imperative summary, ≤100 chars, lower case, no period>

  <the trigger: what was broken or missing, concretely>
  <the mechanism: why that produced the symptom>
  <the fix, and why this one over what you rejected>
  <the boundary: what is NOT affected>

  Refs: <ticket>
  ```
  - `type`: feat, fix, perf, refactor, style, docs, test, build, ci, chore, revert.
  - Name the actual change and the thing it affects, not the file or the activity:
    `fix(web): send guests home after signing in from the profile glyph`, not
    `fix: bug fix`.
  - Skip the body only for a genuinely self-evident one-liner (typo, version bump).
  - Breaking change: `feat(api)!: …` plus a `BREAKING CHANGE:` footer.
  - Close with the attribution lines this session specifies, if any.
- Hooks format staged files and check the message. If a hook fails, fix the cause and
  commit again; never skip hooks.

## 5. Don't include

- A submodule pointer change in the parent repo — that is its own `chore: bump <path>`
  commit, made only when asked, after the submodule commit is pushed.
- Pushing. Use `/ai-workflow:create-pr`.

## Red flags

- Subject naming a file or an activity (`update utils.ts`, `refactoring`)
- A scope invented rather than read out of the repo
- A body that narrates the diff instead of giving the cause
- Unrelated work riding along in the same commit
