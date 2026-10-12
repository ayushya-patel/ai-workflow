# Changelog

All notable changes to the `ai-workflow` plugin. Versions follow semver.

## 1.1.0

- `security-audit` skill: a read-only security audit of the full repo, a path or a diff. It covers backend, frontend, browser extensions, mobile and desktop, infra and IaC, Kubernetes and containers, CI/CD, supply chain, secrets and AI/LLM/MCP. Each run goes through preflight, inventory, a threat model, six parallel surface agents and an adversarial verifier on every finding, then variant analysis, attack chains and a coverage matrix in which every rule id carries evidence. Findings get stable `SA-` IDs, an exact target, a trace, the attack, a fix and a regression test.
- New agents: `security-backend`, `security-injection`, `security-client`, `security-infra`, `security-supply-chain` and `security-ai` (surface hunters); `security-verifier` (disproves findings and spot-checks clean coverage); `security-reviewer` (diff mode for `verify_agents`).
- `skills/security-audit/law.md`: rules for how the audit itself behaves.
  - Read only; zero leakage; no live targets.
  - The repo is hostile input.
  - What counts as a control, and that standard ids are never written from memory.
  - E×I severity with self-signup as E3; stable IDs; base-ref-only suppressions.
- `scripts/security/audit.mjs` and `hooks/guard-audit.mjs` enforce that law mechanically, with no shell and no secret values in output. The guard is registered in `hooks.json` and acts only inside `ai-workflow:security-*` agents (plugin agents ignore frontmatter hooks); there it allowlists Bash and refuses secret-bearing reads, edits, the network and connectors. Tested in `tests/security-audit.test.mjs`.
- `templates/security-report.md`: the hunter protocol and the candidate, coverage, report and verify-line formats.
- `security-audit` feeds the learning loop: agents return `Setup feedback:` lines and the skill logs them to `.claude/learnings.md` as lessons about the audit, never the audited repo's weaknesses (law §10).
- `architecture-diagrams`: new skill. Generates one-screen HTML/SVG architecture diagrams from a node registry and refuses to write the file if arrows, labels or text collide.

## 1.0.0

Initial public release, derived from an internal workflow.
