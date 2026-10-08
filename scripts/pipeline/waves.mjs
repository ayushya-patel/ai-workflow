// Parallel waves of the pending tasks. Deterministic: same tasks in, same waves out.
import { compareIds } from "./tasks-parse.mjs"

const GLOB_CHARS = /[*?[{]/

// The literal directory part of a path; "" for a glob that starts with a wildcard.
function base(p) {
  const s = p.replace(/^\.\//, "").replace(/\/+$/, "")
  const i = s.search(GLOB_CHARS)
  return i < 0 ? s : s.slice(0, s.lastIndexOf("/", i))
}

export const pathsOverlap = (a, b) => {
  const x = base(a)
  const y = base(b)
  return x === "" || y === "" || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

// A task naming no files overlaps everything, so it runs alone. A glob counts as its
// literal directory prefix: over-serialising is safe, a missed overlap is not.
export function overlaps(a, b) {
  if (a.files.length === 0 || b.files.length === 0) return true
  return a.files.some((f) => b.files.some((g) => pathsOverlap(f, g)))
}

const fail = (message, ids) => ({ error: { message, ids } })

// Returns { waves: string[][] } or { error: { message, ids } }.
export function computeWaves(tasks, { cap = 3 } = {}) {
  const seen = new Set()
  const dup = new Set()
  for (const t of tasks) (seen.has(t.id) ? dup : seen).add(t.id)
  if (dup.size) return fail(`duplicate task ids: ${[...dup].join(", ")}`, [...dup])

  const done = new Set(tasks.filter((t) => t.done).map((t) => t.id))
  const pending = tasks.filter((t) => !t.done).sort((a, b) => compareIds(a.id, b.id))
  const known = new Set(tasks.map((t) => t.id))
  const unknown = [
    ...new Set(pending.flatMap((t) => t.dependsOn.filter((d) => !known.has(d)))),
  ].sort(compareIds)
  if (unknown.length) return fail(`unknown dependency: ${unknown.join(", ")}`, unknown)

  const waves = []
  const satisfied = new Set(done)
  let left = pending
  while (left.length) {
    const level = left.filter((t) => t.dependsOn.every((d) => satisfied.has(d)))
    if (level.length === 0) {
      const ids = cycleMembers(left)
      return fail(`dependency cycle: ${ids.join(", ")}`, ids)
    }
    let rest = level
    while (rest.length) {
      const wave = []
      const next = []
      for (const t of rest) {
        if (wave.length < cap && wave.every((w) => !overlaps(w, t))) wave.push(t)
        else next.push(t)
      }
      waves.push(wave.map((t) => t.id))
      rest = next
    }
    const ran = new Set(level.map((t) => t.id))
    for (const id of ran) satisfied.add(id)
    left = left.filter((t) => !ran.has(t.id))
  }
  return { waves }
}

// Tasks that no one can start: the cycle itself plus whatever waits on it. Prune the
// waiters (nothing left depends on them) so the error names the cycle.
function cycleMembers(left) {
  let ids = new Set(left.map((t) => t.id))
  for (let changed = true; changed; ) {
    changed = false
    for (const id of ids) {
      const needed = left.some((t) => ids.has(t.id) && t.id !== id && t.dependsOn.includes(id))
      if (!needed && !left.find((t) => t.id === id).dependsOn.includes(id)) {
        ids.delete(id)
        changed = true
      }
    }
  }
  return [...ids].sort(compareIds)
}

export function formatWaves(waves, tasks) {
  const browser = new Set(tasks.filter((t) => t.browser).map((t) => t.id))
  return waves
    .map((w, i) => `W${i + 1}: ${w.map((id) => (browser.has(id) ? `${id} [e2e]` : id)).join(" ")}`)
    .join("\n")
}
