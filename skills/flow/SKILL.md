---
name: flow
description: Append the shipped runtime flow (## How it works) to a module's spec — Constitution Article VI.
argument-hint: "<spec path or module slug>"
---

Document the flow for module: $ARGUMENTS

Constitution Article VI (`${CLAUDE_PLUGIN_ROOT}/law/constitution.md`). Run this when
the module's code merges.

1. Read the module's `spec.md` and `plan.md`.
2. Read the code that actually shipped. Trace it end to end — entry point, what calls
   what, where each piece of data comes from, where state lives, what happens on
   failure.
3. Replace the `## How it works` placeholder at the bottom of `spec.md` with what you
   found. Describe what shipped, **not** what the plan said would ship.
4. Where the code diverged from the plan, say so in one line each. Divergence is
   normal; silent divergence is the problem.
5. If the divergence was a decision rather than a detail, it needs an ADR — run
   `/ai-workflow:adr`.
