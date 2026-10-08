---
name: tasks
description: Decompose an approved plan into atomic tasks, each with one Accept check; stops for review.
argument-hint: "<spec path or module slug>"
---

Break down the plan for: $ARGUMENTS

`<specs>` is `.claude/ai-workflow.json` → `"specs"` (default `docs/specs`). Template:
`<specs>/_template/tasks.md` if the repo has one, else
`${CLAUDE_PLUGIN_ROOT}/templates/specs/_template/tasks.md`.

1. Read the spec and the plan. If the plan is not approved, stop.
2. Copy the template's `tasks.md` alongside them and fill it in. It opens with the
   **Conventions every task follows** paragraph: fill it once, so no implementer picks
   its own. Task ids are `T<number>`, with a letter (`T9a`) for a follow-up found
   mid-build. Write each task as the template shows (`- [ ] **T1 —** …`, then `Files:`,
   `Accept:`, `Depends on:`) and one `Accept:` per backticked command: the plugin's
   `scripts/pipeline/` scripts read this format.
3. Each task: one objective, the files it touches, one acceptance check, and its
   dependencies. If a task description needs the word "and", split it.
4. **The `Accept:` is the cheapest check that can fail if this task is wrong.** Not
   the most thorough one — the cheapest one that still goes red. It follows from what
   the task changes, so there is no "simple or important" call to make:
   - A contract row, a doc, a type-only change: `git diff <path>` or the repo's
     typecheck. A task with no observable behaviour never gets a browser or e2e run — a
     browser cannot see a markdown edit, so the diff is the *stronger* check there.
   - Behaviour you can assert in a unit test: the repo's test command scoped to that file.
   - Behaviour only a running system shows — layout, a computed token, timing, media,
     an integration with a real database or upstream: the e2e / integration suite,
     scoped (e.g. `-g`) to the tests it can fail.
   A browser-check `Accept:` is the repo's scoped browser command: `.claude/ai-workflow.json`
   → `"e2e"`, followed by the repo's test filter (Playwright: `-g "<title>"`), written as
   one backticked command. No `"e2e"` key: the repo has no browser step. Use its unit
   or integration check, or ask the owner which command covers it.
   Do **not** put the blanket `ai-workflow.json` → `"check"` in an `Accept:`. Lint and
   typecheck run at pre-commit and the full check runs in CI and `/ai-workflow:verify` — a
   per-task full check re-runs every gate to learn nothing new. Name the subset this
   task can break.
5. Order by dependency. A task must be executable without reading the others.
6. Every outcome in the spec's **Outcomes** section must be covered by at least one
   task. State the mapping in your response so gaps are visible.
7. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline/cli-waves.mjs <module-dir>`. A
   cycle or an unknown `Depends on` id exits 1 naming the ids: fix the list and rerun
   until it prints the waves.
8. **Stop.** Ask for review before implementing.
