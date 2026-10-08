---
name: create-pr
description: Push the current branch and open a pull request with the workflow description and delivery note; one PR per repo, submodules first.
disable-model-invocation: true
argument-hint: "[repo path — default: every repo with unpushed commits]"
---

# Create a pull request

Scope: $ARGUMENTS

Host, owner and repo slug come from the remote, never from memory:
`git -C <path> remote get-url origin` → e.g. `git@github.com:<owner>/<slug>.git`.

## 1. Preconditions (per repo)

- On a feature branch, not `main`/`master` (`git branch --show-current`). If on main,
  create a branch first (naming in `/ai-workflow:commit`).
- Confirm the base branch: `git remote show origin | grep 'HEAD branch'`. Target that
  (normally `main`) — never guess.
- Commits ahead of base: `git log --oneline origin/<base>..HEAD` is not empty.
- Working tree clean for the files in this change.
- `/ai-workflow:verify` passes. Ask the user before pushing.

## 2. Push the branch

```sh
git -C <path> push -u origin <branch>
```

## 3. Open the PR

Title: the main commit's subject, unchanged (under squash-merge it becomes the commit on
the base branch, so it must pass the same commit-msg rules). Close source branch after
merge: yes.

On GitHub with the `gh` CLI authenticated:
`gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>`.
On another host, use its CLI or connected tool if one is available; otherwise print the
host's new-pull-request link for the branch and base, built from the remote URL.

If the repo has a PR template, it defines the body — fill every section, delete none,
and still append the delivery note. Otherwise:

```md
Feature: <slug> · Ticket: <ticket or none> · Spec: <specs path, or "none — <one-line decision>">

## Summary
<what and why, 1–3 sentences>

## Changes
- <bullet per notable change, or a table where several units moved>

## Trade-offs
<what you accepted, and what you rejected and why>

## Docs updated
- <files changed by /ai-workflow:doc-sweep, or "Not needed: <reason>">

## How it was tested
- <commands run and their result (the /ai-workflow:verify report), new test count, and what you did NOT verify>

<the "## Delivery note" section from ${CLAUDE_PLUGIN_ROOT}/templates/delivery-note.md, filled in>

## Follow-ups
<e.g. "after merge: pointer bump for services/api">

Skip-Process: <only for a Path C change — why it needs no spec; delete otherwise>
```

**The delivery note is mandatory.** Run
`git diff --name-only origin/<base>...HEAD | grep 'contracts/provides.md'` and link every
changed `contracts/provides.md` in it, with its **Consumed by** rows. A breaking change
there names the receiving code owner who approved it (CODEOWNERS), or the PR is not
ready.

Evidence goes in the PR: the log line, the command output, the measured number. A claim
with a number beside it ends a review thread; one without it starts one.

## 4. Changes spanning repos

One PR per repo. Open the submodule PR(s) first and link them in the parent PR's
Summary. Merge order: submodule PRs, then the pointer bump, then the parent PR (or
combine the bump into it).
