# <Module name>

- **Status:** Draft
- **Spec ID:** NNN
- **Owner:** <name>
- **Ticket:** <link, or none>
- **ADRs:** <numbers, or none>

## Problem

What is broken or missing today, from the user's point of view. No solution here.

## Outcomes

What is true when this ships. Observable, not internal.

- [ ] <outcome>

## Out of scope

Explicitly not doing. **Do not leave this empty** — an agent with no scope boundary
invents one.

## Constraints

Hard limits: performance budgets, existing contracts, compliance, deadlines.

## Behaviour

User-visible behaviour, including the unhappy paths. No library names, no file
paths, no function signatures (Constitution Article II).

### Edge cases

| Case | Expected |
|---|---|
| <case> | <behaviour> |

## Verification

How we know it works. Each outcome above maps to at least one check here.

## Contracts

Detail lives in `./contracts/` — `provides.md` (what other modules may depend on) and
`requires.md` (what this module needs from upstream and from siblings).

Summarise here in two or three lines only; do not duplicate those tables.

- **Provides:** <the routes or surface this module exposes>
- **Requires:** <the systems and sibling modules it depends on>

## Open questions

Unresolved, but not yet expensive enough to be an ADR. Delete each line when it is
answered — if the answer turns out to be expensive to reverse, run `/ai-workflow:adr` instead.

- [ ] <question> — blocking / non-blocking

---

## How it works

> Appended when the module ships (Constitution Article VI). Delete this note then.

The actual runtime flow: entry point, what calls what, where data comes from, where
state lives, what happens on failure. A diagram if it earns its place.

## History

Changes made after this module first shipped. Each has its own folder under
`changes/` with a full spec → plan → tasks cycle.

**This file always describes current behaviour.** When a change ships, the sections
above are rewritten to match — not annotated with "but now it also…". The rows below
are how you find out *why* it is the way it is.

| Change | What changed | Date |
|---|---|---|
| — | *none since first ship* | — |
