#!/usr/bin/env bash
# Self-check for ci/check-process.sh. No framework — builds throwaway git repos and
# asserts exit codes. Run: bash tests/test-check-process.sh
# A repo using a copy at scripts/check-process.sh can run this against it:
#   GATE=scripts/check-process.sh bash <plugin>/tests/test-check-process.sh
set -uo pipefail

GATE="${GATE:-$(cd "$(dirname "$0")/.." && pwd)/ci/check-process.sh}"
GATE="$(cd "$(dirname "$GATE")" && pwd)/$(basename "$GATE")"
pass=0; fail=0
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

setup() { # -> echoes repo path, leaves HEAD on a branch off main
  d=$(mktemp -d)
  git -C "$d" -c init.defaultBranch=main init -q
  git -C "$d" config user.email t@t.t; git -C "$d" config user.name t
  mkdir -p "$d/src/app" "$d/docs/specs/001-cart" "$d/docs/adr"
  echo '{"dependencies":{"react":"19"},"devDependencies":{"vitest":"1"}}' >"$d/package.json"
  echo 'x' >"$d/src/app/root.tsx"; echo 'x' >"$d/docs/specs/001-cart/tasks.md"
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm init
  git -C "$d" checkout -qb feat
  echo "$d"
}

check() { # name expected_exit repo [pr_body] [extra args...]
  local name=$1 want=$2 repo=$3 body=${4:-} out got
  shift 4 2>/dev/null || shift $#
  out=$(mktemp)
  ( cd "$repo" && PR_BODY="$body" BASE_REF=main bash "$GATE" "$@" ) >"$out" 2>&1
  got=$?
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); printf '  ok    %s (exit %s)\n' "$name" "$got"
  else
    fail=$((fail+1)); printf '  FAIL  %s — wanted %s got %s\n' "$name" "$want" "$got"
    sed 's/^/          /' "$out"
  fi
  rm -rf "$repo" "$out"
}

echo "check-process.sh"

# 1. code without spec -> block
r=$(setup); echo 'change' >>"$r/src/app/root.tsx"
git -C "$r" commit -qam c
check "code without spec blocks" 1 "$r"

# 2. code with spec -> pass
r=$(setup); echo 'change' >>"$r/src/app/root.tsx"; echo '- [x] T1' >>"$r/docs/specs/001-cart/tasks.md"
git -C "$r" commit -qam c
check "code with spec passes" 0 "$r"

# 3. docs only -> pass (Article I exemption)
r=$(setup); echo 'words' >>"$r/docs/adr/README.md"
git -C "$r" add -A >/dev/null; git -C "$r" commit -qm c
check "docs-only passes" 0 "$r"

# 4. new runtime dep without ADR -> block
r=$(setup)
echo '{"dependencies":{"react":"19","lodash":"4"},"devDependencies":{"vitest":"1"}}' >"$r/package.json"
echo '- [x] T1' >>"$r/docs/specs/001-cart/tasks.md"
git -C "$r" commit -qam c
check "new runtime dep without ADR blocks" 1 "$r"

# 4b. ... with an ADR -> pass
r=$(setup)
echo '{"dependencies":{"react":"19","lodash":"4"},"devDependencies":{"vitest":"1"}}' >"$r/package.json"
echo '# ADR' >"$r/docs/adr/0001-lodash.md"
git -C "$r" add -A >/dev/null; git -C "$r" commit -qm c
check "new runtime dep with ADR passes" 0 "$r"

# 5. new devDependency only -> pass (Article IV: dev deps are free)
r=$(setup)
echo '{"dependencies":{"react":"19"},"devDependencies":{"vitest":"1","prettier":"3"}}' >"$r/package.json"
git -C "$r" commit -qam c
check "new devDependency passes" 0 "$r"

# 6. override in PR body -> pass with warning
r=$(setup); echo 'change' >>"$r/src/app/root.tsx"
git -C "$r" commit -qam c
check "Skip-Process override passes" 0 "$r" "Fixing a typo in a variable name.
Skip-Process: one-word rename, no behaviour change"

# 7. change folder inside a shipped module counts as a spec (Path B)
r=$(setup); mkdir -p "$r/docs/specs/001-cart/changes/001-optimistic"
echo 'change' >>"$r/src/app/root.tsx"
echo '- [x] T1' >"$r/docs/specs/001-cart/changes/001-optimistic/tasks.md"
git -C "$r" add -A >/dev/null; git -C "$r" commit -qm c
check "changes/ folder satisfies Article I" 0 "$r"

# 8. override with no reason -> still blocks
r=$(setup); echo 'change' >>"$r/src/app/root.tsx"
git -C "$r" commit -qam c
check "empty Skip-Process still blocks" 1 "$r" "Skip-Process:"

# 9. spec root from the 2nd arg (ai-workflow.json "specs")
r=$(setup); mkdir -p "$r/specs/001-cart"
echo 'change' >>"$r/src/app/root.tsx"; echo '- [x] T1' >"$r/specs/001-cart/tasks.md"
git -C "$r" add -A >/dev/null; git -C "$r" commit -qm c
check "custom spec root (arg) satisfies Article I" 0 "$r" "" main specs

# 10. ... and the default root is then not consulted
r=$(setup); echo 'change' >>"$r/src/app/root.tsx"; echo '- [x] T1' >>"$r/docs/specs/001-cart/tasks.md"
git -C "$r" commit -qam c
check "default root ignored when another is given" 1 "$r" "" main specs

# 11. unresolvable base -> could not run
r=$(setup)
check "unknown base ref exits 2" 2 "$r" "" no-such-ref

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
