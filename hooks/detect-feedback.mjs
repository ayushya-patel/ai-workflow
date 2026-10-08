#!/usr/bin/env node
// UserPromptSubmit: when a prompt reads like a correction or a standing preference,
// remind Claude to log it in .claude/learnings.md. A heuristic, so it only nudges;
// Claude decides whether it is a lesson. Prints nothing otherwise.
import { readInput } from "./lib.mjs"

const { prompt } = await readInput()
if (
  typeof prompt === "string" &&
  /\b(no,|wrong|that's not|not what i|don't|do not|stop |instead|should have|shouldn't|always|never|from now on|going forward|next time|remember to|why did you)/i.test(
    prompt,
  )
) {
  process.stdout.write(
    "If this prompt corrects how you worked or states a standing preference, append a pending entry to .claude/learnings.md now (format: /ai-workflow:self-improve), then continue.\n",
  )
}
