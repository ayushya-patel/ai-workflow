---
name: spec
description: Start a module or a change — triage A/B/C, interview, then write the spec. The explicit door into /ai-workflow:task.
argument-hint: "<module or change to start>"
---

Start work on: $ARGUMENTS

Follow `${CLAUDE_PLUGIN_ROOT}/skills/task/SKILL.md` from Step 0.

That skill also fires automatically on "build X" / "fix X" / "change X", so this
skill and a plain request take the same path. Typing it is just the explicit door.
