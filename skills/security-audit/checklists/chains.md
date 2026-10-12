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

Report the cheapest hop to break first. It is usually the boundary control: PKCE and
exact redirects, IMDSv2, HttpOnly, tool authorisation, SHA pins, cache keys.
