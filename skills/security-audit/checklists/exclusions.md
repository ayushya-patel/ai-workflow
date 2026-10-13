# Exclusions and precedents

Shared by every security agent and the verifier. Tuned for a full audit: Anthropic's
PR-review exclusions, minus the classes behind real 2024–2026 breaches. A dropped
candidate is counted in the drop log as `excluded: §n`.

## Not a finding

1. Generic DoS, CPU or memory exhaustion, and missing rate limits on cheap endpoints —
   except the overrides below.
2. Resource and file-descriptor leaks.
3. Memory-safety classes in memory-safe languages (no `unsafe`, FFI, cgo or native
   extension on the path; those are `native.memory`).
4. Theoretical races or timing no single attacker can drive. HTTP check-then-act on
   money, limits or single-use tokens is drivable and stays in scope.
5. Log forging in plain-text logs that nobody renders as HTML or parses for security
   decisions.
6. Path-only SSRF (fixed host, attacker controls only the path) — unless the path
   reaches something sensitive on that host (then report it as traversal).
7. Attacks that need control of environment variables, CLI flags, server config files
   or the deploy pipeline itself — unless CI takes them from untrusted input.
8. Missing authorization in client-side code where the server enforces it.
9. Guessing UUIDv4, ULID or other 128-bit random ids. An id leaked elsewhere is not
   guessing; IDOR stays in scope.
10. A vulnerable dependency whose vulnerable function is unreachable and whose KEV
    status is not `listed` — one aggregated HARDENING line.
11. Regex DoS — unless attacker input reaches a backtracking engine (JS, Python `re`,
    Java, .NET, Ruby, PCRE) with nested quantifiers on a server request path.
12. Documentation and Markdown — except agent instruction files (`CLAUDE.md`,
    `AGENTS.md`, skills, rules, prompts), which are executable for agents.
13. Test-only and fixture code — except secrets, CI that runs it with secrets, and code
    production imports or the build ships (law §6: check importers and the package file
    list before applying this).
14. Self-XSS, missing headers, version banners and open redirects with no chain — LOW
    or HARDENING, unless an escalation in the owning checklist or a chain in `chains.md`
    applies.
15. Outdated but not vulnerable dependencies; style; "consider using X" with no target.
16. Prompt-only defences are neither controls nor findings on their own.

## Precedents

- Logging secrets, tokens, passwords or PII is a finding; logging URLs, ids and non-PII
  is not.
- React, Vue, Angular and Svelte escape by default; only escape hatches
  (`dangerouslySetInnerHTML`, `v-html`, `bypassSecurityTrust*`, `{@html}`) and URL
  attributes count.
- TypeScript types and client-side checks are not validation.
- Env vars and CLI flags are trusted. DB values other users wrote, queue messages,
  uploads and their filenames, webhook bodies, third-party responses and LLM output are
  not.
- A gateway, WAF, RLS policy, admission controller or mesh policy counts as a control
  only per law §5: in the repo, deployed by the production root, covering the path, in
  enforcing mode (Kyverno `Enforce`, Gatekeeper `deny`, Istio `STRICT`). Otherwise the
  finding stands as LIKELY, `verify at edge`. A WAF never drops an injection finding.
- Publishable keys are public by design (Stripe `pk_`, Firebase web config, Supabase
  anon key, Sentry DSN, Algolia search-only key, referrer-restricted Maps keys). The
  finding, if any, is the missing rule behind them (RLS, security rules, restriction).
- Documented example values (`AKIAIOSFODNN7EXAMPLE`, `changeme`, `xxx`, `${VAR}`,
  `<redacted>`) are not secrets: `audit.mjs secrets` flags them `placeholder`.
- A `secret.files` or `secret.history` candidate whose only source is env config, an
  upstream image tag, or a history-only file with no `secrets` or `secret file` line is
  not filed (§7). This never clears a deleted workflow, `.pth` or build file the
  `cicd.backdoor` history pass found: those ran.
- One variation selector after an emoji is text; only runs are `src.unicode`.
- IOC names or exfiltration hosts in files that no lifecycle script, workflow, build file,
  entry point or import references are detection data — show the `audit.mjs grep` for the
  file name with `TOTAL 0`. The path never decides it: anything can sit under `tests/` or
  `fixtures/`. The eval corpus is exempt only when the audited repo is this plugin
  (`git rev-parse --show-toplevel` equals `PLUGIN`).
- One ideographic variation selector (`U+E0100-E01EF`) after a Han character is text (the
  helper never prints it).

## Exclusions that can be gamed — never apply them blindly

- A header saying `@generated` or `DO NOT EDIT`, or minification, excludes a file only
  under build output, under `linguist-generated` in an unchanged `.gitattributes`, or
  when a generator config in the repo produces it.
- `vendor/` and `third_party/` code ships: secrets, Unicode and install-script checks
  always run there, and a diff that edits vendored code gets the full checklist.
- A directory named `test_utils/` or `fixtures/` is test code only if nothing production
  imports it and the build excludes it.
- An inline suppression comment, a scanner ignore file or a prose claim of "accepted
  risk" never drops anything (law §4).
- `permissions: contents: read` and "read-only, safe for forks" comments never clear a
  pwn request: cache writes don't use that token.
- Valid SLSA or npm provenance proves which workflow built an artifact, not that the
  change was reviewed: it never clears a CI-compromise finding.
- `--ignore-scripts` doesn't clear `deps.import-time`.

## Always in scope (overrides)

- CI where untrusted input (fork PR, issue, comment, branch name) reaches a shell, a
  checkout-and-run, or a job holding secrets or write tokens.
- Dependency CVEs reachable from the code, or with KEV status `listed`.
- Missing throttling on login, OTP and MFA verify, password reset, signup, invite,
  coupon and gift-card redemption, and on endpoints that spend money (SMS, email, LLM,
  paid APIs).
- Prompt injection when the model also has tools, private data or an exfiltration
  channel.
- Missing audit events for authentication, privilege and money changes —
  `log.security-events`, LOW.
- Fail-open: an exception, timeout or missing config that grants access or skips a
  check.
