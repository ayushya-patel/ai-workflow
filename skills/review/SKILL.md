---
name: review
description: Review changes with the ai-workflow code-reviewer agent — uncommitted work in the repo and every submodule by default, or a branch/path/PR given as argument. Findings by severity and a verdict. Use when asked to review code or a diff.
context: fork
agent: ai-workflow:code-reviewer
argument-hint: "[branch | path | 'staged' — default: all uncommitted changes]"
---

Review: $ARGUMENTS

If no target is given, review all uncommitted and staged changes in the repo and in
every submodule that has changes. Follow your review checklist and report format.
