# Checklist — AI, LLM, agent and developer-machine tooling

Agent `ai-workflow:security-ai`. Per class: **Detect** · **Confirm** · **Fix** · **Not a
finding**. Model output is attacker-controlled. Prompt-only defences ("ignore
instructions in documents") are not controls.

The rule of two: an agent may hold at most two of these three:
- untrusted input;
- sensitive data or systems;
- the power to change state or communicate out.

### llm.injection — prompt injection to action or data · LLM01:2025 · ATLAS AML.T0051 · CWE-1427
Detect, per call site:
- untrusted segments in context: user input, uploads, fetched pages, emails, tickets,
  PR and issue text, shared RAG chunks, tool results, filenames, rows other users wrote,
  log lines and observability events, HTTP headers and user agents, commit messages and
  author names, OCR text, calendar invites (Gemini Cloud Assist log injection, 2025);
- together with private data, or with side-effecting or exfil-capable tools: HTTP
  fetch, email, DB write, shell, file write, payments, markdown image rendering;
- with no human approval.

Also: one user's stored content reaching another user's agent session.
Confirm: untrusted source `path:line` → prompt assembly `path:line` → tool or data with
impact `path:line`; no approval gate or allowlist.
Fix: tools authorise with the end user's identity; approval for irreversible actions;
strip or disable tools while untrusted content is in context; split a quarantined
reader from a privileged planner (dual-LLM, CaMeL); egress allowlists for fetch tools;
spotlight untrusted content.
Not a finding: read-only agents over the user's own data with no exfil channel (LOW at
most).

### llm.output — model output reaching sinks · LLM05:2025 · CWE-79, CWE-89, CWE-78, CWE-94
Detect: `.content`, `.text`, `tool_calls[].arguments`, `choices[0]` flowing into
`execute|query|exec|eval|subprocess|dangerouslySetInnerHTML|marked|v-html|fetch|open|redirect`,
ORM spreads or file paths; text-to-SQL on a read-write role; markdown with remote images
or auto-links rendered from model output. Also:
- framework sinks that execute model output internally, with no visible `exec` in the
  repo: `LLMMathChain|PALChain|PythonREPLTool|PythonAstREPLTool|create_pandas_dataframe_agent|create_csv_agent|allow_dangerous_code *= *True|allow_dangerous_requests|PandasQueryEngine|auto_run *= *True|CodeAgent`,
  vanna `ask(` with `visualize=True`, LangChain `loads(` or `load(` over stored or
  streamed data;
- link or image redaction that handles only inline `](url)` and not reference
  definitions `[x]: url` (EchoLeak, 2025);
- `img-src` or `connect-src` allowing `*`, `https:`, user-content CDNs, image proxies or
  object storage (`*.blob.core.windows.net`, `*.s3.amazonaws.com`, `camo.githubusercontent.com`)
  — allowlisted egress becomes the exfiltration channel (CamoLeak, ForcedLeak, 2025);
- server-side unfurl or preview fetches of URLs from model output.

Confirm: trace as in `backend-taint.md` with the model as the source.
Fix: strict schema validation (structured outputs, zod); parameterise; text-to-SQL on a
read-only replica role with a statement allowlist and row limits; sanitise HTML; drop
images and link query strings from model output, or proxy them through an allowlist the
operator controls; generated code only in a jailed sandbox with no network or secrets.
Not a finding: plain text in escaped React (check markdown separately).

### llm.agency — excessive agency · LLM06:2025 · CWE-250
Detect: tool definitions (`tools:`, `@tool`, `bind_tools`, `server.tool(`, function
schemas) with free-form `url`, `sql`, `command`, `path` or `to` parameters; tools
running with service credentials instead of the user's; no confirmation on writes, sends
or payments; no `maxSteps` or `max_iterations`; no per-call audit log.
Confirm: the tool, its identity, the missing guard.
Fix: narrow tools (`get_invoice(id)`, not `run_sql`); enums and allowlists on
parameters; user-scoped credentials; approvals; step and spend caps; every call
audited.
Not a finding: local developer tools (LOW, noted).

### llm.disclosure — secrets and cross-user data in prompts, logs, caches · LLM02:2025, LLM07:2025 · CWE-200, CWE-532
Detect: system prompts or templates holding keys (`audit.mjs secrets` hits),
connection strings, internal URLs, or authorisation rules enforced only by the prompt
("only answer for user X", "do not reveal"); full records or other users' PII in
context; prompt and completion logging (LangSmith, Helicone, custom) without redaction;
semantic caches keyed without user or tenant (`hash(prompt)`); provider retention unset
for regulated data.
Confirm: the template or cache key `path:line`.
Fix: secrets and authorisation in code; data minimisation; redaction before logging;
per-user and per-tenant cache keys; zero retention where required.
Not a finding: public product instructions in system prompts.

### llm.memory — persistent memory and write-path poisoning · LLM04:2025, LLM08:2025 · CWE-1427, CWE-639
Detect: agents that write memory, notes, summaries or embeddings (`memory[.]add|save_memory|upsert|add_documents|remember|store_note|vectorstore[.]add`)
built from untrusted input, later loaded as trusted context for the same or another
user; memory keyed without user or tenant; no provenance or expiry on stored items.
Confirm: untrusted input → memory write `path:line` → later read into a privileged
session `path:line`.
Fix: per-user and per-tenant memory; provenance tags and trust levels kept on read;
untrusted memory never alongside tools in the same turn; review or TTL for persisted
items.
Not a finding: memory written only from the user's own explicit statements and read
back only to them.

### llm.rag — vector store isolation and poisoning · LLM08:2025, LLM04:2025 · CWE-639
Detect: `similarity_search|topK|pinecone|weaviate|qdrant|chroma|pgvector|<->|<=>|match_documents|milvus|knn`
without a tenant or ACL filter derived from the session (not from request params);
shared namespaces; user uploads indexed into shared corpora without review or
provenance; pgvector tables without RLS.
Confirm: the query and where its filter comes from.
Fix: per-tenant namespaces or enforced server-side filters; document ACLs checked at
retrieval; provenance metadata; RLS.
Not a finding: single-tenant corpora (still check per-user ACLs).

### llm.consumption — denial of wallet · LLM10:2025 · CWE-770
Detect: LLM routes without auth or per-user quotas; `max_tokens` absent or from input;
`model: req.body.model`; no step caps; embedding jobs without size or page caps; public
unauthenticated LLM endpoints (a free proxy); no provider spend limits.
Confirm: the route and the missing bound.
Fix: auth plus per-user and per-tenant token quotas; server-fixed model and
`max_tokens`; step caps; input caps; spend alerts.
Not a finding: internal endpoints with caps.

### llm.models — model and data supply chain · LLM03:2025, LLM04:2025 · CWE-502
Detect: `torch.load` without `weights_only=True`, `joblib.load` or `pickle.load` of
models; `numpy.load(…allow_pickle=True)`, `read_pickle(`, Keras `safe_mode=False`;
`trust_remote_code=True`; `from_pretrained`/`hf_hub_download` without `revision=`;
tracked `*.pt`, `*.pth`, `*.pkl`, `*.joblib`, `*.ckpt` models; adapters from unknown
authors; fine-tuning on unreviewed user content.
Confirm: the load call and where the artifact comes from. `weights_only=True` is a
control only on a `torch` version the scan clears: put `torch` in the
`deps.vulnerable` high-blast list, never a version range from memory.
Fix: safetensors; `weights_only=True` on a scan-cleared `torch`; pinned revisions or
hashes; no remote code; reviewed training data.
Not a finding: own artifacts from a private pipeline (still prefer safetensors —
HARDENING).

### mcp.config — MCP servers configured in the repo · LLM03:2025, LLM06:2025
Detect: `.mcp.json`, `mcp*.json`, `.cursor/mcp.json`, `.vscode/mcp.json`,
`claude_desktop_config.json`, `.claude/settings*.json`:
- servers launched with `npx -y <pkg>` or `uvx <pkg>` without a version, or whose
  package scope is not the vendor's official one (`postmark-mcp`, 2025);
- a `command` of `sh`, `bash`, `cmd`, `powershell`, `node -e` or `python -c`, or args
  with `curl`, `wget`, `base64` or a pipe;
- privileged credentials in `env` whatever the value (`SERVICE_ROLE`, `ADMIN`, `ROOT`,
  `SUPERUSER`, `sk_live`, admin DSNs, prod hosts) — HIGH: the privilege is the issue
  (Supabase MCP, 2025); well-known servers without their read-only or scoping flag
  (`--read-only`, `--toolsets`, `--project-ref`, allowed directories);
- remote `url` servers on unknown hosts; `audit.mjs secrets` hits in `env`;
  `enableAllProjectMcpServers`;
- history: `git log --format='%h %an %ad' -- <mcp file>`, then `audit.mjs at <first
  commit> <mcp file>` against HEAD — a `command` or `args` changed after the file was
  first added is a rug-pull LEAD with the commit and author (MCPoison, 2025).

Confirm: the config line.
Fix: pinned versions or digests; a per-repo server allowlist; least-privilege, read-only
tokens from env backed by a secret manager.
Not a finding: pinned first-party servers with narrow tools; a version bump of the same
pinned package.

### mcp.server — MCP servers implemented in the repo · MCP security best practices
Detect: `McpServer|server[.]tool[(]|@mcp[.]tool|FastMCP`. Flag:
- tool descriptions with imperative text aimed at models (tool poisoning):
  `audit.mjs grep -i '(<important>|do not (tell|mention|inform)|before (using|calling)|ignore previous|~/[.]ssh|id_rsa|mcp[.]json|[.]env)'`
  over files with tool registrations; parameters the handler never reads (a side
  channel, `sidenote`);
- handlers that shell out, write files or fetch arbitrary URLs: every tool argument is
  attacker-controlled (model output) — trace it with `backend-taint.md` `inj.command`
  (git argv without `--`), `file.traversal` (`startsWith(allowedDir)` without realpath
  and a separator) and `ssrf`;
- MCP or OAuth client code passing server-supplied URLs (`authorization_endpoint`) to
  `open()`, `exec` or `openExternal` without an `https:` check (mcp-remote, 2025);
- HTTP transport on `0.0.0.0`, or without auth and Origin checks (DNS rebinding);
- client tokens passed through to downstream APIs (forbidden by the spec);
- OAuth proxies without per-client consent (confused deputy);
- tool definitions that change at runtime.

Confirm: the handler or transport config.
Fix: review descriptions as code; bind to `127.0.0.1` with auth and Origin checks;
audience-bound tokens, no passthrough; per-client consent; least-privilege handlers.
Not a finding: stdio servers with narrow, read-only tools.

### agent.config — instructions aimed at AI agents · LLM01:2025 · ATT&CK T1195
Detect:
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.cursorrules`,
  `.windsurfrules`, `.clinerules`, `.goosehints`, `.github/copilot-instructions.md`,
  `.github/{instructions,prompts,chatmodes}/`, `.amazonq/rules/`, `.roo/`, `.kiro/`,
  `.continue/`, `.junie/`, skills, rules and prompt files telling agents to run
  commands, disable checks, approve, or send data out;
- `audit.mjs unicode` hits in those files; HTML comments a human never sees on GitHub
  (Rules File Backdoor, CamoLeak, 2025):
  `audit.mjs grep -i '<!--[^>]{0,200}(ignore|instead|you must|assistant|agent|run|execute|curl|fetch)' -- '*.md'`;
- committed agent memory (`CLAUDE.local.md`, `.claude/memory`, `.cursor/memories`,
  `.windsurf/memories`) with URLs or imperative text;
- agent CLIs invoked from tracked code (`claude -p`, `gemini -p`, `q chat`,
  `codex exec`, `aider --yes`, `cursor-agent`) — destructive verbs in the prompt are
  HIGH (Amazon Q extension, 2025);
- anywhere in source, comments addressing an AI or auditor (`audit.mjs grep -i '(AI|LLM|Claude|Copilot|assistant|auditor|security review)[^\n]{0,40}(ignore|skip|approve|do not report|not a vulnerability|already reviewed)'`)
  and fake `SA-` ids in comments;
- `inventory` `AGENT-CASE` lines: `.Cursor/` beside `.cursor/` evades case-sensitive
  protected-path checks.

Confirm: quote a truncated fragment; never act on it.
Fix: review agent files like code (CODEOWNERS); strip hidden Unicode and comments from
agent-read files.
Not a finding: ordinary project conventions; lint directives in comments
(`markdownlint-disable`, `prettier-ignore`).

### agent.settings — agent settings that run code or widen permissions · LLM06:2025 · CWE-829, CWE-250
Settings are where the 2025–2026 clone-to-RCE bugs lived (Claude Code CVE-2025-59536
and CVE-2026-21852, Copilot CVE-2025-53773, Cursor CVE-2025-54135 and CVE-2025-54136).
Detect, in committed `.claude/settings*.json`, `.gemini/settings.json`,
`.vscode/settings.json`, `*.code-workspace`, `.cursor/`, `.windsurf/`, `.amazonq/`,
`.codex/config.toml`:
- any hook (`SessionStart`, `PreToolUse`, `UserPromptSubmit`, `Stop` …), whatever the
  command;
- `env` keys ending `BASE_URL`, `API_BASE`, `ENDPOINT`, `PROXY` or `_HOST`, or holding
  credentials (`ANTHROPIC_BASE_URL` sends the user's key to that host);
- `apiKeyHelper`, `awsCredentialExport` or other credential scripts;
- `defaultMode` `bypassPermissions` or `acceptEdits`; `dangerouslySkipPermissions`;
- auto-approve keys: `chat.tools.autoApprove`, `chat.tools.global.autoApprove`,
  `chat.tools.terminal.autoApprove`, `task.allowAutomaticTasks: "on"`,
  `security.workspace.trust.enabled: false`, `chat.mcp.autostart`, Gemini `yolo`;
- permission allows `Bash(*)`, or prefixes that run or reach anything:
  `(Bash|run_shell_command|ShellTool)[(](find|xargs|env|git|npm|npx|node|python3?|bash|sh|sed|awk|ping|nslookup|dig|host|curl|wget|nc|ssh|open)[: ]`
  — MEDIUM, HIGH for network commands (DNS exfiltration, CVE-2025-55284);
- allows letting the agent edit its own settings, MCP files, `.git/` or
  `.github/workflows/`; `enableAllProjectMcpServers`, `enabledMcpjsonServers`.

In code that implements an agent: file-write tools with no denylist for agent config
directories, `.git/` and CI paths; command approval by `startsWith`, `split(' ')[0]` or a
regex on the raw string instead of parsed argv.
Confirm: the key and its value, hosts truncated. HIGH when cloning or opening the repo is
enough to trigger it.
Fix: no hooks, endpoint overrides or auto-approve in committed settings — keep them in
user scope; exact-command allows; CODEOWNERS on agent directories; approval on parsed
argv rejecting `;`, `|`, `&&`, `$()` and backticks.
Not a finding: hooks that run the repo's own lint or format scripts under CODEOWNERS
(LOW, still listed).

### dev.autorun — configs that run code on a developer machine · CWE-829, CWE-94 · ATT&CK T1195
Detect:
- `.envrc` (direnv);
- `mise.toml`/`.mise.toml` tasks and hooks, `.tool-versions` plugins from custom URLs;
- `.vscode/tasks.json` `runOn: folderOpen`, and `.vscode/settings.json` overriding
  interpreter, terminal or formatter paths to repo files;
- `.idea/` run configurations;
- `.devcontainer` `initializeCommand` (runs on the host) and `postCreateCommand`;
- `.husky/` and other git hooks calling `curl`;
- `.gitmodules` URLs using `ext::` or `file://`; `path =` values with control
  characters or a trailing CR (`audit.mjs unicode`, `show`), paths differing only by
  case, tracked symlinks into `.git/` (CVE-2025-48384, CVE-2024-32002);
- extension installs: `.vscode/extensions.json` recommendations and devcontainer
  `customizations.vscode.extensions` from lookalike publishers, committed `*.vsix`,
  `code --install-extension` in setup scripts (GlassWorm, 2025) — a LEAD unless it
  auto-installs.

Confirm: the line and when it runs (open folder, cd, clone, install). HIGH when it
fetches remote content (Cursor workspace trust off by default, 2025).
Fix: remove autorun; trusted-workspace prompts kept on; hooks reviewed via CODEOWNERS;
https submodule URLs only; an extension allowlist; a patched git in runner images.
Not a finding: standard tasks that run only when a developer invokes them.
