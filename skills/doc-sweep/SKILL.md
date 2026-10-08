---
name: doc-sweep
description: Ship-time docs fix limited to the diff — find references the change made untrue and correct only those lines; never rewrite unrelated docs.
argument-hint: "[base ref — default: origin/main]"
---

# Doc sweep

Base: $ARGUMENTS (default `origin/main`)

Narrow by design: fix what **this diff** made untrue, nothing else. Do not re-read,
restructure or "refresh" unrelated docs.

1. **What changed.** `git diff --name-status <base>...HEAD` plus uncommitted changes.
   From the diff, list the identifiers whose meaning moved: renamed or deleted files and
   paths, renamed functions/types/fields/endpoints/env vars/commands, changed defaults,
   flipped statuses.
2. **Find the stale references.** For each: `git grep -n -F "<old name>" -- '*.md' '*.mdx'
   '.claude/**' '*.json' '*.yml' '*.yaml'` (and in each other repo the change touched).
   Expect zero hits outside history (retrospective, `## History`, superseded ADRs,
   changelogs) — history stays as written.
3. **Fix only those lines.** Edit the matching line to say what is now true. If a hit
   needs more than a line or two to correct, list it for the user instead of rewriting
   the section.
4. **Process statuses this change owns** (only these): the module's spec `Status:` and
   the spec index row; a shipped change's fold-back is `/ai-workflow:task` → B4, not this;
   an ADR this PR implements `Proposed` → `Accepted` with its index row.
5. **Report**: each file:line changed, or `Not needed: <reason>` (e.g. "no renamed or
   removed identifiers; internal refactor").
