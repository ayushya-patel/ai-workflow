# Tasks — <Module name>

Derived from `plan.md`. Each task is atomic, independently reviewable, and has one
acceptance check. If a task needs the word "and", split it.

Write them so a competent junior could execute without asking a question.

**Conventions every task follows** (named once here so implementers do not each pick their own):
<language and module style, test runner and where tests live, what no task may add (dependencies, calls), the comment rule, how to run an `Accept:`>

Ids are `T<number>`, with an optional letter (`T9a`) for a follow-up found mid-build. The
ai-workflow task-pipeline scripts (`waves`, `brief`) read this format: keep `Files:`, `Accept:` and
`Depends on:` as written below, and `Files: none` for a task that touches no file.

- [ ] **T1 —** <single objective>
  - Files: `<path>`
  - Accept: `<the cheapest check that goes red if this task is wrong>`
- [ ] **T2 —** <single objective>
  - Files: `<path>`
  - Accept: `<check>`
  - Depends on: T1

## Done when

All tasks above checked, the definition of done (ai-workflow plugin `law/definition-of-done.md`) satisfied, and `## How it
works` appended to `spec.md` via `/ai-workflow:flow`.

## Deferred

Work we consciously chose not to do now. **This section survives the module
shipping** — it is the only record of what was punted and why.

Every entry needs a `Revisit when`. A deferred item with no trigger is a wish, and
wishes are how a backlog turns into landfill. If you cannot name the condition, it is
not deferred — move it to **Out of scope** in `spec.md`.

- [ ] **D1 —** <what we are not doing>
  - Why deferred: <the actual reason, not "no time">
  - Revisit when: <observable trigger — a metric, a launch, a dependency landing>
  - Cost to add later: low / medium / high — and what makes it so

Run `/ai-workflow:status` for the rollup across every module.
