# Engineering discipline

Behavioural guardrails for all coding work in every repo, human or agent.
Adapted from Andrej Karpathy's four principles. Applies to everything, so it stays short.

## 1. Think before coding

- **Understand before changing.** Read the owning repo's `AGENTS.md` / `CLAUDE.md` and
  the code around the change first.
- **Requirements come from the repo's sources** (its context map: design docs, the
  architecture doc, the apps' needs). Don't invent features, endpoints or fields they
  don't call for.
- State assumptions out loud. If uncertain, ask — do not guess and proceed.
- When a request has two plausible readings, **present both**. Never pick silently.
  When it conflicts with a rule here, say so instead of guessing.
- Push back when a simpler approach exists. Say it in one line, then do as decided.
- When confused, stop and name what is unclear. Confusion that gets coded around
  becomes a bug with a confident commit message.
- A question ("can we…?", "is it possible…?") gets an answer and the approach, then
  waits for a go-ahead. It is not a request to edit.

This applies **during** implementation, not just at `/ai-workflow:spec` time. Ambiguity
found on task 3 of 8 gets surfaced then, not resolved by assumption.

## 2. Check what already exists

Before writing anything custom, check whether the framework already ships it (its
built-ins, official plugins and modules, router features) and
whether this codebase already has it. Re-implementing a built-in is the most expensive
mistake a repo can make. When unsure, ask the repo's docs agent or the framework docs.

## 3. Simplicity first

The minimum code that solves the stated problem. Nothing speculative.

- No features beyond what was asked. No field "for later".
- No abstraction with one caller. No factory for one product. No config or option for
  a value that never changes or that nobody sets.
- If 200 lines could be 50, write 50.

Test: would a senior engineer call this overcomplicated? Then simplify.

**Never simplified away** — this list is not negotiable and Simplicity First is not a
licence to skip it:

- Input validation at trust boundaries, and parsing of upstream responses
- Error handling that prevents data loss or renders wrong money
- The throw/degrade behaviour declared in `contracts/requires.md`, and the repo's
  error-boundary rule where it has one (both are Definition of Done Tier 1)
- Access control on every data collection and endpoint; transaction context passed
  through nested calls
- Security and accessibility basics
- Anything the user explicitly asked for

## 4. Surgical changes

Every changed line traces directly to the request.

- Do not "improve" adjacent code, comments, or formatting while you are in there.
- Do not refactor what is not broken. No drive-by renames.
- Notice unrelated dead code? **Mention it in the PR or summary. Do not delete it.**
- Remove imports, variables, functions and files that *your* change orphaned. Leave
  pre-existing dead code alone unless asked. No commented-out code, no TODO without a
  ticket.
- **Stay in the owning repo.** A change to a submodule is committed in that repo; a
  parent repo only records pointers and shared code.

**When existing code conflicts with the repo's rules:** the rules govern lines you add
or modify. Adjacent non-conforming code stays untouched and becomes its own task. New
work conforms; old work is migrated deliberately rather than opportunistically.

Why this one matters most: a diff where every line traces to the request is
reviewable, and it keeps `contracts/provides.md` → **Consumed by** meaningful. Drive-by
edits are how a two-file change becomes a five-file blast radius nobody predicted.

## 5. Goal-driven execution — verify, then claim

Each task in `tasks.md` carries an `Accept:` line, each spec carries **Verification**.
Honour them: the acceptance check is the goal, and you loop until it passes.

Turn imperatives into verifiable goals: "add validation" → "write tests for
invalid inputs, then make them pass." "Fix the bug" → "write a test that reproduces it,
then make it pass."

Never tick an acceptance check, or say something works, without running the command and
reading the output. **Done means verified:** `/ai-workflow:verify` passes (the repo's check,
`/ai-workflow:check`, its QA agents and `guardian`), tests cover the new behaviour, and docs
(`AGENTS.md`, README, the repo's AI-context index) are updated when behaviour, setup or
AI context changed. "I looked at one screen" isn't verification: check every place the
change renders or is called from.

## 6. Learn from every correction

A correction, a reviewer finding a rule should have prevented, or a skill step that
proved wrong is a defect in the setup. Log it **the moment it happens** as a `pending`
entry in the repo's `.claude/learnings.md` (format: `/ai-workflow:self-improve`); a subagent
reports a `Setup feedback:` line instead. Don't edit rules or skills silently mid-task:
`/ai-workflow:self-improve` turns entries into fixes, enforcement first.

## Is this working?

One countable indicator, because the honest ones are countable: **files touched per
PR, versus the plan's Touched surface table.** Consistently exceeding it means
Principle 4 is slipping.

The perceptual signals — "diffs feel cleaner", "fewer rewrites" — are exactly what the
39-point AI perception gap corrupts. Do not trust them as evidence.
