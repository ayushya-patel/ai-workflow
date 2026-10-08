// Reads a module's tasks.md (templates/specs/_template/tasks.md format). Pure: markdown in,
// plain objects out. A line it cannot read becomes a `missing` entry, never a throw.
const TASK_LINE = /^- \[([ xX])\] \*\*(T\d+[a-z]?)\s*[—–-]\*\*\s*(.*)$/
const ANY_BOX = /^- \[[ xX]\] /
const FIELD = /^ {2}- (Files|What|Accept|Depends on):\s?(.*)$/
const KEYS = { Files: "files", What: "what", Accept: "accept", "Depends on": "dependsOn" }

export const parseId = (id) => {
  const m = /^T(\d+)([a-z]?)$/.exec(id)
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, id]
}

// T9 < T9a < T10
export const compareIds = (a, b) => {
  const [an, as] = parseId(a)
  const [bn, bs] = parseId(b)
  return an - bn || (as < bs ? -1 : as > bs ? 1 : 0)
}

const backticked = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1])

// Paths are the backticked spans before the first "(" that is outside backticks; anything
// after it is commentary. `none` (or no backticks at all) means no files.
function filesOf(value) {
  let inTick = false
  let cut = value.length
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "`") inTick = !inTick
    else if (value[i] === "(" && !inTick) {
      cut = i
      break
    }
  }
  return backticked(value.slice(0, cut))
}

// A task is a browser task when one segment of its Accept command starts with the repo's
// browser command (ai-workflow.json "e2e"), cut at its first flag. A grep that merely names it
// does not count.
export function invokesBrowser(accept, e2e) {
  if (!e2e || !accept) return false
  const words = (s) => s.trim().split(/\s+/).filter(Boolean)
  const base = []
  for (const w of words(e2e)) {
    if (w.startsWith("-")) break
    if (base.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue
    base.push(w)
  }
  if (base.length === 0) return false
  const spans = backticked(accept)
  const commands = spans.length ? spans : [accept]
  return commands.some((cmd) =>
    cmd.split(/&&|;|\|/).some((seg) => {
      const w = words(seg)
      while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift()
      return base.every((b, i) => w[i] === b)
    }),
  )
}

export function parseTasks(markdown, { e2e } = {}) {
  const lines = markdown.split("\n")
  const tasks = []
  let cur = null
  let field = null
  const close = () => {
    if (!cur) return
    while (cur.block.length && cur.block[cur.block.length - 1].trim() === "") cur.block.pop()
    cur.block = cur.block.join("\n")
    const raw = cur.raw
    cur.files = "Files" in raw ? filesOf(raw.Files) : []
    cur.what = (raw.What ?? "").trim()
    cur.accept = (raw.Accept ?? "").trim()
    cur.dependsOn = [...new Set([...(raw["Depends on"] ?? "").matchAll(/\bT\d+[a-z]?\b/g)].map((m) => m[0]))]
    cur.missing = ["Files", "Accept"].filter((k) => !(k in raw))
    cur.browser = invokesBrowser(cur.accept, e2e)
    delete cur.raw
    tasks.push(cur)
    cur = null
    field = null
  }
  for (const line of lines) {
    if (/^## /.test(line)) {
      close()
      if (/^## Deferred/.test(line)) break
      continue
    }
    const t = TASK_LINE.exec(line)
    if (t) {
      close()
      cur = { id: t[2], done: t[1] !== " ", title: t[3].trim(), raw: {}, block: [line] }
      continue
    }
    if (ANY_BOX.test(line)) {
      close()
      continue
    }
    if (!cur) continue
    cur.block.push(line)
    const f = FIELD.exec(line)
    if (f) {
      field = f[1]
      cur.raw[field] = f[2]
    } else if (field && /^ {4,}\S/.test(line)) {
      cur.raw[field] += ` ${line.trim()}`
    }
  }
  close()
  return tasks
}

// The paragraph that starts "**Conventions every task follows", up to the next blank line.
export function conventionsBlock(markdown) {
  const lines = markdown.split("\n")
  const start = lines.findIndex((l) => l.startsWith("**Conventions every task follows"))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.trim() === "")
  return lines.slice(start, end < 0 ? undefined : end).join("\n")
}

// Body of a "## <heading>" section, without the heading line, trailing blanks trimmed. null if absent.
export function section(markdown, heading) {
  const lines = markdown.split("\n")
  const start = lines.findIndex((l) => l.trimEnd() === `## ${heading}`)
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end)
  while (body.length && body[0].trim() === "") body.shift()
  while (body.length && body[body.length - 1].trim() === "") body.pop()
  return body
}
