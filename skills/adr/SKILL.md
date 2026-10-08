---
name: adr
description: Record an architecture decision — next number, from the template, Status Proposed, index row; supersede, never edit.
argument-hint: "<decision title>"
---

Write an ADR for: $ARGUMENTS

1. Read `docs/adr/README.md`. Take the next unused number — never reuse one, even if
   a previous ADR was rejected.
2. Copy `docs/adr/template.md` (or, if the repo has none,
   `${CLAUDE_PLUGIN_ROOT}/templates/adr.md`) to `docs/adr/NNNN-kebab-title.md`.
   `Status: Proposed` with today's date.
3. Fill it in. **Alternatives considered must have at least two real entries**; if
   you cannot name two, the decision has not been made yet — say so and stop.
4. Write **Context** for someone reading it in a year with no memory of today. Link the
   spec when there is one.
5. Add the row to the index table in `docs/adr/README.md` in the same change.
6. If this supersedes an existing ADR, set the old one's status to
   `Superseded by NNNN`. Do not edit its body — ADRs are immutable.
7. It becomes `Accepted` when the implementing PR merges (`/ai-workflow:doc-sweep`).
