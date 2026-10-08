import assert from "node:assert/strict"
import { test } from "node:test"
import { matchesAny, matchesGlob } from "../scripts/pipeline/glob.mjs"

test("** spans any depth, including none", () => {
  assert.ok(matchesGlob("src/**/*.ts", "src/a.ts"))
  assert.ok(matchesGlob("src/**/*.ts", "src/x/y/a.ts"))
  assert.ok(matchesGlob("tests/**", "tests/a/b.mjs"))
  assert.ok(!matchesGlob("src/**/*.ts", "lib/a.ts"))
})

test("* stays inside one segment, ? is one character", () => {
  assert.ok(matchesGlob("src/*.ts", "src/a.ts"))
  assert.ok(!matchesGlob("src/*.ts", "src/x/a.ts"))
  assert.ok(matchesGlob("src/a?.ts", "src/ab.ts"))
  assert.ok(!matchesGlob("src/a?.ts", "src/a.ts"))
})

test("a pattern with no slash matches the file name anywhere", () => {
  assert.ok(matchesGlob("*.test.mjs", "scripts/pipeline/glob.test.mjs"))
  assert.ok(!matchesGlob("*.test.mjs", "scripts/glob.mjs"))
})

test("regex metacharacters are literal", () => {
  assert.ok(matchesGlob("a+b.ts", "a+b.ts"))
  assert.ok(!matchesGlob("a.ts", "aXts"))
  assert.ok(matchesGlob("app/(auth)/*.tsx", "app/(auth)/login.tsx"))
})

test("matchesAny", () => {
  assert.ok(matchesAny(["x/**", "*.md"], "docs/a.md"))
  assert.ok(!matchesAny([], "a.md"))
})
