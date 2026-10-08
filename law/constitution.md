# Constitution

Project law for every repo. Overrides preference, habit, and convenience.
Changing an article requires an ADR and a plugin release (see the plugin README).

Paths below are relative to the repo. The spec root is `ai-workflow.json` → `"specs"`
(default `docs/specs`); ADRs live in `docs/adr/`.

## I. No code without a spec

No application code lands without an approved `spec.md`. This applies to humans and
agents equally, and to features, refactors, and non-trivial bug fixes alike.

Exempt: typo fixes, dependency version bumps, formatting, and changes under
`docs/`. CI enforces this (`ci/check-process.sh` in the ai-workflow plugin).

## II. Specs describe behaviour, not implementation

`spec.md` contains no library names, no file paths, no function signatures. If a
spec would survive swapping the framework underneath it for another, it is written
correctly. Implementation belongs in `plan.md`.

## III. One decision, one ADR

Any decision that is expensive to reverse gets an ADR: a dependency, a data
boundary, a caching strategy, an auth flow, a deployment shape. ADRs are immutable
— supersede, never edit.

## IV. No new runtime dependency without an ADR

Dev dependencies are free. Runtime dependencies are a permanent liability. The ADR
must state what it replaces and what it costs.

## V. Respect data ownership

Every piece of data has one owning system, and it is read through that owner. No
system becomes a cache for another or a second source of truth, and a missing value
is never papered over with an invented default. The repo's own data-boundary rules
(its AGENTS.md / CLAUDE.md → Local rules, or `.claude/rules/`) say which system owns
what and how this applies there.

## VI. Every module documents its own flow

When a module ships, a `## How it works` section is appended to its `spec.md`
describing the actual runtime flow. The spec is not done when the code merges; it
is done when it describes what merged.

## VII. Vendor tooling is not our code

Third-party agent plugins, skill caches, and generated tool directories are
gitignored. What we commit under `.claude/` is ours and is reviewed like code.
