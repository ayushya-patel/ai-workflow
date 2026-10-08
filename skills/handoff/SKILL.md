---
name: handoff
description: Write or update a resumable handoff for work that spans sessions or people — state, done, pending, how to verify — in docs/handoffs/<slug>-HANDOFF.md.
argument-hint: "<feature slug>"
---

# Handoff

Feature: $ARGUMENTS

1. Copy `${CLAUDE_PLUGIN_ROOT}/templates/handoff.md` to `docs/handoffs/<slug>-HANDOFF.md`
   (or update the existing one) in the repo that holds the feature's spec.
2. Fill it from the actual state, not memory: `git status`, `git log --oneline main..HEAD`
   and `git branch --show-current` in every affected repo; the plan's slices; the last
   `/ai-workflow:verify` result.
3. Keep `status: active` while work is paused; `/ai-workflow:doc-sweep` flips it at ship time.
4. Commit it on the feature branch (`docs(<scope>): update <slug> handoff`) so the next
   person gets it with the branch.
