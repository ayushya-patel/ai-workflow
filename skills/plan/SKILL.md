---
name: plan
description: Turn an approved spec into a technical plan with contracts (provides/requires); stops for review.
argument-hint: "<spec path or module slug>"
---

Write the plan for spec: $ARGUMENTS

`<specs>` is `.claude/ai-workflow.json` → `"specs"` (default `docs/specs`). Templates:
`<specs>/_template/` if the repo has one, else `${CLAUDE_PLUGIN_ROOT}/templates/specs/_template/`.

1. Read the spec. **If its status is not `Approved`, stop and say so.**
2. Read `${CLAUDE_PLUGIN_ROOT}/law/constitution.md`, the repo's `docs/adr/README.md`,
   its AGENTS.md / CLAUDE.md → **Local rules**, and every `.claude/rules/` file relevant
   to the surface this touches.
3. Explore the existing code before proposing structure. Follow patterns that are
   already here rather than introducing a second way to do the same thing.
4. Present 2–3 approaches with trade-offs and a recommendation. Wait for the user to
   pick.
5. Copy the template's `plan.md` alongside the spec and fill it in.
6. Copy the template's `contracts/` into the module folder and fill in both files. This
   is the step people skip, and it is the one that prevents a change here silently
   breaking a sibling module — or another team's.
   - `provides.md` — routes/endpoints, params, output and input shapes, status
     behaviour, and the **Consumed by** table
   - `requires.md` — only the upstream fields this module actually reads, each with
     `throw` or `degrade` behaviour, plus any sibling-module dependencies
   - For every sibling dependency you list in `requires.md`, open that module's
     `provides.md` and confirm it is listed there. If it is not, you are depending on
     internals — stop and raise it.
   - Reference upstream types from the repo's shared type location (generated
     contracts, SDK types). Never restate their fields.
   - **A change to a shipped module** (`<module>/changes/<nnn>-<slug>/`) gets no
     contracts of its own, because the module's already exist. Check its **Consumed
     by** now, list `provides.md` in the plan's Touched surface, and update it
     alongside the code. That way the contract never describes behaviour that has not
     shipped.
7. Update the `## Contracts` summary in `spec.md` to two or three lines pointing at
   `./contracts/`. Do not duplicate the tables.
8. Flag anything expensive to reverse — a dependency, a data boundary, a caching or
   auth choice. Each one needs an ADR (`/ai-workflow:adr`) before implementation, not
   after. List them explicitly at the end of your response.
9. **Stop.** Ask for review. Do not write `tasks.md`, and do not write code.
