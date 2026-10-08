# Tasks — Shapes

Intro text with a stray `- [ ]` that is not a task line.

- [ ] **T1 —** Single-line files
  - Files: `scripts/a.mjs`, `scripts/a.test.mjs`
  - What: do the thing
    and keep going on a wrapped line
  - Accept: `node --test scripts/a`
- [x] **T2 —** Wrapped files, done
  - Files: `scripts/b.mjs`,
    `scripts/b.test.mjs`
  - Accept: `node --check scripts/b.mjs`
  - Depends on: T1
- [ ] **T3 —** No files
  - Files: none (records its result in `plan.md`)
  - Accept: `test -f plan.md`
- [ ] **T3a —** A lettered follow-up
  - Files: `vite.config.ts` (`test.include` widens, only so new tests are found)
  - Accept: `grep -q include vite.config.ts`
  - Depends on: T1 and T3 (done), T2
- [ ] **T4 —** Missing Accept
  - Files: `x.md`
- [ ] **T5 —** Parenthesised directory name
  - Files: `app/(auth)/login.tsx`
  - Accept: `pnpm e2e -g "login"`

## Deferred

- [ ] **D1 —** Not a task
  - Files: `ignored.md`
