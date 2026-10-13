# Attack-chain catalogue

Used by `/ai-workflow:security-audit` after verification. Every hop must be a kept
finding. A chain takes the weakest hop's confidence and the worst outcome's severity; a
LIKELY hop caps it at HIGH as a `potential chain`. Never invent a hop: if one is missing,
name it and don't report the chain.

Primitives a finding can give: redirect · file read · file write · SSRF (GET or full) ·
user or email oracle · token in log, URL or storage · script in origin (XSS) · code
execution · CI token · writable artifact or cache · LLM tool call · tenant-id control ·
credential · cached private response · subdomain control · developer-machine execution.

| Chain | Hops (rule ids) | Outcome |
|---|---|---|
| OAuth code theft | `redirect.open` on an allowed redirect host + `authn.oauth` (prefix redirect_uri, no PKCE) | account takeover |
| XSS to takeover | `xss.*` + `storage.tokens` or `cookie.flags` (no HttpOnly) | account takeover |
| XSS to admin | stored `xss.*` + admin UI on the same origin | admin actions |
| SSRF to cloud | `ssrf` + `iac.compute` (IMDSv1, hop limit > 1) + `iac.iam` (broad role) | cloud account takeover |
| SSRF to internal | `ssrf` + `edge.exposure` or `iac.datastore` (actuator, unauthenticated Redis or Elasticsearch, admin UI) | code execution or data |
| Mass leak | `authz.bola` + ids enumerable or listed elsewhere | every record |
| Credential stuffing | `authn.bruteforce` (enumeration + no throttle) | many accounts |
| Reset poisoning | `authn.reset` (link host from a header) | account takeover |
| Identity collision | `authn.identity` (case or Unicode collision) + `authn.reset` or `authn.oauth` linking by email | account takeover |
| Tenant hop | `authz.mass-assignment` of tenant or owner id, or `authz.tenant` | cross-tenant access |
| Path to secrets | `file.traversal` + readable `.env`, service-account token or state file | lateral movement |
| Cache deception | `edge.proxy` or `pwa.cache` (extension-tolerant route + CDN caches `*.css`) + authenticated page | another user's tokens or PII |
| Cache poisoning | `edge.proxy` (unkeyed header reflected) + shared cache | stored XSS or redirect for every visitor |
| Subdomain takeover | `iac.dns` (dangling CNAME) + `cookie.flags` (`Domain=.parent`) or a CORS/CSP/OAuth allowlist naming the subdomain | session theft or token theft |
| Pwn request | `cicd.pwn-request` or `cicd.script-injection` + secrets or `id-token: write` | supply-chain compromise |
| CI to prod cloud | untrusted CI execution + `cicd.oidc-trust` wildcard + `iac.iam` escalation | cloud takeover |
| Release tamper | `cicd.pinning` or `cicd.runners-cache` + a release or publish job | malicious release |
| Confusion to CI | `deps.confusion` or `deps.install-scripts` + CI job with secrets | CI secrets and release tamper |
| Pod escape | code execution in a pod + `k8s.pod-security` (privileged, hostPath) + `k8s.rbac` (secrets) | cluster takeover |
| LLM exfiltration | `llm.injection` from stored content + `llm.output` (markdown images) or a fetch tool | data exfiltration |
| LLM privilege | `llm.injection` + `llm.agency` (service identity) | privilege escalation |
| Poisoned memory | `llm.memory` (untrusted write) + a later privileged session reading it | delayed injection with the victim's tools |
| Dev-machine RCE | `agent.config`, `dev.autorun` or `mcp.config` + a developer opening the repo | developer credentials, then the repo and CI |
| Desktop RCE | `xss.*` in a renderer + `electron.webprefs` (nodeIntegration, no isolation) | code execution on the desktop |
| Native bridge | `mobile.deeplinks` + `mobile.webview` bridge | native action as the user |
| Extension takeover | `ext.browser` (`externally_connectable` or message handler without sender check) + broad `host_permissions` | read every site the user visits |
| Leaked key | any `secret.*` + the key's scope in IaC or CI | whatever the key can do |
| Cache poisoning to release (Ultralytics 2024, TanStack 2026) | `cicd.pwn-request`, `cicd.script-injection` or `cicd.ai-agents` in any default-branch workflow + `cicd.runners-cache` (a release job restores a cache) + `deps.provenance` (OIDC publish, no environment) | malicious release with valid provenance |
| Agent to release (Clinejection 2026) | `cicd.ai-agents` (untrusted trigger, shell tools) + `cicd.runners-cache` (cache key shared with publish) | stolen publish tokens, malicious release |
| Stale branch to publish (Nx 2025) | `cicd.script-injection` or `cicd.pwn-request` on another ref (`audit.mjs workflows`) + `cicd.permissions` (write token dispatches publish) + `cicd.deploy-gates` (no environment) | registry token theft, then `deps.install-scripts` on consumers |
| Transitive tag hijack (tj-actions 2025) | `cicd.pinning` (a tag inside a composite action) + secrets in the job of a public repo | every consumer's secrets in public logs |
| Scanner action to publish (Bitwarden CLI 2026) | `cicd.pinning` (scanner action by tag in a write job) + `cicd.backdoor` (edited publish workflow) + `deps.provenance` (prebuilt artifact, no environment) | malicious release with valid provenance |
| Pushed workflow (GhostAction 2025, Shai-Hulud 2025) | `secret.*` or an off-repo account compromise + `cicd.backdoor` (no CODEOWNERS on `.github/`: `gov.guardrails`) + `cicd.oidc-trust` or `iac.iam` scope | every repo secret and a cloud foothold |
| Commit message to publish (AsyncAPI 2026) | `cicd.pwn-request` (persisted checkout credentials) + `cicd.deploy-gates` (release on a branch push or commit-message condition) + `deps.import-time` | import-time payload with valid provenance |
| Plan to prod | `cicd.iac-plan` + `iac.iam` (broad plan role) or `iac.state` (secrets in state) | cloud takeover |
| Build tamper (xz 2024) | `build.tamper` (build decodes test data) + `deps.provenance` (release not built from the tag) | backdoored release |
| Unanchored actor allowlist (CodeBreach 2026) | `cicd.other` (CodeBuild filter without `^…$`) + `cicd.permissions` (build holds a write credential) | repository takeover |
| Clone to RCE (CVE-2025-59536, CVE-2025-53773) | `agent.settings` (hook, endpoint override, auto-approve) or `llm.injection` + a file-write tool reaching agent settings (`llm.agency`) | developer credentials, then CI |
| MCP data theft (Supabase MCP 2025) | `mcp.config` (privileged DB credential) + `llm.injection` (user-written rows) + a write-back tool | secret exfiltration |
| Reset to attacker inbox (GitLab 2024) | `authn.reset` (request-derived recipient) | account takeover of any user |
| ORM filter oracle | `inj.orm-filter` (relation to a token or hash) + `authn.reset` | account takeover; with `authz.tenant`, every tenant's rows |
| SAML differential (ruby-saml 2025) | `authn.saml` (identity read outside the verified node) | log in as any user |
| Pre-account hijack | `authn.oauth` (merge by email without credential reset) + unverified local signup | persistent access to the victim's account |
| nOAuth | `authn.identity` (mutable email claim) + `authn.jwt` (multi-tenant issuer unbound) | cross-tenant account takeover |
| Cookie tossing | `iac.dns` or `xss.uploads` on a sibling subdomain + `cookie.flags` (OAuth state or verifier without `__Host-`) | account takeover or login CSRF |
| Email domain join | `authn.email-trust` (domain-based grant before verification) | attacker joins the victim's organisation |
| Shadow bucket | `iac.shadow-resource` + execution of the fetched object | code execution in CI or production |
| SaaS data theft (Snowflake 2024) | `secret.tracked` or `secret.files` + `iac.datastore` (password-only, no network policy) | bulk customer data |
| Stored-token pivot (Salesloft Drift 2025) | `cicd.backdoor` or `secret.*` + `iac.iam` + `authn.stored-tokens` | customer SaaS data across tenants |
| Dump to forged tokens (Storm-0558) | `data.dumps` (key in a crash dump) + `authn.jwt` (keys trusted across issuers) | forged tokens for other tenants |

Report the cheapest hop to break first. It is usually the boundary control: PKCE and
exact redirects, IMDSv2, HttpOnly, tool authorisation, SHA pins, cache keys.
