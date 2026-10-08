---
name: self-improve
description: Use when .claude/learnings.md has pending entries (the session-start message says so), when the user gives feedback about a skill, rule, agent or hook, or when asked to improve, fix, heal or retro the Claude setup. Turns logged lessons into edits to the repo's rules, skills, agents or hooks, or a proposed ai-workflow plugin change.
argument-hint: "[entry heading to process — default: every pending entry]"
---

# Self-improve — the fix step of the learning loop

Entries: $ARGUMENTS (default: every `pending` entry in `.claude/learnings.md`)

The loop, one per repo:

1. **Capture** — `.claude/learnings.md`, the moment something is learned (format below).
   The user corrects how you worked or states a standing preference · a skill step was
   wrong, missing or out of order · a reviewer finding a rule should have prevented ·
   the same finding a second time · a rule or skill contradicts the installed framework
   or its docs · something new was done with no skill covering it · `/ai-workflow:task`'s
   retrospective. Subagents don't write the file (parallel writes collide): they report
   a `Setup feedback:` line in their summary and the main session appends it. Test for
   an entry: would this matter in a different task next month?
2. **Nudge** — the plugin's `UserPromptSubmit` hook flags prompts that read like a correction.
3. **Surface** — the plugin's `SessionStart` hook prints the pending count (silent at zero).
4. **Fix** — this skill. Never edit a rule, skill or agent silently mid-task: log it,
   finish the task, then fix it here so the change is visible and reviewable.
5. **Review** — the changes land through normal git review, like code.

If `.claude/learnings.md` doesn't exist, create it from
`${CLAUDE_PLUGIN_ROOT}/templates/learnings.md`. Entry format:

```
### YYYY-MM-DD — <one-line lesson>
- **Status:** pending | applied → <file> | rejected — <why>
- **Source:** user correction | reviewer finding | implementer note | retrospective | new pattern | tool/doc mismatch
- **Target:** <the rule/skill/agent/hook it should change, "ai-workflow plugin", or "new skill?">
- **Evidence:** <what happened, 1–3 lines; quote the user when it was their words>
```

## 1. Read and group

Read every `pending` entry. Group entries that are the same lesson. Three reports of one
problem call for one fix, not three edits.

## 2. Decide where it belongs

- **The repo** — its own code, framework, conventions, QA agents. Fix it in the repo's
  `.claude/` (rules, skills, agents, hooks), its AGENTS.md / CLAUDE.md → **Local
  rules**, or its lint/format config.
- **The ai-workflow plugin** — the shared process: the workflow skills, the law, the
  plugin's hooks or agents, `ci/check-process.sh`. Never patch a local copy of plugin
  behaviour. Write the proposed change (file, diff, the evidence) for the plugin repo
  (its README → Release) and mark the entry `applied → proposed ai-workflow change: <summary>`.
  Lessons that show up in two repos are plugin lessons.

## 3. Pick the fix, strongest first

**Enforcement beats a rule, which beats a skill tweak.**

| If the lesson is… | Fix it with |
|---|---|
| Mechanically checkable (an import, a filename, a generated file, a pattern in code) | **Enforcement**: a lint rule, a hook, a CI check, or a `ai-workflow.json` key (`protected`, `append_only`, `code`). Prose is the fallback, not the first choice. |
| Recurring (a second occurrence of an existing rule being broken) | Enforcement if possible. Otherwise make the rule unmissable: move it up, say it in one line, add a bad/good example. |
| A convention or judgement | A line in the matching rule file, the one whose scope covers where the mistake happened |
| A wrong, missing or misordered procedural step | The skill's steps or its "Done when" checklist |
| An agent missing, over-reading or mis-reporting something | The agent's instructions or its return format |
| A procedure explained three times with no skill | A new skill (and the repo's AI-context index) |
| Contradicted by the installed framework | Verify against the installed version and its docs first, then correct every file that says it |

Also delete or merge rule text the lesson proves wrong or redundant. The setup should get
**shorter** as often as it gets longer. A rule nobody needs costs context in every
session.

## 4. Apply

- Edit the target file surgically, in its existing voice and format.
- One lesson, one coherent change. Keep a rule's single source of truth: fix it where
  it lives, don't copy it into a skill.
- If an edit is refused (the harness may treat edits to agent-instruction files as
  sensitive), **do not route around it**. Show the user the exact diff to apply
  themselves, and leave the entry `pending` with a note.

## 5. Guardrails: ask the user first when a change would

- relax anything on the law's "never simplified away" list
  (`${CLAUDE_PLUGIN_ROOT}/law/engineering-discipline.md` §3), or any access-control,
  secrets or other security rule or hook
- reverse a recorded decision (an ADR, a decision log)
- delete a skill, agent or hook
- rest on a single entry that looks like a one-off preference rather than a standing rule

Everything else applies directly. Git review of `.claude/` is the approval gate.

## 6. Close out

For each entry, set its status in place: `applied → <file(s)>` or `rejected — <reason>`.
Never delete entries; the file is the history of why the setup looks the way it does.

Then run the repo's check (`ai-workflow.json` → `"check"`) if you touched config it covers,
and pipe-test any hook you touched with a sample JSON input.

## Return

```
Applied   3  → .claude/rules/api.md (depth rule clarified), biome.json (+noRestrictedImports), .claude/skills/x (step 5 reordered)
Proposed  1  → ai-workflow plugin: task skill B4 should also update contracts/provides.md
Rejected  1  — one-off preference for a single migration name
Waiting   1  — relaxes the field-access rule; needs your call
```
