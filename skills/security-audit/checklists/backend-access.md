# Checklist — backend: authentication, access control, logic

Agent `ai-workflow:security-backend`. Per class: **Detect** · **Confirm** · **Fix** ·
**Not a finding**. Detect patterns are JS regexes for
`audit.mjs grep '<pattern>' -- <scope>`. They are leads; read every hit. Rule ids are
stable: they feed IDs and COVERAGE lines, and the ids after them are what `Rule:` copies.
Cookie flags, CSRF and CORS are in `client.md`; SSRF, injection and files are in
`backend-taint.md`.

## Authentication

### authn.session — fixation, rotation, logout · CWE-384, CWE-613 · A07:2025 · ASVS V7
Detect: login, MFA-complete and role-change handlers without `req.session.regenerate`,
Rails `reset_session`, or the framework `login()`; Spring `sessionFixation().none()`;
custom `session['user_id'] = …`. Logout or password change that clears the cookie but
leaves the server session or refresh token valid. No idle or absolute timeout.
Confirm: the same session id before and after authentication on the path; a logout
path with no server-side invalidation.
Fix: regenerate on every privilege change; destroy server-side on logout and password
change; revoke refresh tokens; idle and absolute timeouts.
Not a finding: Django `login()`, Spring default `migrateSession`, Laravel scaffold;
stateless JWT (revocation is under `authn.jwt`).

### authn.jwt — verification and claims · CWE-347, CWE-345, CWE-613 · API2:2023 · ASVS V9 · RFC 8725
Detect: `jwt[.](decode|verify)|jsonwebtoken|jose|PyJWT|verify_signature|algorithms|ignoreExpiration|getUnverified|parseUnsecured|Jwts[.]parser`.
Flag: decode without verify used for identity; `verify_signature: False`; no
`algorithms` allowlist, or one mixing HS* with RS*/ES* (public key used as HMAC
secret); `none` accepted; `ignoreExpiration`; no `aud`/`iss` check; `kid` used in a file
path, SQL or URL; `jku`/`x5u` fetched from the token; secret from a fallback
(`process.env.JWT_SECRET || '…'`) or under 32 bytes; access tokens over 1 h with no
revocation; refresh tokens without rotation and reuse detection; a multi-tenant
authority (`/common`, `/organizations`) with `ValidateIssuer = false`,
`validateIssuer: false` or no `tid`/`iss` allowlist, or one key set trusted across
issuers or token types (Storm-0558, 2023).
Confirm: Authorization header → the function producing claims → claims used for
identity; quote the verify options.
Fix: `verify(token, key, { algorithms: ['RS256'], issuer, audience, clockTolerance: 60 })`;
keys from a pinned JWKS; fail at boot when the secret is missing or short; short access
tokens, rotating refresh tokens with reuse detection, `jti` revocation on logout and
password change.
Not a finding: `decode` for routing before a `verify` on the same request (read the
chain); `jwks-rsa`/`PyJWKClient` with a fixed URI; PyJWT 2+ (requires `algorithms`).

### authn.oauth — OAuth and OIDC · CWE-601, CWE-352, CWE-345 · RFC 9700 · ASVS V10
Detect: `redirect_uri|callbackURL|state=|nonce|code_verifier|code_challenge|response_type=(token|id_token)|passport|next-auth|authlib|omniauth|openid|allowDangerousEmailAccountLinking|link_?by_?email|from_omniauth`.
Flag: state not generated, not session-bound, or not compared; no PKCE S256 for public,
SPA or mobile clients; implicit flow; redirect_uri or post-login target matched by
`startsWith`, `includes`, `endsWith` or an unanchored regex; id_token not checked for
signature, `iss`, `aud == client_id`, `nonce`, `exp`; accounts linked or matched by
email without `email_verified` from a trusted IdP; tokens in URLs or logs; library
checks disabled (`checks: []`, `state: false`). Pre-account hijack (USENIX Security
2022): Auth.js `allowDangerousEmailAccountLinking: true`, or an SSO callback that links
into an account whose local email is unverified without clearing its password,
sessions, API keys and pending email changes; unverified local accounts able to log in.
Authorization servers in the repo (`oidc-provider`, `node-oauth2-server`,
`django-oauth-toolkit`, Doorkeeper, Spring Authorization Server, custom `/token`): PKCE
not required for public clients, the verifier checked only when a challenge exists,
`plain` accepted; codes not single-use or not bound to `client_id` and `redirect_uri`;
dynamic registration fetching `logo_uri`, `jwks_uri`, `request_uri` or
`sector_identifier_uri` server-side (`ssrf`).
Confirm: the callback path with the missing check; for matching, a bypass string the
check accepts (`https://app.example.com.evil.tld`, `//evil.tld`).
Fix: authorization code + PKCE S256 for every client; exact-string redirect allowlist;
single-use session-bound state; full id_token validation incl. nonce; link accounts
only on verified email or explicit re-auth, resetting credentials and sessions of an
unverified account; S256 required server-side, bound single-use codes.
Not a finding: Auth.js, Authlib, Spring Security OAuth2 client, Clerk, Auth0 SDKs with
defaults intact (read the config).

### authn.saml — SAML response validation · CWE-347, CWE-345, CWE-436
Detect: SAML libraries in lockfiles (`ruby-saml|omniauth-saml|xml-crypto|@node-saml|passport-saml|samlify|python3-saml|pysaml2|xmlsec|Sustainsys|ITfoxtec|OpenSAML`
— their versions go to `deps.vulnerable`'s high-blast list); hand-rolled verification:
`SignedXml|checkSignature|CheckSignature|xpath[.]select|getElementsByTagName[(]["'](saml:)?(Assertion|NameID)|//(saml:)?Assertion|local-name[(][)]`;
options `wantAssertionsSigned: *false|wantAuthnResponseSigned: *false|validateInResponseTo: *false|skip_.*signature`.
Flag: signature checked on one node or with one parser while identity is read from
another (`//Assertion` first match, a second XML parser) — wrapping and parser
differentials (ruby-saml CVE-2024-45409, CVE-2025-25291); unsigned assertions accepted;
more than one Assertion accepted; `InResponseTo`, `Audience`, `Destination`,
`Recipient` or `NotOnOrAfter` unchecked; no assertion-id replay cache; NameID read by
text concatenation.
Confirm: the verify call and the extraction call reference different nodes or parsers,
or an option disables a check.
Fix: a maintained library in strict mode with signed assertions required; one parser;
identity only from the library's validated object; reject documents with more than one
Assertion; an assertion-id replay cache.
Not a finding: SAML terminated at a managed broker (Auth0, WorkOS, Okta) with the app
receiving OIDC.

### authn.reset — password reset and account recovery · CWE-640, CWE-620, CWE-204 · A07:2025 · ASVS V6
Detect: reset, forgot, verify, invite and change-email handlers, and the mailer
recipient: `(to|recipients?|email) *[:=] *(params|req[.](body|query)|request[.](POST|data|json|form))`.
Flag: the recipient taken from the request instead of the stored record, or a lookup
value that can be an array or object (`extended: true`, Rails and PHP bracket params,
no scalar schema) — `user[email][]=victim&user[email][]=attacker` mails the token to
both (GitLab CVE-2023-7028); link built from
`req.headers.host`, `req.get('host')`, `request.get_host()` without `ALLOWED_HOSTS`,
or `X-Forwarded-Host`; token from `Math.random`, uuid v1, time, ids or
`md5(email+time)`; token stored plaintext; no expiry or over 1 h; reusable; not bound
to the user; not invalidated by a password change; other sessions survive the reset;
email, password or MFA change without re-auth; old email not notified; different
response or timing for unknown emails.
Confirm: URL construction with a request-controlled host; the generator; a lookup
without expiry or user binding.
Fix: look the user up, then mail `user.email` from the DB; coerce identifiers to
strings and reject arrays; base URL from config; 32-byte CSPRNG token stored as SHA-256;
15–60 min; single use; revoke all sessions; re-auth for credential changes; identical
responses.
Not a finding: Django `PasswordResetTokenGenerator` with `ALLOWED_HOSTS`; Devise with
`default_url_options`.

### authn.identity — identifier normalisation and collisions · CWE-178, CWE-289, CWE-1289
Detect: signup, login, reset, invite and SSO-linking lookups by email or username:
`findOne[(][{] *(email|username)|where[(] *[{]? *(email|username)|filter_by[(](email|username)|find_by[(](email|username)|lower[(]|toLowerCase[(]|normalize[(]|casefold|idna|punycode`.
Flag lookups that are case-insensitive while the unique index is case-sensitive (or the
reverse); Unicode not normalised (NFKC) before comparison, so `İ`, `ß`, fullwidth
characters or a dotless `ı` collide after lowercasing; IDN domains not converted to
punycode; Gmail dots or `+tags` treated as different accounts on trial, quota or
one-per-person flows; SSO accounts matched across providers by email alone; identity
keyed on a mutable or unverified claim — `email`, `preferred_username`, `upn` — from a
multi-tenant authority (`login.microsoftonline.com/(common|organizations)`) or an IdP
without `email_verified` (nOAuth, 2023).
Confirm: the normalisation used on write versus on lookup and on reset delivery, and
the DB constraint.
Fix: one canonical form (NFKC, then casefold) stored in a unique column, used for every
lookup and constraint; reset mail sent to the stored address, never the typed one;
link identities by provider subject id, not email.
Not a finding: a citext or case-insensitive collation unique index plus NFKC on input;
lookup by `iss`+`sub` (Entra `tid`+`oid`).

### authn.email-trust — access granted from an email string · CWE-290, CWE-436
Detect: `endsWith[(]["']@|split[(]["']@["'][)]|[.]domain *===?|email_domain|allowed_?domains|auto_?join|domain_?verified`
in signup, org-join, invite and SSO routing.
Flag: org membership, roles or SSO routing decided by the email domain; addresses
accepted with encoded-words (`=?`), quotes, `%`, `!`, comments or non-ASCII before
verification; a domain decision made before ownership is verified. Validator and mailer
parse addresses differently, so the mail goes to the attacker while the app sees the
trusted domain (Splitting the email atom, 2024).
Confirm: the domain check and the grant it gates.
Fix: a strict ASCII address subset; verify ownership by a delivered link before any
domain-based grant; prefer IdP-asserted org membership (tenant id) over the email domain.
Not a finding: a domain used only for display or routing hints.

### authn.apikeys — API keys and personal access tokens · CWE-522, CWE-798, CWE-613 · API2:2023
Detect: key and PAT models and handlers: `api_?key|apiKey|personal_access_token|pat_|access_token` near `create|generate|insert|findBy`.
Flag: keys stored plaintext or reversibly encrypted; looked up with `==` on the raw key;
no scope, no expiry, no rotation or revocation; the full key shown again after creation;
keys accepted in query strings; no last-used tracking; no prefix that secret scanners
recognise.
Confirm: the storage column and the lookup path.
Fix: show once; store SHA-256 of a 32-byte random key with a recognisable prefix; scope
and expiry per key; revoke and rotate; header-only transport; last-used and audit
events.
Not a finding: keys held only by a managed identity provider.

### authn.stored-tokens — third-party tokens the app stores for customers · CWE-312, CWE-522
Detect: `refresh_token|access_token|oauth_token|api_key|client_secret` columns or
fields in schemas, ORM models and migrations; OAuth scopes requesting `offline_access`,
`refresh_token`, `full`, `api` or admin scopes; integration credentials in env or
config.
Flag: tokens stored without application-level or envelope encryption; broader scopes
than the feature uses; no revocation path (Salesloft Drift, 2025).
Confirm: the column and the repository layer writing it with no encrypt-on-write.
Fix: KMS envelope encryption with per-tenant keys; least scopes; IP-restricted connected
apps; a token revocation runbook.
Not a finding: tokens encrypted on write by a KMS wrapper (cite it); tokens held only in
a managed vault by reference.

### authn.backdoor — hardcoded or environment-gated bypasses · CWE-798, CWE-489, CWE-1188
Detect: `NODE_ENV *!==? *['"]production|DEBUG.*auth|skip_?auth|bypass|master_?password|superuser|impersonat|X-(Debug|Test|Internal)-User|X-Bypass|isTest|ALLOW_ALL`,
seeded admin users or default passwords in migrations and seed files that production
runs.
Flag: auth skipped when an env var or header is set; a universal password; test users
created in production migrations; impersonation without an admin check and audit event.
Confirm: the branch condition and how production sets it (env layering), and whether
the seed runs in production.
Fix: remove the bypass; test identities only in test fixtures; impersonation behind an
admin role with an audit event and a visible banner.
Not a finding: a bypass compiled out of production builds (show the build flag).

### authn.mfa — MFA bypass and step-up · CWE-308, CWE-287, CWE-307
Detect: `mfa|2fa|totp|otp|webauthn|second_factor|mfa_pending`. Flag: a full session or
JWT issued before MFA with `mfaPending` checked on some routes only; API, mobile or
refresh paths that skip MFA; OTP compare not constant-time, no attempt cap, window over
one step, codes reusable; backup codes plaintext or reusable; MFA disable or factor
change without re-auth; an unsigned "remember device" cookie.
Confirm: one authenticated route reachable with a pre-MFA session; a verify handler
with no attempt counter.
Fix: a restricted pre-MFA token that reaches only the verify route; the MFA claim
enforced in the central middleware; per-code attempt cap; used-step tracking; hashed
single-use backup codes; re-auth for security settings.
Not a finding: MFA enforced by the IdP where the app never holds a pre-MFA session.

### authn.passwords — password storage · CWE-916, CWE-759, CWE-328 · ASVS V6
Detect: hashing near password fields: `createHash[(]|hashlib[.]|bcrypt|argon2|scrypt|pbkdf2|password_hash|MessageDigest`;
bcrypt over concatenated input anywhere:
`bcrypt[.](hash|hashSync|compare|hashpw)[(][^)]*([+]|[$][{])|BCrypt[.](Password[.]create|hashpw)[(][^)]*[+]`.
Flag fast or unsalted hashes, bcrypt cost under 10, bcrypt over concatenated input where
earlier parts can push the secret past 72 bytes — cache keys and tokens too (Okta,
2024), PBKDF2-SHA256 under 600k iterations, reversible encryption, homegrown peppers.
Confirm: the hash applied on register and change-password.
Fix: argon2id (m ≥ 19 MiB, t ≥ 2, p = 1) or bcrypt ≥ 12; rehash on login when
parameters are old; HMAC-SHA256 for derived keys; never concatenate identifiers into
bcrypt input.
Not a finding: SHA-256 of high-entropy API keys or tokens.

### authn.bruteforce — throttling and enumeration · CWE-307, CWE-204, CWE-799 · API4:2023 · ASVS V6
Detect: list login, signup, reset, OTP verify, invite accept, coupon and gift-card
redeem. Find limiters (`express-rate-limit`, `rack-attack`, `django-ratelimit`,
`slowapi`, `bucket4j`, nginx `limit_req`, WAF rate rules in IaC). Flag routes with
none; limits keyed on IP only behind a proxy without trust config, or on a spoofable
header; different status, message or timing for unknown users (early return before the
hash compare); signup that says the email is taken.
Confirm: the route registration with no limiter at app or edge; the diverging branches.
Fix: per-account and per-IP limits with backoff; generic messages; a dummy hash compare;
CAPTCHA or risk check after N failures; breached-password check.
Not a finding: limits at a gateway or WAF deployed from the repo that cover the path.

## Access control

### authz.missing — unauthenticated or under-protected entry point · CWE-306, CWE-862, CWE-285 · API5:2023 · A01:2025 · ASVS V8
Detect: compare the entry-point table with the guards. Flag:
- routers mounted before the auth middleware, and routes outside the guarded group;
- allowlists (`publicPaths`, `@Public()`, `permitAll`, `AllowAny`,
  `skip_before_action :authenticate`) covering more than intended;
- a Next.js `middleware.ts` matcher excluding `/api` or action POSTs;
- writes without an in-function session check: every `'use server'` export, Remix
  `action`/`loader`, SvelteKit form action, tRPC `publicProcedure`, Nuxt `server/api`
  handler;
- admin, internal, debug, export, impersonate and role-change routes without a role
  check;
- GET guarded but PUT/DELETE not;
- Next.js relying on `middleware.ts` alone (the CVE-2025-29927 class): auth must also
  live in the handler; the locked `next` version goes to `deps.vulnerable`.

Confirm: route registration + middleware order + handler, each `path:line`, with no
session or role check on the path.
Fix: deny by default — global auth with an explicit public allowlist; a role or
permission guard on privileged handlers; `requireUser()` inside every server action; a
test that walks the router and asserts every non-public route rejects anonymous calls.
Not a finding: a gateway authorizer, Istio `AuthorizationPolicy` or ingress auth
deployed from the repo and covering the path; health checks returning nothing
sensitive.

### authz.bola — IDOR, object-level authorization · CWE-639, CWE-284 · API1:2023 · ASVS V8
Detect: every handler taking an id (`/:id`, `<int:`, `{id}`, `params.id`,
`@PathVariable`, GraphQL `node(id:)`, bulk `ids[]`, download keys, signed-URL
generators, export job ids, websocket room ids). Trace to the data call (`findById`,
`findUnique({ where: { id`, `get_object_or_404(Model, pk=`, `Model.find(params[:id])`,
`WHERE id =`). Flag a query with no owner or tenant predicate and no policy call
(`can(`, `authorize`, Pundit, CanCan, `@PreAuthorize`, `has_object_permission`, OPA);
nested routes where the child isn't bound to the parent; authorization after the fetch
with the object still returned. RPC-style entry points: `'use server'` exports and tRPC
or other procedures whose arguments carry ids, including `.bind(null, id)` bound
arguments (client-visible, not integrity-protected); exported actions no client
imports are still callable.
Confirm: route → handler → query without the predicate; ids guessable or leaked
elsewhere.
Fix: scope by principal in the data layer (`where: { id, orgId: ctx.orgId }`) or DB
RLS; one policy layer; 404 for others' objects.
Not a finding: public-by-design resources; repository base classes, ORM middleware
(`$use`, default scopes) or `CREATE POLICY` RLS that already scope — read them first.

### authz.mass-assignment — writable privileged fields · CWE-915 · API3:2023 · ASVS V15
Detect: `Object[.]assign[(]|[.][.][.]req[.]body|(create|update)[(]req[.]body|data: *req[.]body|[*][*]request[.](json|data)|permit!|fields *= *.__all__|BeanUtils[.]copyProperties|findByIdAndUpdate[(][^,]+, *req[.]body`;
Spring entities bound with `@RequestBody`; schemas with `passthrough()`, `extra='allow'`,
no `.strict()`; nested writes `connect: *[{]|connectOrCreate|accepts_nested_attributes_for|plainToClass[(]|plainToInstance[(]|strict: *false`
(Mongoose, class-transformer without `excludeExtraneousValues`). Flag where the model
has `role`, `isAdmin`, `tenantId`, `orgId`, `ownerId`, `balance`, `price`, `plan`,
`status`, `emailVerified`, or a nested write can attach to another owner's object.
Confirm: the sensitive field exists on the model and reaches the write unfiltered.
Fix: per-operation input DTO (`z.object({…}).strict()`, pydantic `extra='forbid'`,
`permit(:name)`); server-owned fields set from context only.
Not a finding: upstream validation that strips unknown keys (`whitelist: true,
forbidNonWhitelisted: true`, zod parse without passthrough); fields overwritten after
the spread.

### authz.privilege — role from client, headers or self-issued claims · CWE-269, CWE-602, CWE-807
Detect: `isAdmin|role *===?|hasRole|req[.]user[.]role|claims|X-Role|X-User-Id|X-Forwarded-User|X-Auth`.
Flag roles read from body, query, client-settable headers or self-issued claims;
identity headers not stripped at the edge; plan or feature gates enforced only in the
UI. Step-up parity: list every write that requires step-up (MFA, re-auth, approval) and
flag writes of equal impact that skip it — role grants, key creation, payout changes,
exports.
Confirm: role source → decision point; for parity, the guarded write and the unguarded
one side by side.
Fix: roles from the DB or the IdP's verified token; strip identity headers at ingress;
server-side entitlement checks.
Not a finding: headers set by a trusted sidecar (oauth2-proxy) when the app is
reachable only through it — show the network policy or service exposure.

### authz.tenant — tenant isolation · CWE-668, CWE-639, CWE-200
Detect: name the tenant key once, then check every data path for it:
- raw SQL and aggregates;
- search indexes (Elasticsearch/OpenSearch filters);
- caches shared across tenants (`cache.get('settings')`);
- object-storage keys;
- queue jobs that load by id only;
- exports and analytics.

Also flag a tenant id taken from header, body or query instead of the auth context, and
Postgres RLS with `SET app.tenant` on pooled connections (pgbouncer transaction mode)
without `SET LOCAL`.
Confirm: where the tenant id comes from (it must be the verified session) and one path
where it is absent.
Fix: tenant from the auth context only; enforce in one data layer or RLS with `SET
LOCAL` per transaction; tenant-prefixed cache and storage keys; a two-tenant test.
Not a finding: global reference tables (countries, plans).

### authz.baas — Firebase, Supabase and client-direct data rules · CWE-284, CWE-732
Detect: `firestore.rules`, `storage.rules`, `database.rules.json` with `if true` or
`request.auth != null` without an owner check; Supabase migrations with tables lacking
`ENABLE ROW LEVEL SECURITY`, policies `USING (true)`, `SECURITY DEFINER` functions
callable by `anon`, views without `security_invoker`, public storage buckets.
Confirm: the rule line and the client SDK reaching that collection or table directly.
Fix: owner-scoped rules (`resource.data.ownerId == request.auth.uid`); RLS on every
exposed table with `auth.uid()` predicates.
Not a finding: collections public by design.

## Business logic

### logic.race — check-then-act on limited resources · CWE-362, CWE-367
Detect: read-check-write on balance, credits, stock, coupon `used`, invite seats, OTP
and reset-token use, votes, withdrawals, trials, quotas — a separate SELECT and UPDATE
without `FOR UPDATE`, `select_for_update()`, `@Lock(PESSIMISTIC_WRITE)`, an atomic
conditional update, a unique constraint or a version column. Sub-states a single-packet
burst reaches (Smashing the state machine, 2023):
- an object visible before its secret is set (insert, then a later update with the
  token), and token lookups accepting null, `''` or an array;
- the session marked authenticated before the MFA step is enforced;
- an email change whose token isn't bound to the exact new address in the same row;
- rate limiters that read then write instead of an atomic `INCR`.

Method: list each multi-step transition per stateful entity (order, coupon, invite,
session, email change) with its statement count; every multi-statement transition
without a transaction, lock or conditional update is a lead.
Confirm: the two statements and the interleaving two parallel requests produce.
Fix: one conditional `UPDATE … SET used = true WHERE id = ? AND used = false` checking
affected rows; unique constraints (`coupon_id, user_id`); a transaction with a row lock;
serializable for money.
Not a finding: one consumer per key; a DB constraint already enforcing it.

### logic.idempotency — double-spend and replayed side effects · CWE-841, CWE-362
Detect: money-moving and side-effecting POSTs (charge, refund, transfer, payout, order
create, send email or SMS); at-least-once consumers (SQS, Kafka, PSP webhook retries).
Flag no `Idempotency-Key`; keys not scoped per user or stored without a request hash;
consumers without event-id dedupe; refunds not capped by the captured amount.
Confirm: the side effect runs with no dedupe record committed atomically.
Fix: idempotency key with a unique (user, key) and request hash, returning the saved
response; an event-id dedupe table; keys passed to PSP calls.
Not a finding: a PSP idempotency key passed and a conditional local transition.

### logic.tampering — price, quantity, state machine, entitlements · CWE-840, CWE-602, CWE-20 · API6:2023
Detect: checkout, order, transfer, refund and plan handlers reading
`price|amount|total|discount|currency|tax|shipping|quantity|status` from the request.
Flag:
- floats for money (`parseFloat(…price`, `float(amount`);
- negative, zero or huge quantities accepted;
- coupons that are stackable, reusable or expired;
- transitions without `WHERE status = '<expected>'`, and skippable steps (confirm
  without payment);
- entitlements checked only client-side;
- trial re-signup;
- orders marked paid from the return URL or a client call (`/success`,
  `/checkout/complete`, `?paid=true`), or a webhook or confirm path that doesn't compare
  amount, currency and order id with the stored order.

Confirm: the trusted field in the computation, or the unconditional transition.
Fix: recompute from the catalog server-side; integer minor units or decimals; bounds;
an explicit state machine with conditional transitions; server-side entitlements;
fulfil only from a verified webhook or server-side re-fetch matching the amount,
currency and order id stored at session creation.
Not a finding: a client price used only to detect a display mismatch and then rejected.

### logic.abuse — features as weapons · CWE-799, CWE-770 · API6:2023
Detect: `sendMail|ses[.]send|sgMail|postmark|twilio[.]messages|sns[.]publish`, invite,
share, export. Flag user-controlled sender name, subject or body in emails (phishing
relay); sending before email verification; no per-account or per-tenant caps; SMS to any
country (toll fraud); exports without row caps, async authorization or short-TTL signed
URLs.
Confirm: user-controlled fields reach the template; no quota on the path.
Fix: fixed templates with escaped, length-capped user text; send only after
verification; daily caps; an SMS country allowlist; capped async exports with short-TTL
links.
Not a finding: admin-only senders.

### logic.fail-open — exceptions that grant access · CWE-636, CWE-755, CWE-390 · A10:2025
Detect: catch blocks in auth, authz, signature, licence or feature-flag paths that
return true, call `next()` or pass: `catch *[(][^)]*[)] *[{][^}]*return true`,
`except Exception: *pass`, `rescue => nil` around a verify; policy-service timeouts
treated as allow; `_ = verify(…)` in Go; a missing config value defaulting to allow.
Also partial state: a multi-step money or permission write with an external call or a
throwing step between statements and no transaction or compensation, so an error leaves
it half done.
Confirm: the branch where an error leads to access, or the step that leaves partial
state.
Fix: fail closed — deny on error, log server-side; transactions with rollback.
Not a finding: error handling outside security decisions.

### log.security-events — security events missing or erasable · CWE-778, CWE-223 · A09:2025
Detect: login, reset, MFA, role-change, API-key, export and money handlers (from the
`authn.*` and `authz.*` sweeps) with no structured log or audit call on failure, deny
and success; audit tables the app role can update or delete (`AuditLog` with
`.update|.delete|.destroy`, grants of UPDATE or DELETE).
Confirm: the handler and the absence of a log call, after reading the middleware:
global auth-failure logging satisfies it.
Fix: structured security events (who, what, outcome, request id, never secrets); an
append-only audit store under a separate role.
Not a finding: framework or middleware logging the event globally (cite it). LOW unless
the audit store is erasable by the app role (MEDIUM).

## Integrations and APIs

### webhook.inbound — signature, replay, trust · CWE-345, CWE-294, CWE-208 · API10:2023
Detect: `webhook|stripe-signature|x-hub-signature|x-slack-signature|svix|constructEvent|verifyWebhook|x-shopify-hmac|twilio`.
Flag no signature check; HMAC over re-serialised JSON instead of raw bytes
(`express.json` mounted before the route); `==` compare; no timestamp tolerance; no
event-id dedupe; money-relevant events acted on from the payload instead of re-fetched
from the provider; an IP allowlist as the only control.
Confirm: the handler acts on the body with no verify, or verifies the parsed body.
Fix: provider SDK verification on the raw body with a 5-minute tolerance;
constant-time compare; event-id dedupe; re-fetch authoritative state. Outbound webhooks:
per-tenant signing secrets, SSRF-safe egress (`ssrf`), never echo target responses.
Not a finding: verification middleware mounted on the router prefix (check mount
order).

### api.graphql — GraphQL exposure and resolver authz · CWE-285, CWE-400, CWE-770 · API1:2023, API4:2023
Detect: `ApolloServer|graphqlHTTP|createYoga|graphene|strawberry|gqlgen|introspection|depthLimit|complexity|graphql-armor|allowBatchedHttpRequests|persistedQueries|playground|graphiql`.
Flag introspection or playground in production; no depth, cost or alias limits;
batching or aliases that brute-force login or OTP; authz only at the root `Query` while
nested field resolvers (`User.orders`) load other users' objects; errors with
`extensions.exception` or stacks; mutations over GET.
Confirm: a nested path whose resolver lacks the root's check; the server options.
Fix: introspection and playground off in production; depth (~10), cost and alias
limits counted toward rate limits; authorize per object in resolvers or data loaders;
masked errors; persisted queries for first-party clients.
Not a finding: public APIs meant to be introspectable; `@auth` directives verified to
be wired in the schema transform.

### api.grpc — gRPC exposure · CWE-306, CWE-319, CWE-200 · API8:2023
Detect: `reflection[.]Register|grpc_reflection|enable_server_reflection|AddGrpcReflection|insecure[.]NewCredentials|grpc[.]WithInsecure|add_insecure_port|ServerCredentials[.]createInsecure|grpc[.]Creds|UnaryInterceptor|StreamInterceptor`.
Flag server reflection on a production listener; insecure credentials on a non-loopback
address; no auth interceptor on services with private data (unary and streaming both);
admin, debug or channelz services on the public listener.
Confirm: the listen address and the interceptor chain per server.
Fix: reflection off in production; TLS or mTLS; one auth interceptor for unary and
stream; admin services on an internal port.
Not a finding: in-mesh services with STRICT mTLS and an authorization policy deployed
from the repo.

### api.inventory — shadow, legacy and debug endpoints · CWE-489, CWE-215 · API9:2023
Detect: `/v1` beside `/v2` where the old version lacks new checks; `/internal`,
`/beta`, `/test`, `/debug`, `/_debug`; Swagger, Redoc, springdoc or `/graphiql` enabled
in production; Spring Actuator `management.endpoints.web.exposure.include=*`
(`env`, `heapdump`); `net/http/pprof` on the public mux; Django debug toolbar, Laravel
Telescope, the Werkzeug debugger, Rails `consider_all_requests_local` in production.
Confirm: registered in the production build or profile.
Fix: remove or guard; actuator `health,info` only, on a separate port; docs UI off in
production or behind auth.
Not a finding: profile-specific config disabling them in production (read the prod
settings).

### api.limits — costly and unbounded endpoints · CWE-770, CWE-400 · API4:2023
Detect: `limit|pageSize|per_page|take|first` from the query without a server max;
unbounded body or multipart size; endpoints that call paid APIs, render PDFs, send SMS
or email, or run LLMs with no per-user quota; outbound and DB calls without timeouts
(`fetch` without `AbortSignal.timeout`, `requests` without `timeout=`, no
`statement_timeout`).
Confirm: the unbounded parameter, or the costly call with no quota on the path.
Fix: clamp server-side; body and upload limits; per-user and per-tenant quotas and
provider spend caps; timeouts on every network and DB call.
Not a finding: cheap endpoints (exclusions §1).

### async.consumers — queues, cron, internal callers · CWE-345, CWE-863
Detect: each consumer and cron job in the inventory: tenant or user id taken from the
message and not re-verified; message bodies deserialised unsafely (`deser.unsafe`); job
args reaching shells or queries; internal routes on the same listener as public ones;
topics writable by other principals (`iac.messaging`).
Confirm: message field → privileged sink with no re-authorisation.
Fix: schema-validate messages; re-authorise against current DB state; sign
cross-boundary messages; a separate internal listener.
Not a finding: producer and consumer inside one locked-down identity (schema validation
still HARDENING).

### api.consumption — trusting third-party responses · CWE-20, CWE-829 · API10:2023
Detect: partner API responses whose redirects or URLs are followed, rendered as HTML, or
written to the DB without validation; TLS verification off on those clients
(`crypto.tls`).
Confirm: response field → sink.
Fix: validate responses against a schema; don't follow redirects blindly; sanitise
rendered content.
Not a finding: responses shown only as text.
