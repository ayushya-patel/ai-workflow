---
name: status
description: Rollup of pending and deferred work across modules, derived from the specs on disk.
argument-hint: "[module slug — default: all modules]"
---

Show status for: $ARGUMENTS (a module slug, or empty for all modules)

**Dispatch the `ai-workflow:spec-auditor` subagent to do this, and relay its table.** Pass it
this file's path (`${CLAUDE_PLUGIN_ROOT}/skills/status/SKILL.md`) as its checklist. With
no module named this reads every module's `tasks.md`, and the answer is one table.

Everything here is **derived from the specs on disk**. Never read it from a
hand-maintained list, and never update a stored count — a stored count is wrong within
a week.

## All modules

`S` is `.claude/ai-workflow.json` → `"specs"` (default `docs/specs`).

```bash
S=$(node -e 'try{process.stdout.write(require("./.claude/ai-workflow.json").specs||"")}catch{}' 2>/dev/null); S=${S:-docs/specs}
for f in "$S"/*/tasks.md; do
  [ -e "$f" ] || continue
  m=$(basename "$(dirname "$f")")
  [ "$m" = "_template" ] && continue
  p=$(awk '/^## Deferred/{exit} /^- \[ \]/{c++} END{print c+0}' "$f")
  d=$(awk '/^## Deferred/{f=1; next} f && /^- \[ \]/{c++} END{print c+0}' "$f")
  s=$(awk '/^- \*\*Status:\*\*/{sub(/^[^:]*:\*\* */,""); print; exit}' "$(dirname "$f")/spec.md" 2>/dev/null)
  printf '%-24s %-12s pending=%-3s deferred=%s\n' "$m" "${s:-?}" "$p" "$d"
done
```

Present as a table sorted by module ID. List any change (`<module>/changes/*/spec.md`)
still `Approved` or `In progress` as open work under its module. Then call out, in one
line each:

- Any module `In progress` with zero pending tasks — it is finished but unclosed, so
  `/ai-workflow:flow` and the definition of done have probably been skipped
- Any module `Shipped` with pending tasks — the tasks were abandoned, not done, and
  nobody recorded why
- The three highest `Cost to add later: high` deferred items across all modules

## Single module

Read that module's `tasks.md` and `spec.md`. Show:

1. **Pending** — unchecked tasks above `## Deferred`, with dependencies
2. **Deferred** — each with its reason, `Revisit when` trigger, and cost
3. **Open questions** from `spec.md`, blocking ones first
4. Any deferred item whose `Revisit when` trigger appears to have **already fired** —
   this is the most valuable thing this skill does, so check it properly rather than
   listing triggers back verbatim

## Note

Counts come from checkbox position relative to the `## Deferred` heading. A `tasks.md`
that does not follow the template's `tasks.md` will count wrong — if a module's
numbers look impossible, check its headings before believing the output.
