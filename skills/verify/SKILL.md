---
name: verify
description: Run before declaring work done, committing or opening a PR — the repo's check, /ai-workflow:check for the touched module, then the repo's QA agents and guardian in parallel; one PASS/FAIL list.
argument-hint: "[base ref or path — default: uncommitted changes, else the branch vs main]"
---

# Verify

Scope: $ARGUMENTS

Read `.claude/ai-workflow.json`. Missing keys: `"check"` → none (say so in the report),
`"specs"` → `docs/specs`, `"verify_agents"` → `[]`.

## 1. The diff

Collect what is under review once, so every agent judges the same thing:

```sh
git status --short
git diff HEAD                        # uncommitted, staged and unstaged
git diff origin/main...HEAD          # if the working tree is clean: the branch
```

Use the scope argument instead when one is given (a base ref, a path). Note the exact
`git diff` command that shows the change and the list of changed files. Don't write the
diff to a file: a path outside the repo (such as `/tmp`) needs approval and the agents
can't read it. Each agent runs the same `git diff` command itself.

## 2. The repo's check

Run `ai-workflow.json` → `"check"` exactly as written and read the output. FAIL if it exits
non-zero. Never call it passing without the output.

## 3. The spec gate

For each module under `<specs>/` that the diff touches — or whose spec, plan or
**Touched surface** names a changed file — run `/ai-workflow:check <module>` (it dispatches
`ai-workflow:spec-auditor`). Any **Blocking** finding is a FAIL. No spec folder for the
changed code: report "no spec — Path C?" and let `guardian` judge Article I.

## 4. Agents, in parallel

In **one message**, dispatch every agent named in `"verify_agents"` **plus
`ai-workflow:guardian`**, each with: the exact `git diff` command, the changed-file list, the module
spec path (if any), and "report PASS or FAIL lines `file:line · rule · fix`". Repo-local
QA agents (e.g. a `qa-lead`) are named here; this skill does not replace them.

An agent that cannot be found is a FAIL line (`ai-workflow.json · verify_agents · agent
<name> not found`), not a silent skip. An agent that returns a plan instead of a verdict
(a QA lead) — run what its plan says, no more and no less, and report the result.

## 5. Report

One consolidated list, no narration:

```
PASS  check            pnpm check (exit 0)
FAIL  check:013-auth   Blocking — requires.md row has no throw/degrade
PASS  guardian
FAIL  qa-ui            src/x.tsx:12 · focus not visible · add focus ring
Verdict: FAIL (2)
```

`Verdict: PASS` only when every line is PASS. Do not fix anything here; the caller
decides.
