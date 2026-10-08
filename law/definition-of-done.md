# Definition of done

Identical for every module in every repo — which is why it lives here once instead of
being copied into each spec folder.

**Two tiers, deliberately.** An earlier version of this file had 24 flat checkboxes.
Research on LLM agents found performance drops ~30 points (a 40% relative loss) as
structural constraints accumulate ([constraint decay](https://arxiv.org/html/2605.06445v1)),
and WHO surgical-checklist compliance plateaus around
[73%](https://link.springer.com/article/10.1186/s12913-025-12569-0) even where lives
are at stake. A list nobody completes enforces nothing. So the blocking tier is kept
short enough to actually clear.

Module-specific acceptance lives in its own `spec.md` → **Verification**. This file is
the floor beneath that. A repo may add Tier 1 items in its AGENTS.md / CLAUDE.md →
**Local rules** (for example a UI repo's error-boundary rule); `guardian` reads both.

---

## Tier 1 — Blocking

**Nine items. A module does not ship until all nine are true**, and CI or `/ai-workflow:verify`
checks each one. No exceptions without a written note in the PR.

- [ ] `ai-workflow.json` → `"check"` passes, with no suppressions added
- [ ] The unit tests pass
- [ ] The repo's end-to-end / integration suite passes, where the repo has one
- [ ] Every money path and every new branch has a test
- [ ] Every failure path declared in `contracts/requires.md` (`throw` / `degrade`) is
      implemented, and every entry point (route, handler, job) has an error path that
      does not crash or leak upstream errors
- [ ] No value (a price, a total, a status, a name) originated outside the system that
      owns it — including fallbacks like `price ?? 0` (Constitution Article V)
- [ ] User-facing UI: keyboard reachable with visible focus, and every control has an
      accessible name
- [ ] `## How it works` appended to `spec.md` (`/ai-workflow:flow`)
- [ ] No new runtime dependency without an ADR (Constitution Article IV)

## Tier 2 — Expected

Review-time judgement, not a gate. Reviewers report these as **Should fix**. Skip one
and say why in the PR; skip them habitually and Tier 1 stops being believed either.

**Runtime safety**
- [ ] Failures surface as the repo's error type (thrown `Response`, problem+json, …),
      not a returned ad-hoc error shape
- [ ] Upstream shape mismatches are caught at the parse boundary, not in render or in
      business logic
- [ ] No console errors or warnings in dev; no unhandled promise rejections

**Data**
- [ ] Every network call goes through the repo's single client layer — none anywhere else
- [ ] A missing content field degrades gracefully; a missing commerce field throws

**Accessibility** (user-facing UI)
- [ ] Loading and error states are announced, not silent
- [ ] Colour is never the only carrier of meaning
- [ ] Tab order follows visual order

**Documentation**
- [ ] Decisions that changed the plan have an ADR (`/ai-workflow:adr`)
- [ ] `## Deferred` filled in, each entry with a `Revisit when`
- [ ] `## Open questions` cleared, or each remaining one marked non-blocking
- [ ] `contracts/provides.md` → **Consumed by** reflects reality
- [ ] Spec status set to `Shipped`, the spec index (`<specs>/README.md`) updated

**Hygiene**
- [ ] No commented-out code, no `console.log`, no unreferenced files left behind
- [ ] `/ai-workflow:check` reports no blocking findings

---

## Moving an item between tiers

Promotions to Tier 1 need a line in the repo's `docs/retrospective.md` saying what went
wrong to earn it, and a plugin release. Tier 1 grows only from evidence, never from good
intentions — that is the whole mechanism keeping it short.
