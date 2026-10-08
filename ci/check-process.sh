#!/usr/bin/env bash
# Process gate — Constitution Articles I and IV (ai-workflow plugin, law/constitution.md).
#
# Moves those two articles from advisory to enforced: markdown asks, CI tells.
# Run from the repo root:
#
#   check-process.sh [base-ref] [spec-root]   default base: origin/main
#                                             default spec root: docs/specs
#
# Env:
#   BASE_REF   alternative to the first positional arg
#   SPEC_ROOT  alternative to the second (match ai-workflow.json "specs")
#   ADR_ROOT   where ADRs live, default docs/adr
#   PR_BODY    PR description; an override is read from here
#
# Exit: 0 pass or overridden · 1 violation · 2 could not run
set -uo pipefail

BASE="${1:-${BASE_REF:-origin/main}}"
SPEC_ROOT="${2:-${SPEC_ROOT:-docs/specs}}"; SPEC_ROOT="${SPEC_ROOT%/}"
ADR_ROOT="${ADR_ROOT:-docs/adr}"; ADR_ROOT="${ADR_ROOT%/}"
PR_BODY="${PR_BODY:-}"

git rev-parse --verify "$BASE" >/dev/null 2>&1 || {
  echo "::error::cannot resolve base ref '$BASE' — CI needs fetch-depth: 0"
  exit 2
}

changed=$(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD) || exit 2
[ -z "$changed" ] && { echo "no changes"; exit 0; }

# App code: source files outside the docs/tooling tree. Everything else is exempt
# (Article I exempts docs, formatting, and version bumps).
code=$(printf '%s\n' "$changed" \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|css)$' \
  | grep -Ev '^(docs|scripts|\.claude|\.github)/' || true)

# A numbered folder directly under a root: <root>/<digit>… (literal prefix, no regex).
under() { printf '%s\n' "$changed" | awk -v p="$1/" 'index($0, p) == 1 && substr($0, length(p) + 1, 1) ~ /[0-9]/'; }
specs=$(under "$SPEC_ROOT")
adrs=$(under "$ADR_ROOT")

# New *runtime* dependencies only — devDependencies are free (Article IV).
new_deps=""
if printf '%s\n' "$changed" | grep -qx 'package.json'; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  git show "$BASE:package.json" >"$tmp/old.json" 2>/dev/null || echo '{}' >"$tmp/old.json"
  new_deps=$(node -e '
    const fs = require("fs");
    const deps = p => { try { return JSON.parse(fs.readFileSync(p,"utf8")).dependencies || {}; }
                        catch { return {}; } };
    const [o, n] = [deps(process.argv[1]), deps(process.argv[2])];
    console.log(Object.keys(n).filter(k => !(k in o)).join("\n"));
  ' "$tmp/old.json" package.json 2>/dev/null || true)
fi

fail=0

if [ -n "$code" ] && [ -z "$specs" ]; then
  fail=1
  echo "::error::Article I — application code changed with no spec touched."
  echo
  echo "  Code changed:"
  printf '%s\n' "$code" | sed 's/^/    /'
  echo
  echo "  Expected: this PR also touches $SPEC_ROOT/<nnn>-<slug>/ — normally the"
  echo "  tasks.md checkboxes you completed. Run /ai-workflow:spec if no spec exists yet."
  echo
fi

if [ -n "$new_deps" ] && [ -z "$adrs" ]; then
  fail=1
  echo "::error::Article IV — new runtime dependency with no ADR."
  echo
  echo "  Added to dependencies:"
  printf '%s\n' "$new_deps" | sed 's/^/    /'
  echo
  echo "  Expected: a new $ADR_ROOT/NNNN-*.md stating what it replaces and what it"
  echo "  costs. Run /ai-workflow:adr. (devDependencies do not need one.)"
  echo
fi

[ "$fail" -eq 0 ] && { echo "process gate: pass"; exit 0; }

# Override: allowed, but attributable. Silent skipping is the failure mode this
# whole process exists to prevent.
reason=$(printf '%s\n' "$PR_BODY" | grep -iE '^[[:space:]]*Skip-Process:[[:space:]]*[^[:space:]]' | head -1 || true)
if [ -n "$reason" ]; then
  echo "::warning::Process gate overridden — $reason"
  echo "Recorded on the PR. Frequent overrides belong in the retrospective."
  exit 0
fi

echo "To override, add a line to the PR description:"
echo
echo "    Skip-Process: <why this change does not need a spec>"
echo
echo "It is logged as a warning on the PR — visible and attributable, not silent."
exit 1
