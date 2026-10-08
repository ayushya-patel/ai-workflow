# Tasks — Fixture module

**Conventions every task follows** (named once so implementers do not each pick their own):
plain Node ES modules, no dependency, tests beside the code.

## Build

- [x] **T1 —** Already done
  - Files: `src/done.mjs`
  - Accept: `node --check src/done.mjs`
- [ ] **T2 —** First of four independent tasks
  - Files: `src/a.mjs`
  - Accept: `node --test tests/a.test.mjs`
- [ ] **T3 —** Second
  - Files: `src/b.mjs`
  - Accept: `node --test tests/b.test.mjs`
- [ ] **T4 —** Third, a browser check
  - Files: `src/c.mjs`
  - Accept: `CI=1 pnpm e2e -g "cart" && echo ok`
- [ ] **T5 —** Fourth, only greps for the browser command
  - Files: `src/d.mjs`
  - Accept: `grep -q 'pnpm e2e' src/d.mjs`
- [ ] **T6 —** Shares a file with T2 and waits for it
  - Files: `src/a.mjs`
  - Accept: `node --test tests/a2.test.mjs`
  - Depends on: T1 (done), T2
- [ ] **T7 —** Owns a directory
  - Files: `lib/`
  - Accept: `node --test tests/lib.test.mjs`
  - Depends on: T3
- [ ] **T8 —** Inside T7's directory
  - Files: `lib/x.mjs`
  - Accept: `node --test tests/x.test.mjs`
  - Depends on: T3
- [ ] **T9 —** Names no files
  - Files: none
  - Accept: `node --test tests/none.test.mjs`
  - Depends on: T6
- [ ] **T9a —** A follow-up found mid-build
  - Files: `docs/x.md`
  - Accept: `test -f docs/x.md`
  - Depends on: T6
- [ ] **T10 —** After the follow-up
  - Files: `docs/y.md`
  - Accept: `test -f docs/y.md`
  - Depends on: T9a

## Done when

All checked.

## Deferred

- [ ] **D1 —** Not a task
  - Why deferred: because
