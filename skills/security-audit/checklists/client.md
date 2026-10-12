# Checklist — client: browser, extensions, dev servers, mobile, desktop

Agent `ai-workflow:security-client`. Per class: **Detect** · **Confirm** · **Fix** ·
**Not a finding**. Detect patterns go through `audit.mjs grep`.

Every finding names its attacker: cross-origin web attacker, authenticated user, content
author (comments, uploads, LLM output), co-installed app or extension, local network
peer, or MITM. A client-only guard is not a control; file the missing server check as
`authz.missing` at the server path.

## XSS

### xss.sinks — raw HTML sinks · CWE-79 · A05:2025 · ASVS V3
Detect: `dangerouslySetInnerHTML|v-html|[[]innerHTML[]]|bypassSecurityTrust|[{]@html|[.]innerHTML *=|[.]outerHTML *=|insertAdjacentHTML|document[.]write[(]|createContextualFragment|srcdoc=|([$]|jQuery)[(][^)]*[)][.](html|append|prepend|after|before|replaceWith)[(]`;
server templates with escaping off: `[{][{][{]|[|] *safe|mark_safe|Markup[(]|html_safe|raw[(]|<%-|<%==|th:utext|Html[.]Raw`.
Trace each argument to a source (URL, postMessage, API or CMS fields, uploads, storage,
LLM output).
Confirm: source → sink with no sanitizer on the final string at the sink, or DOMPurify
or sanitize-html configured permissively (`ADD_TAGS` with script or iframe, `on*` in
`ALLOWED_ATTR`, `ALLOW_UNKNOWN_PROTOCOLS`, `allowedTags: false`).
Fix: render as text; if HTML is required,
`DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })` immediately before the
sink, behind a Trusted Types policy; remove `bypassSecurityTrust*` unless the input is a
build-time constant.
Not a finding: constants and repo-owned i18n; React, Vue and Svelte text
interpolation; Angular `[innerHTML]` (sanitized) without a bypass.

### xss.url — dangerous URL schemes · CWE-79, CWE-83
Detect: `href=[{]|:href=|[[]href[]]=|src=[{]|action=[{]|formAction|window[.]open[(]|location([.]href)? *=|location[.](assign|replace)[(]`
with external values. React 19 blocks `javascript:` in `href` only; Vue and Svelte block
none.
Confirm: a user-controlled value reaches the attribute with no protocol allowlist.
Fix: one shared `safeUrl()`: `new URL(raw, location.origin)`, protocol in `https:`,
`http:`, `mailto:`, else reject. No string-prefix checks.
Not a finding: app-generated paths; constant bases.

### xss.markdown — markdown and rich-text renderers · CWE-79, CWE-116
Detect: `marked|markdown-it|showdown|remark|rehype|react-markdown|mdx|snarkdown|quill|tiptap|draft-js|slate|ckeditor|tinymce`.
Flag markdown-it `html: true`; marked output unsanitized; `rehype-raw` without
`rehype-sanitize` after it; MDX compiled from user input (arbitrary JS); link renderers
passing hrefs through.
Confirm: user or LLM content reaches the renderer with raw HTML or unfiltered link
schemes.
Fix: no raw HTML, or `rehype-sanitize` after `rehype-raw`; markdown-it `html: false`
with `validateLink`; DOMPurify on output; never compile user MDX.
Not a finding: build-time docs from the repo.

### xss.uploads — user files served from the app origin · CWE-79, CWE-434
Detect: accepted types incl. `image/svg+xml`, `text/html` or XML; uploads served from
the app origin or a sibling sharing cookies; no `Content-Disposition: attachment`; no
`nosniff`; user SVG in `object`, `embed` or `iframe`; Next.js `dangerouslyAllowSVG`
without `contentSecurityPolicy`.
Confirm: client-controlled type, same-origin serving, no sandboxing headers.
Fix: a separate cookieless registrable domain; `attachment` for non-images; `nosniff`;
`Content-Security-Policy: sandbox; default-src 'none'` on upload responses; sanitize or
rasterize SVG.
Not a finding: SVG only ever in `img` from a separate domain.

### xss.mutation — DOM clobbering and mutation XSS · CWE-79
Detect: globals read by name that elements can shadow (`window.config`,
`document.<name>`, `if (window.X)`) on pages with sanitized user HTML allowing `id` or
`name`; sanitize-then-modify, double parsing, sanitizing in one context and inserting
into `svg`, `math`, `template`, `noscript` or `style`; DOMPurify versions with known
bypasses (lockfile).
Confirm: the global lookup plus a user-HTML sink allowing `id`/`name`, or the
post-sanitize mutation.
Fix: module-scoped config; current DOMPurify with `SANITIZE_NAMED_PROPS: true`;
sanitize the final string once, right before insertion.
Not a finding: pages with no user-controlled HTML.

### xss.eval — client-side eval and template injection · CWE-95, CWE-1336
Detect: `(^|[^A-Za-z0-9_.])eval[(]|new Function[(]|set(Timeout|Interval)[(] *["'`]|import[(][^"'`]|ng-app|Vue[.]compile|Handlebars[.]compile|_[.]template[(]`;
AngularJS `ng-app` over server HTML containing user `{{`; Vue mounted over server HTML
with user data.
Confirm: user data concatenated into a compiled string.
Fix: remove eval; precompile; mount on elements without user content; `v-pre` on user
blocks.
Not a finding: bundler and build config.

## Headers and policy

### hdr.csp — missing or weak Content-Security-Policy · CWE-693, CWE-1021 · ASVS V3
Detect: CSP across every header source. Flag:
- absent on HTML;
- `script-src` with `'unsafe-eval'`, with `'unsafe-inline'` but no nonce or hash, or
  with `*`, `https:` or `data:`;
- allowlisted hosts with known bypasses (`*.googleapis.com`, `cdnjs.cloudflare.com`,
  `*.cloudfront.net`) without `'strict-dynamic'`;
- no `object-src 'none'` or `base-uri`;
- a static nonce (literal, build-time, reused) instead of one per request;
- Report-Only as the only header;
- `frame-ancestors` in a meta tag.

Confirm: quote the effective policy and `path:line`; name the bypass each weak directive
allows; show per-request nonce generation or its absence.
Fix: a strict CSP set per response in middleware: `script-src 'nonce-<128-bit>'
'strict-dynamic' https: 'unsafe-inline'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; require-trusted-types-for 'script'`; roll out report-only first.
Not a finding: `'unsafe-inline'` beside a nonce (ignored by modern browsers); JSON-only
APIs need only `default-src 'none'; frame-ancestors 'none'`. Missing CSP alone is
HARDENING; it rises with a confirmed XSS.

### hdr.framing — clickjacking · CWE-1021
Detect: no `frame-ancestors` and no `X-Frame-Options` on HTML with one-click state
changes (delete, transfer, OAuth consent, approve); `frame-ancestors *`; JS
frame-busting only.
Confirm: the sensitive page and the missing header across every source.
Fix: `frame-ancestors 'none'` (or an explicit list) plus `X-Frame-Options: DENY`.
Not a finding: embeddable widgets by design (scope per route).

### hdr.other — HSTS, nosniff, Referrer-Policy, COOP/CORP, Trusted Types, Fetch Metadata · CWE-319, CWE-200, CWE-693
Detect: missing HSTS (`max-age` ≥ 31536000; `includeSubDomains`), `nosniff`,
`Referrer-Policy` (or `unsafe-url` where URLs carry tokens), COOP on auth and payment
pages, CORP and Fetch Metadata isolation on authenticated resources, JSONP (`callback=`,
`res.jsonp(`), `X-Powered-By`, a passthrough default Trusted Types policy.
Confirm: quote the config or its absence.
Fix: `helmet()` defaults or equivalent; `Referrer-Policy:
strict-origin-when-cross-origin`; COOP and CORP `same-origin`; reject cross-site
non-navigational requests by `Sec-Fetch-Site`; remove JSONP.
Not a finding: HARDENING, unless a URL-borne token leaks through Referer or JSONP
exposes authenticated data (then MEDIUM or higher).

### cookie.flags — auth cookie attributes · CWE-614, CWE-1004, CWE-1275 · ASVS V7
Detect: `res[.]cookie[(]|cookies[(][)][.]set[(]|Set-Cookie|cookie[.]serialize|express-session|cookie-session|iron-session|SESSION_COOKIE_|CSRF_COOKIE_|session_store`.
Flag auth, session or refresh cookies without `HttpOnly`, `Secure` (or `secure` tied to
`NODE_ENV` behind a TLS-terminating proxy without `trust proxy`), or `SameSite`;
`SameSite=None` without need; `Domain=.example.com` (any subdomain, incl. a taken-over
one, can read or plant it); no `__Host-` prefix; long `Max-Age` without rotation;
literal or weak signing secrets (location only).
Confirm: the options on the production path.
Fix: `__Host-session; Path=/; Secure; HttpOnly; SameSite=Lax` (Strict for admin), no
Domain, rotation on login.
Not a finding: preference cookies; double-submit CSRF cookies readable by JS (must be
Secure).

### csrf — cross-site request forgery · CWE-352 · ASVS V3
Detect: only with cookie auth. `csurf|csrf-csrf|lusca|CsrfViewMiddleware|csrf_exempt|protect_from_forgery|skip_forgery_protection|csrf[(][)][.]disable|VerifyCsrfToken`.
Flag:
- state changes on GET;
- JSON endpoints accepting `text/plain` or form types (`express.text()`, `type: '*/*'`);
- `_method` override;
- `SameSite=None`;
- no Origin or `Sec-Fetch-Site` check;
- login CSRF;
- GraphQL mutations over GET or form encoding;
- Next.js `serverActions.allowedOrigins` wildcards, or proxies that rewrite Host.

Confirm: a cookie-authenticated mutation reachable as a simple request with no token or
origin check.
Fix: SameSite=Lax plus a token, or Origin / `Sec-Fetch-Site` verification on unsafe
methods; reject non-JSON content types on JSON APIs; no GET mutations.
Not a finding: bearer-token APIs; Next.js server actions with default origin checks.

### cors — misconfiguration · CWE-942, CWE-346
Detect: `cors[(]|Access-Control-Allow-Origin|CORS_ALLOW|CORS_ORIGIN_ALLOW_ALL|allow_origins|@CrossOrigin|AllowAnyOrigin|origin: *(true|["'][*]["'])`;
origin reflection with credentials; `endsWith`, `includes` or unanchored regex checks;
`null` allowed; no `Vary: Origin` with caching; socket.io `cors: { origin: '*' }` with
cookies.
Confirm: a credentialed cross-origin read of sensitive data is possible (cookie auth,
broad origin).
Fix: an exact origin set from config; no credentials with a wildcard or reflection;
`Vary: Origin`.
Not a finding: public unauthenticated or bearer-only APIs with `*` and no credentials.

## Browser data and messaging

### msg.postmessage — origin checks · CWE-345, CWE-346, CWE-940
Detect: `addEventListener[(]["']message|onmessage *=`; check that `event.origin` is
compared by strict equality to a constant set (flag `indexOf`, `includes`, `startsWith`,
`endsWith`, unanchored regex) and `event.source` where relevant; `event.data` reaching
sinks, navigation, credentialed fetch or token storage; `postMessage(…, '*')` carrying
tokens, codes or PII.
Confirm: a weak or missing check plus a dangerous use, or a secret sent with `'*'` to a
navigable window.
Fix: exact-origin check; schema-validated data; explicit `targetOrigin`.
Not a finding: dev-only HMR and DevTools messages.

### storage.tokens — tokens in Web Storage or JS-readable cookies · CWE-922, CWE-1004
Detect: `localStorage[.]setItem[(][^)]*(token|jwt|auth|session|refresh)|sessionStorage[.]setItem|js-cookie|document[.]cookie *=`;
persisted auth slices (redux-persist, zustand or pinia persist); SDK `cacheLocation:
'localstorage'`.
Confirm: a bearer or refresh token written to JS-readable storage, and its lifetime.
Fix: `__Host-` HttpOnly cookies or a BFF holding tokens server-side; in-memory
short-lived access tokens refreshed through an HttpOnly cookie with rotation.
Not a finding: non-sensitive preferences. Severity rises with any XSS sink (chain).

### bundle.secrets — secrets shipped to clients · CWE-200, CWE-798, CWE-540
Detect: public env prefixes `NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|GATSBY_|NUXT_PUBLIC_|PUBLIC_`
on names containing `SECRET|PRIVATE|SERVICE_ROLE|ADMIN|DATABASE|DB_|TOKEN|PASSWORD`;
`audit.mjs secrets` hits in client code; `define`/`DefinePlugin` injecting
`process.env` wholesale; server modules imported into `'use client'` files without
`import 'server-only'`; tracked build output; `react-native-config` `.env` values (all
ship in the binary).
Confirm: the variable reaches client code or the built bundle — never print its value.
Fix: move the call server-side; drop the prefix; `import 'server-only'`; rotate the
exposed key (out of band).
Not a finding: publishable keys (exclusions precedents) — check the rule behind them.

### bundle.sourcemaps — source maps and debug in production · CWE-540, CWE-489
Detect: `productionBrowserSourceMaps: *true|sourcemap: *true|devtool: *["']source-map|GENERATE_SOURCEMAP`, Sentry upload
without deleting maps, tracked `.map` files in deploy dirs, devtools enabled in prod,
`console.log` of tokens.
Confirm: the prod config and whether the deploy publishes `*.map`.
Fix: `hidden-source-map`, private upload, delete public maps; strip console in prod.
Not a finding: open-source frontends (LOW at most).

### ssr.leak — data in SSR, RSC and serialized state · CWE-200, CWE-359, CWE-79
Detect: `getServerSideProps`/`getStaticProps` returning whole records (serialized into
`__NEXT_DATA__`); server components passing full objects to `'use client'` components
(RSC payload); Nuxt payload, SvelteKit `load` or Remix `loader` returning secrets or
other users' PII; `window.__INITIAL_STATE__ = ${JSON.stringify(…)}` without escaping
(`</script>` breakout).
Confirm: the server function returns the sensitive field and the client receives it;
or raw `JSON.stringify` inside `script`.
Fix: select only the needed fields; `import 'server-only'`; React taint APIs;
`serialize-javascript` with `isJSON`, or escape `<`.
Not a finding: the current user's own non-sensitive fields.

### scripts.third-party — external scripts and tag managers · CWE-829, CWE-353 · PCI DSS 4.0 6.4.3, 11.6.1
Detect: external `script src` without `integrity` and `crossorigin`; `@latest` or
unpinned CDN URLs; dead or compromised domains (`polyfill.io`); tag managers or session
replay on login and payment pages.
Confirm: the tag, the page and the pin state.
Fix: self-host or pin with SRI; CSP host control; no third-party scripts on auth and
payment pages; remove dead domains.
Not a finding: evergreen loaders that can't take SRI (Stripe.js, Maps) — restrict by CSP
and placement.

### pwa.cache — service workers and shared caching of private responses · CWE-524, CWE-525
Detect:
- `sw.js`, workbox, `next-pwa` or `vite-plugin-pwa` rules caching `/api/`, `/account`
  or `/me`, and no cache purge on logout;
- a service worker registered from a user-controlled URL or upload path, or
  `Service-Worker-Allowed` widening its scope;
- authenticated responses without `Cache-Control: private, no-store`;
- personalized pages cached by the CDN (`s-maxage`, `revalidate`, `force-static`).

Confirm: a rule or header that caches per-user data where others or later users can
read it.
Fix: NetworkOnly for authenticated APIs; purge on logout; `no-store` on authenticated
responses; `Vary: Cookie, Authorization` where caching is needed.
Not a finding: static assets and public pages.

### privacy.leaks — sensitive data in URLs, analytics, replay · CWE-598, CWE-359
Detect: tokens or PII in query strings that stay after load (no
`history.replaceState`); implicit-flow tokens in fragments; `gtag|analytics[.](track|identify)|posthog[.]capture|mixpanel|amplitude`
with email, phone or full objects; session replay without `maskAllInputs` or
`blockAllMedia`; Sentry `sendDefaultPii: true` without scrubbing.
Confirm: the call with the sensitive field.
Fix: secrets in bodies or headers; one-time tokens exchanged and stripped; masking on by
default; `beforeSend` scrubbing.
Not a finding: pseudonymous ids.

### frames.sandbox — iframes and opener · CWE-1021, CWE-1022
Detect: iframes with user or third-party content and no `sandbox`, or with
`allow-scripts` and `allow-same-origin` together; broad `allow=`; `srcdoc` with user
HTML; `window.open` to untrusted URLs without `noopener`.
Confirm: the attributes and where `src`/`srcdoc` come from.
Fix: `sandbox` with `allow-scripts` only, on a separate origin;
`window.open(url, '_blank', 'noopener,noreferrer')`.
Not a finding: first-party embeds.

### ws.origin — WebSocket and SSE · CWE-1385, CWE-346
Detect: `WebSocketServer|socket[.]io|new WebSocket[(]` servers without an Origin check
on upgrade (`verifyClient`, `allowRequest`) under cookie auth; `socket.join(room)` from
client input without a membership check; tokens in WS URLs; `ws://` to production.
Confirm: a cookie-authenticated upgrade with no Origin check, or a join without authz.
Fix: Origin allowlist on upgrade; a short-lived ticket in the first message;
per-message authorization; `wss://`.
Not a finding: token-in-first-message auth without cookies.

### oauth.client — OAuth shape in browser and mobile clients · CWE-346, CWE-287
Detect: `response_type=token`; no `code_challenge`; state or nonce not checked on the
callback; `jwt-decode` claims trusted for authorization; redirect_uri built from
`window.location`; tokens sent with `postMessage('*')`.
Confirm: the callback without checks, or the flow parameters.
Fix: code + PKCE; verify state and nonce; validate tokens server-side.
Not a finding: Auth0 SPA, MSAL, Auth.js with defaults.

### next.config — framework configuration · CWE-918, CWE-200
Detect: `images.remotePatterns` or `domains` with `**` or `hostname: '*'`; `rewrites()`
proxying user path segments to internal hosts; `force-static` or `revalidate` on
personalized pages; a weak preview or draft-mode secret check; a huge
`serverActions.bodySizeLimit`. Same reading for Nuxt `routeRules`, SvelteKit hooks, and
Vite proxies used in production. Middleware matcher gaps are `authz.missing`.
Confirm: quote the config.
Fix: explicit `protocol`, `hostname`, `pathname` patterns; no static caching of
personalized pages.
Not a finding: exclusions for truly public routes.

### dev.server — dev servers reachable from the network · CWE-1327, CWE-350
Detect: `host: *(true|["']0[.]0[.]0[.]0)|--host( |=)0[.]0[.]0[.]0|allowedHosts: *["']all|disableHostCheck: *true|server[.]allowedHosts|HOSTNAME=0[.]0[.]0[.]0`
in Vite, webpack-dev-server, Next, Nuxt, Storybook or Jupyter config and npm scripts;
dev proxies forwarding to internal services.
Confirm: the dev script or config line, and whether it serves source, env or an API
proxy.
Fix: bind to `127.0.0.1`; keep host checks on; explicit `allowedHosts`.
Not a finding: containers that publish the port only to `127.0.0.1`. LOW unless the dev
server proxies credentials or exposes env (DNS rebinding then reaches it).

### ext.browser — browser extensions · CWE-284, CWE-346, CWE-829
Detect: `manifest.json` with `manifest_version`: `host_permissions` or `permissions`
with `<all_urls>`, `*://*/*`, `cookies`, `webRequest`, `debugger`, `scripting`;
`externally_connectable` with broad `matches`; `onMessageExternal` and
`runtime.onMessage` handlers without `sender.id`/`sender.origin` checks;
`chrome.scripting.executeScript` or `eval` with fetched code; content scripts writing
page-supplied HTML into the DOM; `web_accessible_resources` over-exposed.
Confirm: the manifest entry and the handler path from an untrusted page or extension to
the privileged API.
Fix: least host permissions (optional permissions on demand); sender checks against a
fixed id or origin set; no remote code; sanitize before DOM writes.
Not a finding: extensions with no host permissions and no external messaging.

## Mobile

### mobile.storage — secrets on the device · CWE-312, CWE-922 · MASVS-STORAGE-1
Detect:
- `AsyncStorage[.]setItem` with tokens, passwords or PII, MMKV without
  `encryptionKey`, persisted auth on AsyncStorage;
- Android `SharedPreferences` (not `EncryptedSharedPreferences`), external storage,
  `allowBackup` true without exclusion rules, unencrypted SQLite for sensitive data;
- iOS `UserDefaults` tokens, Keychain `kSecAttrAccessibleAlways`, no
  `NSFileProtectionComplete`;
- token logs in release builds.

Confirm: the call and the key name.
Fix: Keychain/Keystore through `expo-secure-store` or `react-native-keychain` with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`; backup exclusions; logs stripped in release.
Not a finding: non-sensitive preferences.

### mobile.deeplinks — deep, App and Universal Links · CWE-939 · MASVS-PLATFORM-1
Detect: custom schemes (`myapp://`) handling auth callbacks; `CFBundleURLSchemes` or
Expo `scheme` for OAuth redirects; `autoVerify` missing on https links; `Linking`
handlers or navigation `linking.config` routes that perform actions or load a parameter
into a WebView or `openURL`.
Confirm: the handler and the sensitive action a crafted link reaches.
Fix: verified https links with PKCE; validate parameters; confirm state changes; a host
allowlist before WebView loads.
Not a finding: navigation to public screens.

### mobile.components — exported Android components and intents · CWE-926, CWE-927
Detect: `android:exported` true without a signature permission; implicit export through
intent filters (targetSdk below 31); broad `FileProvider` paths (`root-path`);
`grantUriPermissions`; `FLAG_MUTABLE` PendingIntents with implicit intents; forwarded
intents from extras started without validation.
Confirm: the manifest entry and the handler.
Fix: `exported` false unless needed; signature permissions; `FLAG_IMMUTABLE`; scoped
provider paths; validated forwarded intents.
Not a finding: the launcher activity.

### mobile.transport — cleartext, trust, pinning · CWE-295, CWE-319 · MASVS-NETWORK-1
Detect: `usesCleartextTraffic` true, `cleartextTrafficPermitted`, user certificate
sources outside `debug-overrides`; trust-all `TrustManager` or `HostnameVerifier`; iOS
`NSAllowsArbitraryLoads`; `http://` production hosts; for banking, health or payment
apps, no pinning with backup pins.
Confirm: the release config, not debug overrides.
Fix: HTTPS only; no user CAs in release; SPKI pinning with backups where risk warrants.
Not a finding: `debug-overrides`; missing pinning in low-risk apps (HARDENING).

### mobile.webview — WebView bridges and settings · CWE-749 · MASVS-PLATFORM-2
Detect:
- `addJavascriptInterface` on WebViews loading remote content;
- `setAllowFileAccess`, `setAllowUniversalAccessFromFileURLs`,
  `setAllowFileAccessFromFileURLs`;
- `onReceivedSslError` calling `proceed()`;
- `WKScriptMessageHandler` exposing sensitive actions;
- `react-native-webview` with an `originWhitelist` of `*`, `onMessage` without a URL
  check, tokens in `injectedJavaScript`, `mixedContentMode` always, or a `source` URI
  from a parameter.

Confirm: a bridge exposed to navigable attacker content.
Fix: a navigation allowlist; validated message origin; a minimal bridge; no injected
tokens; file access off; cancel on SSL errors.
Not a finding: bundled local content with no bridge.

### mobile.build — release hardening · CWE-798, CWE-489
Detect: secret names in `app.json`/`app.config.*` `extra`, `Info.plist`, `strings.xml`,
`gradle.properties`, or `.env` read by `react-native-config`; `android:debuggable`
true; release `minifyEnabled false`; OTA updates (`expo-updates`) without code signing.
Confirm: key names; values only as `audit.mjs secrets` prints them.
Fix: secrets server-side; release flags; signed OTA updates.
Not a finding: public client ids.

## Desktop

### electron.webprefs — renderer privileges · CWE-94, CWE-829
Detect: `new BrowserWindow[(]`, `webPreferences`, `webview` tags with
`nodeIntegration: true`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`,
`contextIsolation: false`, `sandbox: false`, `webSecurity: false`,
`allowRunningInsecureContent`, `enableRemoteModule` or `@electron/remote`, `webview`
with `allowpopups`/`nodeintegration`, no `will-attach-webview` guard; an old Electron in
the lockfile.
Confirm: the window can load remote or user-influenced content.
Fix: `contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity:
true`; no remote module; a narrow `contextBridge` API; a current Electron.
Not a finding: omitted options (modern defaults are safe).

### electron.ipc — IPC, openExternal, navigation, updates, Tauri · CWE-78, CWE-939
Detect:
- `shell[.]openExternal[(]` with renderer- or link-derived URLs;
- `ipcMain[.](handle|on)` doing fs, process or shell work without checking
  `event.senderFrame.url`;
- preload exposing `ipcRenderer` wholesale or a generic `invoke(channel, …)`;
- no `setWindowOpenHandler` or `will-navigate` restriction;
- protocol handlers parsing argv unsafely, or `registerFileProtocol` traversal;
- HTTP or unsigned auto-updates;
- fuses not set: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar`,
  `EnableEmbeddedAsarIntegrityValidation`;
- Tauri `all: true` allowlists, a broad `shell.open` scope,
  `dangerousRemoteDomainIpcAccess`.

Confirm: renderer-reachable input → privileged action without validation.
Fix: an `https:` host allowlist before `openExternal`; validate the sender in every
handler; narrow named APIs; deny navigation and new windows by default; flip fuses;
signed HTTPS updates; minimal Tauri capabilities.
Not a finding: constant URLs.
