#!/usr/bin/env bash
# Self-check for hooks/guard-new-code.mjs. No framework — builds throwaway trees and
# asserts exit codes. Run: bash tests/test-guard-new-code.sh
#
# Exit 2 is the only code that blocks. A guard that means to block and exits 1 lets
# the write through while looking like it ran, so every case here asserts the number.
set -uo pipefail

GUARD="$(cd "$(dirname "$0")/.." && pwd)/hooks/guard-new-code.mjs"
pass=0; fail=0

setup() { # -> echoes a project root with "code": ["src/**"], one Draft spec, one src file
  d=$(mktemp -d)
  mkdir -p "$d/src/app/routes" "$d/docs/specs/001-cart" "$d/.claude" "$d/scripts"
  printf '# Cart\n\n- **Status:** Draft\n' >"$d/docs/specs/001-cart/spec.md"
  echo 'existing' >"$d/src/app/routes/cart.tsx"
  echo '{"code":["src/**"]}' >"$d/.claude/ai-workflow.json"
  echo "$d"
}

approve() { printf '# Cart\n\n- **Status:** Approved\n' >"$1/docs/specs/001-cart/spec.md"; }

# The PostToolUse branch reads `git status`, so its cases need a real repo with the
# existing files tracked. Config is neutered so a global gpgsign or hooksPath in the
# developer's environment cannot fail the test.
gitx() { env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$@"; }
git_init() {
  gitx "$1" -c init.defaultBranch=main init -q
  gitx "$1" add -A
  gitx "$1" -c user.email=t@t -c user.name=t commit -qm init
}

report() { # name want got outfile
  if [ "$3" = "$2" ]; then
    pass=$((pass+1)); printf '  ok    %s (exit %s)\n' "$1" "$3"
  else
    fail=$((fail+1)); printf '  FAIL  %s — wanted %s got %s\n' "$1" "$2" "$3"
    sed 's/^/          /' "$4"
  fi
}

check() { # name expected_exit root file_path — PreToolUse · Write
  local out; out=$(mktemp)
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$4" \
    | CLAUDE_PROJECT_DIR="$3" node "$GUARD" >"$out" 2>&1
  report "$1" "$2" "$?" "$out"; rm -f "$out"
}

check_post() { # name expected_exit root — PostToolUse · Bash
  local out; out=$(mktemp)
  printf '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"cat > src/x.tsx"}}' \
    | CLAUDE_PROJECT_DIR="$3" node "$GUARD" >"$out" 2>&1
  report "$1" "$2" "$?" "$out"; rm -f "$out"
}

echo "guard-new-code.mjs"

# The case the hook exists for.
r=$(setup)
check "new src file, no approved spec → blocked" 2 "$r" "$r/src/app/routes/checkout.tsx"
check "relative path, no approved spec → blocked" 2 "$r" "src/app/routes/checkout.tsx"

# The case that decides whether the team keeps the hook. A UI fix must never block.
check "edit to existing src file → allowed"      0 "$r" "$r/src/app/routes/cart.tsx"

# Not application code — Article I exempts scaffolding, config, and docs.
check "new file outside code globs → allowed"    0 "$r" "$r/scripts/build.mjs"
check "file outside the project → allowed"       0 "$r" "/elsewhere/src/x.tsx"

# Attributable escape hatch.
echo 'scaffolding the app, no module yet' >"$r/.claude/skip-process"
check "skip-process marker → allowed"            0 "$r" "$r/src/app/routes/checkout.tsx"
rm "$r/.claude/skip-process"

# Draft is not authorisation; Approved and In progress are.
check "still blocked while spec is Draft"        2 "$r" "$r/src/app/routes/checkout.tsx"
approve "$r"
check "new src file, spec Approved → allowed"    0 "$r" "$r/src/app/routes/checkout.tsx"

# A change spec in Path B authorises too.
r=$(setup); mkdir -p "$r/docs/specs/001-cart/changes/001-x"
printf -- '- **Status:** In progress\n' >"$r/docs/specs/001-cart/changes/001-x/spec.md"
check "change spec In progress → allowed"        0 "$r" "$r/src/app/routes/checkout.tsx"

# Opt-in: no "code" key, no guard.
r=$(setup); echo '{"specs":"docs/specs"}' >"$r/.claude/ai-workflow.json"
check "no \"code\" key → allowed"                 0 "$r" "$r/src/app/routes/checkout.tsx"
rm "$r/.claude/ai-workflow.json"
check "no ai-workflow.json → allowed"                0 "$r" "$r/src/app/routes/checkout.tsx"
echo 'not json' >"$r/.claude/ai-workflow.json"
check "broken ai-workflow.json → allowed"            0 "$r" "$r/src/app/routes/checkout.tsx"

# "specs" moves the spec root.
r=$(setup); echo '{"code":["app/**"],"specs":"specs/"}' >"$r/.claude/ai-workflow.json"
mkdir -p "$r/app" "$r/specs/001-a"
check "custom code glob, no spec → blocked"      2 "$r" "$r/app/x.ts"
printf -- '- **Status:** Approved\n' >"$r/specs/001-a/spec.md"
check "custom specs root, Approved → allowed"    0 "$r" "$r/app/x.ts"

# Just flipped to Shipped (uncommitted): the committed status still authorises.
p=$(setup); approve "$p"; git_init "$p"
printf '# Cart\n\n- **Status:** Shipped\n' >"$p/docs/specs/001-cart/spec.md"
check "flipped to Shipped, HEAD Approved → allowed" 0 "$p" "$p/src/app/routes/checkout.tsx"

# --- PostToolUse · Bash. The path a shell redirect takes; no file_path to inspect.
p=$(setup); git_init "$p"
check_post "clean tree → allowed"                        0 "$p"

echo 'written by a heredoc' >"$p/src/app/routes/checkout.tsx"
check_post "untracked src file, no approved spec → warns" 2 "$p"

mkdir -p "$p/src/modules/new"; echo 'x' >"$p/src/modules/new/a b.ts"
check_post "untracked file in new dir with a space → warns" 2 "$p"

echo 'why not' >"$p/.claude/skip-process"
check_post "skip-process marker → allowed"               0 "$p"
rm "$p/.claude/skip-process"

approve "$p"
check_post "untracked src file, spec Approved → allowed"  0 "$p"

# Untracked, but not application code.
p2=$(setup); git_init "$p2"
echo 'x' >"$p2/scripts/build.mjs"
check_post "untracked file outside code globs → allowed" 0 "$p2"

# A glob with no directory: whole tree is scanned.
p4=$(setup); echo '{"code":["*.tsx"]}' >"$p4/.claude/ai-workflow.json"; git_init "$p4"
echo 'x' >"$p4/scripts/widget.tsx"
check_post "basename glob matches anywhere → warns"      2 "$p4"

# No repo means no `git status`. Warning about nothing is worse than staying quiet.
p3=$(setup)
echo 'x' >"$p3/src/app/routes/checkout.tsx"
check_post "not a git repo → allowed"                    0 "$p3"

# A hook must never take the session down with it.
r2=$(setup)
printf 'not json' | CLAUDE_PROJECT_DIR="$r2" node "$GUARD" >/dev/null 2>&1
if [ $? = 0 ]; then pass=$((pass+1)); echo "  ok    malformed input → allowed (exit 0)"
else fail=$((fail+1)); echo "  FAIL  malformed input should not block"; fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
