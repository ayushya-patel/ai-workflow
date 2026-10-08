---
name: task
description: Use whenever implementation work starts — build, add, fix, change, update, pick up or ship X. Triages A/B/C, then drives spec → plan → tasks → implement with checkpoints. Nothing gets built without a spec.
argument-hint: "<what to build, change or fix>"
---

# Task — the implementation workflow

Work: $ARGUMENTS

**This skill fires on intent, not on a typed command.** "Build me a cart" enters here
the same as `/ai-workflow:spec`. That is deliberate: a process you have to remember to
invoke is a process that applies only to whoever remembers, which is exactly how the
last project ended up with docs for one person's work and nothing for anyone else's.

Constitution Article I (`${CLAUDE_PLUGIN_ROOT}/law/constitution.md`): **no application
code without an approved spec.** CI enforces it (`${CLAUDE_PLUGIN_ROOT}/ci/check-process.sh`).
This skill is how you satisfy it, not a way around it.

## Repo settings

Read `.claude/ai-workflow.json` in the repo first. `<specs>` below means its `"specs"` value
(default `docs/specs`). The spec templates are in `${CLAUDE_PLUGIN_ROOT}/templates/specs/_template/`;
if the repo keeps its own `<specs>/_template/`, that one wins. The law is
`${CLAUDE_PLUGIN_ROOT}/law/` plus the repo's AGENTS.md / CLAUDE.md → **Local rules**.

---

## Step 0 — Pending learnings, then triage

**First action, every run:** if the session-start message reported pending learnings
in `.claude/learnings.md`, offer `/ai-workflow:self-improve` before starting anything new —
a lesson left pending is a mistake waiting to repeat.

Then classify. State the path in one line and wait for confirmation.

| Signal | Path |
|---|---|
| New module — nothing in `<specs>/` covers it | **A — New module** |
| Change to a module that already shipped | **B — Change** |
| Bug fix with real design surface, or a refactor | **A**, unless confidently a one-line fix with no design surface |
| Typo, formatting, dep version bump, docs-only, CI config | **C — Trivial** |
| Unsure | Ask. Do not default to C. |

> "Triage: optimistic cart updates — `001-cart` shipped in June, so Path B (change).
> This is deferred item D1 in its `tasks.md`. Proceeding to Step 1. Go?"

Create a todo list at phase granularity once the path is confirmed.

---

## Path A — New module

### A1. Interview before writing anything

**Batch the questions: up to 4 per `AskUserQuestion` call, calls back to back.** Each
question is still its own checkpoint — the value comes from the owner actually answering
each one, not from the message count. Do not draft the spec until every question is
answered. Never offer a "flagged default" in place of an answer: owners have rejected
that outright. If an interview is cut short, still ask every remaining question later —
never substitute a default for an answer the owner didn't give.

Shape each question like this (as the question text and options of the call):

```
## Question N — <one-line topic>

**Context:** 1–2 sentences on what is at stake.

**Options:**
- **a) <name>** — description, trade-off
- **b) <name>** — description, trade-off
- **d) don't build this / status quo** — include whenever applicable

**My recommendation: b** — one-line reason.
```

Rules that make this work:

- **Always offer the status-quo option** where it applies. The user must be able to
  reject the premise, not just choose an implementation of it.
- **Recommendation goes last**, never mid-question — it should not anchor the read.
- Every question has ≥2 real options. "What should X be?" is a worse question than
  "X could be a or b, I lean b."
- Only batch questions that are independent. A question whose options depend on another
  answer waits for the next call.
- One answer does not authorise the next decision. Never chain implicit approval.
- **When an answer's reason argues for a different option than its letter, ask which
  one was meant.** "a, because …" where the because describes b is two answers, and
  recording the letter puts the wrong one in the spec.
- **Restate what is already settled, in one line, when you move on.** Answers arrive
  out of order and a later one often reframes an earlier one. If Question 3's answer
  changed what Question 1 settled, say so — a resolved answer carried silently in your
  head is an assumption, and it ends up in the spec as a requirement nobody agreed to.
- **A name the user will see is the owner's call.** Any string that becomes a nav label,
  a URL, an endpoint, a collection name or a heading gets asked, even when a design file
  or ticket already shows one — a design is authoritative on layout and on what exists,
  never on a product name.
- Keep going until you can fill every section of the spec template without guessing.
  Especially **Out of scope** — an agent with no scope boundary invents one.

### A2. Write the spec

Next free number, `<specs>/<nnn>-<slug>/`, from the template's `spec.md`. Then re-read
it and fix inline: placeholders, sections that contradict each other, requirements
readable two ways, empty **Out of scope**.

**Stop. Ask for review.** Owner sets status to `Approved`. Nothing proceeds until then.

### A3. Onward

`/ai-workflow:plan` → `/ai-workflow:tasks` → `/ai-workflow:check` → implement → `/ai-workflow:flow` →
`/ai-workflow:check` → `/ai-workflow:verify`. Each has its own skill; follow them rather than
improvising. Add the module to `<specs>/README.md`.

```
/spec → /plan → /tasks → /check → implement → /flow → /check → /verify → PR
                  └── expensive-to-reverse decision? → /adr ──┘
```

### A4. Implementing — waves, one subagent per task, one browser run

Do **not** implement the task list yourself. Start Claude from the repo root, or the
repo's own agents do not load. `<scripts>` is `${CLAUDE_PLUGIN_ROOT}/scripts/pipeline`.
`.claude/ai-workflow.json` → `"e2e"` is the command that runs the repo's browser suite;
**no key means no browser step** — skip steps 5–7, and no task is tagged `[e2e]`.

1. **Waves.** `node <scripts>/cli-waves.mjs <module-dir>` prints the parallel waves of
   the pending tasks, at most 3 each. Tasks that depend on each other or share a file
   never share a wave, a ticked task counts as satisfied, a task naming no files runs
   alone. Exit 1 names a cycle or an unknown `Depends on` id: fix `tasks.md` and rerun.
   `[e2e]` marks a browser task.
2. **Brief.** For each task of the wave, `node <scripts>/cli-brief.mjs <module-dir> <id>`.
   That output, plus the notes below, is the whole prompt for the implementer. A `MISSING`
   line means the task is incomplete: fix the list first.
3. **Dispatch** the wave's `ai-workflow:task-implementer`s in the background, at most 3 (or
   the repo's own `task-implementer` if it defines one), and stay available to the owner.
   Start the next wave when every task in this one is ticked.
4. **Tick on return.** When one returns, run its static or unit `Accept:` yourself; if it
   is green, **immediately** tick the box in `tasks.md` and record the result. Not
   batched at the end — an unticked box after a compaction is work that gets done twice.
   A green report over a red check is reported, not ticked. A browser task is ticked on
   the same terms once its other checks are green; its implementer returns `browser
   check pending: <command>`. If it returns a question instead of a diff, answer it
   with the user. It cannot see them; that is the trade for the clean context.
5. **Browser run, once.** When every wave is done, run `"e2e"` once, for the whole
   suite. Never per task, never two runs at once.
6. **Rerun each failure once**, scoped to that check. One that passes is flaky: record
   it, do not judge it.
7. **Judge the survivors.** Dispatch `ai-workflow:failure-triager` with each check that still
   fails: its key, first error line and trace path. It reads and writes nothing else, and
   returns stale check, real defect or flake with evidence and a fix scope.
8. **Fixes are new tasks** (`T9a`), each through steps 1–5. A ticked task is never
   reopened.
9. **One whole-diff review**, after the browser run is green (with no `"e2e"` key: after
   the last tick): dispatch `ai-workflow:code-reviewer` with a dispatch-time `model: opus`
   on the module's whole diff. Once per task list, not per task. Findings become new tasks.
10. Then `/ai-workflow:flow` → `/ai-workflow:check` → `/ai-workflow:verify` (A5).

You hold the spec, the plan, and the remaining tasks. The subagents hold the file
reads. That is the entire point — a session that reads eight tasks' worth of files into
one window has already lost the spec to compaction by task five.

Tasks that touch the same file are never dispatched in parallel; the waves enforce it,
so a hand-dispatched task gets the same check.

When several implementers write sibling files at once, name the local conventions in
each brief (for example, "components carry no return-type annotation; helpers do").
Otherwise each picks its own, and the siblings drift apart.

The owner may be editing the same working tree while tasks run. Before each dispatch,
run `git status` and name any file changed outside this session in the brief, so the
implementer works around that edit instead of over it.

A requirement that changes while a task is running goes to the running implementer as
a message, not a restart. A check the change needs becomes a new task. A ticked task is
never reopened.

### A5. After the last task and the review — verify the composed feature

Green per-task checks do not prove the feature works. Run `/ai-workflow:verify`: it runs the
repo's check, `/ai-workflow:check` on the module, and dispatches the repo's QA agents plus
`ai-workflow:guardian` in parallel. For anything with runtime behaviour, also exercise the
composed feature end to end — every state, every breakpoint or client, every caller —
before calling it done.

---

## Path B — Change to a shipped module

For work like: *the demo went out, the client wants optimistic cart updates.*

### The rule: one spec per module, always describing today

Do **not** fork `spec.md` into v0 and v1. If current behaviour is spread across three
versioned files, answering "what does cart do right now?" means reading and mentally
merging all three — and that is the exact context the spec exists to provide.

Instead: the module's `spec.md` always describes **current reality**, and each change
gets its own folder with its own full cycle (see the template's `changes/README.md`).

```
<specs>/001-cart/
├── spec.md                    ← always current; carries ## History
├── plan.md
├── tasks.md
├── contracts/
└── changes/
    └── 001-optimistic-updates/
        ├── spec.md            ← what changes and why
        ├── plan.md
        └── tasks.md
```

### B1. Load the module

Read its `spec.md` (including `## How it works`), `tasks.md` → `## Deferred`, and
`contracts/provides.md` → **Consumed by**.

**Check `## Deferred` first.** If this change is already logged there, its
`Revisit when` trigger has fired — say so explicitly and carry the recorded reasoning
across. That entry is why the deferred list exists. Earlier changes' `plan.md` files
count too. A **Known limitation** there with a revisit trigger is a deferral in all but
name, and the module's `## Deferred` does not list it.

**Read Consumed by before designing.** Changing what a module provides is where a
one-module change becomes a four-module one — and, across repos, a change another
team must approve.

**Check what you are told against the source.** "X already does Y" is a premise until
the code confirms it. Read the code the change builds on before designing — a design
laid on behaviour that does not exist has quietly taken on building it too. A claim
about what a runtime (browser, framework, upstream API) does is checked the same way:
measure it, don't reason from the docs. They disagree more often than a plan can afford
to assume.

### B2. Interview, then write the change spec

Same question format as A1. Then `changes/<nnn>-<slug>/spec.md`, covering:

- What behaviour changes, from the user's point of view
- What in the parent spec this **supersedes** — quote the line it replaces
- Whether anything in `contracts/provides.md` changes, and who that breaks
- What stays the same (bounds the blast radius)

Number changes sequentially within the module: `001-`, `002-`.

A change has a number only once its folder exists. Refer to one that has not been
created yet — in this module or another — by what it will do, never by a guessed
`<nnn>-<slug>`: the number goes to whichever change is created first, and a guessed
reference ends up pointing at something else.

### B3. Plan, tasks, implement

As Path A. If the contract changes, update `contracts/provides.md` **and** open every
module in **Consumed by**.

### B4. Fold back into the parent — the step that gets skipped

When the change ships:

1. Update the parent `spec.md` so **Behaviour** and **How it works** describe the new
   reality. Do not append "…but now it's optimistic" — rewrite the affected lines.
2. Tick or remove the `## Deferred` entry this satisfied.
3. Add a row to the parent's `## History`:

   | Change | What changed | Date |
   |---|---|---|
   | [001](changes/001-optimistic-updates/spec.md) | Cart mutations apply optimistically | 2026-08-16 |

4. Set the change spec's own `Status:` to `Shipped`. Open work is listed from every
   change still `Approved` or `In progress`, so a finished change that skips this keeps
   resurfacing as unfinished.

The change folder is the permanent record of *why*. The parent spec is the answer to
*what is true now*. Neither substitutes for the other.

---

## Path C — Trivial

Skip the spec. Triage confirmation covers the design discussion.

CI will still ask for a `Skip-Process:` line in the PR body — that is the point, and it
takes five seconds. If you find yourself writing one every day, the triage table is
wrong and that belongs in the repo's `docs/retrospective.md`.

---

## Shipping

`/ai-workflow:verify` → `/ai-workflow:doc-sweep` → `/ai-workflow:commit` → `/ai-workflow:create-pr`.
Design approval is not commit authorisation: ask before committing, and again before
pushing.

---

## Capture insights as they happen

Insights fade inside one phase. Append a `pending` entry to `.claude/learnings.md`
(committed; format and loop in `/ai-workflow:self-improve`) **immediately** — never batch — when:

- The user corrects your approach
- A failure mode nearly slipped through
- An assumption in this skill turned out wrong
- A referenced path, command, or rule has moved
- Something worked well enough to repeat

Put where it happened in the heading (`### 2026-08-16 — [B4] forgot to update parent
spec.md, caught only at /check`). A task-implementer reports a `Setup feedback:` line
instead; you append it.

At the end of the work — the retrospective — re-read this work's entries, add any lesson
that only shows in hindsight, and if the repo has `docs/retrospective.md`, append a short
dated summary there (what went wrong, what changed). Then offer `/ai-workflow:self-improve`
to turn the entries into fixes: repo lessons change the repo's setup; anything wrong in
this skill or the law becomes a proposed ai-workflow plugin change, not a local copy. An
entry that would change nothing was not worth writing.

---

## Red flags

| Thought | Reality |
|---|---|
| "Small change, skip the spec" | Small changes are where the process is cheapest. Path C exists; use it openly. |
| "I'll ask one question, then guess the rest" | Batch them — up to 4 per call — and get every answer. A default is not an answer. |
| "They answered Q3, so Q1 still stands" | Answers reframe each other. Restate what is settled when you move on. |
| "The spec is clear enough, skip the interview" | Specs rot and assumptions hide. Run the questions or state explicitly that none are needed. |
| "This is a new module" (for something that shipped) | Grep `<specs>/` first. A second spec for the same module is how two truths start. |
| "I'll fork the spec into v2" | One spec per module, always current. Changes go in `changes/`. |
| "Code's merged, the change is done" | B4 exists because folding back is the step everyone skips. |
| "User approved the design, so I can commit" | Design approval is not commit authorisation. Ask separately. |
| "Typecheck passes, it's verified" | Run the actual thing — load the screen, call the endpoint. tsc is not runtime. |
| "I'll remember this for the retrospective" | You will not. Write it to the log now. |
| "I noticed some dead code, I'll clean it up" | Surgical changes. Mention it; do not delete it. |
| "I'll just implement these tasks myself" | A4. One subagent per task, or the window holds every file by task five. |
| "I'll tick the boxes when the module's done" | Tick on each return. Compaction does not wait for you. |
| "I'll run the browser suite after each task" | Once per task list (A4 step 5). Implementers run no browser; their tasks are ticked on the static and unit check. |
| "The triager says real defect, so I'll reopen T4" | A ticked task is never reopened. The fix is a new task (`T4a`). |
| "A hook blocked me, I'll write it elsewhere" | The hook is the law. Run `/ai-workflow:spec`, or record why the change is exempt where the repo's guard says to (e.g. `.claude/skip-process`). |
| "That file doesn't exist, I'll create it" | Run `git ls-files <path>` on its own first. A check at the end of an `&&` chain never runs if an earlier command fails. |
| "I'll run these Accepts in one command" | Run each Accept exactly as written, one per command. A multi-path test run can report only the first path's result, and a path filter matching no test file can fail the run. |
| "The dev server is up, so it serves my worktree" | In a worktree, a server started from the main checkout may already hold the port. Start your own on a free port with a strict-port flag, and confirm requests hit that port — e2e configs that reuse an existing server have the same trap. |
| "Typecheck and tests are green after the move, so the dev server is fine" | A long-running dev server can keep resolving a moved file's old path. Restart it before judging a browser or e2e run. |
| "The mutation failed nothing — I'll adjust the test until it does" | A surviving mutant is a finding: either the check or the mutation is wrong. Measure which. Never force a failure. |
| "Two design tools disagree; I'll trust the structured one" | When a design tool's metadata and its rendered screenshot disagree, trust the rendering's visual content; don't block on the metadata matching it. |
| "The owner's design rule applies the same way everywhere" | A blanket instruction doesn't always hold uniformly. Check every referenced frame or case on its own before applying a stated rule literally everywhere. |
| "This Accept is written, so it checks something" | List what a filter (`-g`, a test name pattern) matches before writing it into an Accept. A move-task's Accept also needs the linter on the moved folder, since a move can flip import order and line-fit. |
| "The new piece is inert until used, so mounting it in a shared wrapper is harmless" | Whatever it calls at render or start-up now runs everywhere the wrapper does. List those tests before the plan is approved, put any provider above the wrapper, and read each task's Accept against the test beside it: a check that can never go green is not a check. |
| "Every task's Accept check is green, so the feature works" | A unit test sees one piece with a mocked dependency. It cannot see a context mounted too narrowly for a sibling task's consumer, a store update nothing reads back, or an always-mounted body firing effects while closed. Exercise the composed feature (A5). |
