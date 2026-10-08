# Changes

One folder per change to this module **after it first shipped**:
`changes/<nnn>-<slug>/` with its own `spec.md` → `plan.md` → `tasks.md`.

- Numbered sequentially within the module: `001-`, `002-`. A change has a number only
  once its folder exists — refer to one not yet created by what it will do, never by a
  guessed number.
- The change `spec.md` states what behaviour changes (user's point of view), what in the
  parent spec it **supersedes** (quote the line it replaces), whether
  `contracts/provides.md` changes and who that breaks, and what stays the same.
- A change gets **no `contracts/` of its own** — the module's already exist. List
  `../../contracts/provides.md` in the change plan's Touched surface and update it
  alongside the code.
- **When it ships, fold it back:** rewrite the parent `spec.md` (**Behaviour**, **How it
  works**) to describe the new reality, tick or remove the `## Deferred` entry it
  satisfied, add a row to the parent's `## History`, and set this change's `Status:` to
  `Shipped`.

The change folder is the permanent record of *why*. The parent spec is the answer to
*what is true now*. Never fork the parent into v1/v2.
