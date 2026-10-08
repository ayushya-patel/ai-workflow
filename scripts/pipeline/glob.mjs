// Glob matching for rule `paths:` frontmatter and for file overlap. Same dialect as
// hooks/lib.mjs: ** any depth (including none), * one segment, ? one character, and a
// pattern with no "/" matches the file name anywhere.
import path from "node:path"

export function matchesGlob(pattern, file) {
  const target = pattern.includes("/") ? file : path.posix.basename(file)
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*|\?/g, (t) =>
      t === "**/" ? "(?:.*/)?" : t === "**" ? ".*" : t === "*" ? "[^/]*" : "[^/]",
    )
  return new RegExp(`^${re}$`).test(target)
}

export const matchesAny = (patterns, file) => patterns.some((p) => matchesGlob(p, file))
