# Checklist — backend: injection, taint and data handling

Agent `ai-workflow:security-injection`. Per class: **Detect** · **Confirm** · **Fix** ·
**Not a finding**. Grep the sink with `audit.mjs grep '<pattern>' -- <scope>`, then
trace back to a source.

- **Sources:** request params, query, body, headers, cookies, uploaded files and their
  names, message and webhook bodies, DB values other users wrote, third-party responses,
  LLM output.
- **Trusted:** constants, server config, env vars, CLI flags (exclusions §7).

Patterns are anchored so they don't match inside other identifiers. They are leads;
read every hit.

## Injection

### inj.sql — SQL and ORM raw queries · CWE-89 · A05:2025 · ASVS V1
Detect: `queryRawUnsafe|executeRawUnsafe|(sequelize|knex|Prisma|db|pool|client|conn|connection)[.](raw|query|execute)[(]|[.]extra[(]|RawSQL[(]|cursor[.]execute[(] *f["']|text[(] *f["']|createQuery[(][^)]*[+]|createNativeQuery[(]|createStatement[(]|find_by_sql|[.]where[(]["'][^"']*#[{]|[.]order[(]params|ORDER BY [$][{]|orderBy[(]req[.]|Sprintf[(]"(SELECT|INSERT|UPDATE|DELETE)|execute[(][^)]*([%] |[.]format[(]| [+] )`.
Flag string-built SQL; user-chosen ORDER BY, column or table names; `Prisma.raw()`;
Sequelize `where: req.query`.
Confirm: source → the built string → execution, with no binding; identifiers with no
allowlist.
Fix: bound parameters or tagged templates (Prisma `$queryRaw` with a template, `sql`
tags); an allowlist map for sort column and direction.
Not a finding: Prisma's tagged `$queryRaw`, slonik and postgres.js `sql` tags,
Sequelize `replacements`, interpolated constants or enums.

### inj.nosql — operator injection · CWE-943
Detect: `find(One)?[(][{][^}]*req[.](body|query)|findOne[(]req[.]body|[$]where|[$]regex|[$]expr|[$]function|mapReduce[(]`.
Flag parsed objects (`qs` turns `a[$ne]=1` into an object) reaching filters; login
filters from the body without string coercion; `$where` or `$function` with input;
regexes from input.
Confirm: the value can be an object (no schema forcing a string) and reaches the
filter.
Fix: schema-validate types; Mongoose `sanitizeFilter: true` or `mongo-sanitize`; never
`$where` with input; escape regex input.
Not a finding: typed Mongoose paths that cast to String on equality (check the schema).

### inj.command — OS command and argument injection · CWE-78, CWE-88
Detect: `(^|[^A-Za-z0-9_.])(exec|execSync|spawnSync|system|popen|shell_exec|passthru|proc_open)[(]|child_process|shell: *true|os[.](system|popen)[(]|shell=True|getRuntime[(][)][.]exec|ProcessBuilder[(]|%x[(]|exec[.]Command[(]"(sh|bash)"`.
Argument injection: input as an operand to `git`, `curl`, `tar`, `ffmpeg`, `convert`,
`ssh`, `rsync` without `--` (`--upload-pack=`, `-o ProxyCommand=`,
`--checkpoint-action`).
Confirm: input reaches the shell string, or argv in an option position.
Fix: `execFile`/`spawn` with an argv array and `shell: false`; `--` before operands;
allowlisted values; a library instead of the CLI.
Not a finding: constant commands; input checked by a strict regex (`^[a-f0-9]{40}$`).

### inj.code — template injection, eval, expression languages · CWE-1336, CWE-94, CWE-917
Detect: `render_template_string|Template[(][^)]*request|from_string[(]|ejs[.]render[(]|handlebars[.]compile[(]|pug[.]compile[(]|nunjucks[.]renderString|createTemplate[(]|SpelExpressionParser|parseExpression[(]|OgnlUtil|(^|[^A-Za-z0-9_.])eval[(]|new Function[(]|vm[.]run|vm2|ERB[.]new|_[.]template[(]|__[$][{]`.
Flag input used as the template source or as code; user-authored email or notification
templates on a full engine; `vm`/`vm2` treated as a sandbox; EJS with user-controlled
options.
Confirm: the template or code string derives from input or a user-editable DB field.
Fix: input only as context variables with autoescape; logic-less or sandboxed engines
for user templates (Liquid strict, Mustache, Jinja2 `SandboxedEnvironment`); remove
eval; isolated-vm or a separate process with no secrets.
Not a finding: `render_template('f.html', x=input)` (XSS aside).

### inj.ldap — LDAP and XPath · CWE-90, CWE-643
Detect: `ldap|search_s[(]|ldapjs|DirContext|[(]uid=|[(]cn=|XPathExpression|xpath[.]evaluate`
with concatenation.
Confirm: input in the filter without RFC 4515 escaping.
Fix: `escape_filter_chars`, ldapjs filter objects, parameterized XPath.
Not a finding: filters built from library filter objects.

### inj.header — CRLF and response splitting · CWE-113, CWE-93
Detect: `setHeader[(]|res[.]header[(]|response[.]headers|add_header` with input, on
runtimes that don't reject CR/LF (raw sockets, old Python `http.server`, some servlet
containers).
Confirm: input reaches a header value and the runtime doesn't strip CR/LF.
Fix: reject CR/LF; framework header APIs.
Not a finding: Node `http`, Go `net/http` and modern frameworks (they reject CR/LF).

### inj.email — SMTP and mail header injection · CWE-93, CWE-150
Detect: `nodemailer|sendmail|smtplib|MimeMessage|Mail::|PHPMailer|mail[(]` where `to`,
`cc`, `bcc`, `subject`, `from` display name or `replyTo` come from input.
Flag CR/LF not rejected in header fields; user-chosen recipients on contact or share
forms (open relay); raw `sendmail -t` with user text.
Confirm: input reaches a header field of the message builder without validation.
Fix: validate addresses with the library parser; reject CR/LF; fixed recipients for
contact forms; user text only in the body.
Not a finding: libraries that encode headers and reject newlines (current nodemailer)
with recipients from the session.

### inj.csv — formula injection in exports · CWE-1236
Detect: CSV and spreadsheet writers (`csv-stringify|json2csv|papaparse[.]unparse|csv[.]writer|to_csv[(]|xlsx|exceljs|openpyxl|CSV[.]generate`) over fields users wrote.
Flag cells starting with `=`, `+`, `-`, `@`, tab or CR written unescaped.
Confirm: a user-writable field reaches an export that staff open.
Fix: prefix risky leading characters with `'` or escape per the library's option; or
export as XLSX with typed text cells.
Not a finding: exports of system-generated values only.

### inj.log — logs that execute or render · CWE-117
Detect: `log4j-core` below 2.17.1 in lockfiles; logs rendered as HTML in an admin
viewer.
Confirm: the vulnerable version resolved, or the viewer renders unescaped.
Fix: upgrade and disable lookups; escape in the viewer; structured JSON logging.
Not a finding: plain-text log forging (exclusions §5).

### deser.unsafe — insecure deserialization · CWE-502 · A08:2025
Detect: `pickle[.]loads?[(]|cPickle|dill[.]load|joblib[.]load[(]|torch[.]load[(]|allow_pickle=True|yaml[.]load[(]|yaml[.]unsafe_load|marshal[.]loads|shelve[.]open|ObjectInputStream|readObject[(]|XMLDecoder|XStream|enableDefaultTyping|JsonTypeInfo[.]Id[.]CLASS|BinaryFormatter|NetDataContractSerializer|TypeNameHandling[.](All|Auto)|(^|[^A-Za-z0-9_])unserialize[(]|Marshal[.]load|node-serialize|new Yaml[(][)]`;
pickle-based session serializers.
Confirm: bytes from a request, cookie, queue, shared cache, upload or user-writable
bucket reach the call.
Fix: JSON with a schema; `yaml.safe_load`; `torch.load(weights_only=True)` or
safetensors; `ObjectInputFilter` allowlists; polymorphic typing off; HMAC-sign state
that must round-trip.
Not a finding: data written and read by the same trusted process from a private path.

### ssrf — server-side request forgery · CWE-918 · A01:2025 · API7:2023 · ATT&CK T1552.005
Detect: `(^|[^A-Za-z0-9_])fetch[(]|axios|got[(]|(^|[^A-Za-z0-9_.])request[(]|http[s]?[.](get|request)[(]|urllib|requests[.](get|post|request)[(]|httpx|HttpClient|RestTemplate|WebClient|OkHttp|curl_exec|file_get_contents[(]|open-uri|URI[.]open|Net::HTTP|page[.]goto[(]|wkhtmltopdf|weasyprint`
with a URL or host from input or user-written DB fields.
Features to check: webhooks, link previews, image-by-URL, PDF and HTML renderers, OIDC
discovery, JWKS/jku, SAML metadata, import-from-URL, LLM browse tools.
Flag:
- string allow or block lists, bypassed by `2130706433`, `[::ffff:127.0.0.1]`,
  `0.0.0.0`, names resolving inward, `fd00::/8`, `100.64.0.0/10`;
- validate-then-fetch with a second DNS lookup (rebinding);
- redirects followed after validating only the first URL;
- non-HTTP schemes;
- renderers loading attacker HTML.

Confirm: input controls host or scheme (path-only is excluded) and reaches the client
through the gap. Pair with `iac.compute` (IMDSv1) for impact. Never request a metadata
endpoint.
Fix:
- resolve once, reject private, loopback, link-local, CGNAT, ULA and v4-mapped addresses
  on the resolved IP, and connect to that IP (`request-filtering-agent`,
  `ssrf-req-filter`, Python `advocate`);
- no redirects, or revalidate each hop;
- https only, and an egress proxy allowlist;
- renderers sandboxed with no internal network.

Not a finding: URLs from server config; a fixed vendor host with input in the path
only.

### proto.pollution — prototype pollution (server and SSR) · CWE-1321
Detect: deep merge or set on parsed input: `merge[(]|mergeWith[(]|defaultsDeep[(]|setWith[(]|zipObjectDeep[(]|deepmerge|extend[(]true`,
custom recursive merges without `__proto__`/`constructor`/`prototype` filtering; `qs`
with `allowPrototypes: true`; lockfile versions.
Confirm: request JSON or query reaches the merge, and a gadget reads the polluted
property (option objects, template engines, `child_process` options).
Fix: reject those keys; `Object.create(null)` or `Map`; schema validation with
`.strict()`; upgrade.
Not a finding: merges of trusted config; lodash 4.17.21+ for known vectors.

## Files and parsers

### file.traversal — path traversal, zip slip, symlinks · CWE-22, CWE-23, CWE-59
Detect: `path[.](join|resolve)[(][^)]*req[.]|readFile[(][^)]*req[.]|sendFile[(]|res[.]download[(]|open[(][^)]*request[.]|os[.]path[.]join[(][^)]*request|send_file[(]|FileResponse[(]|Paths[.]get[(][^)]*param|extractall[(]|ZipFile|AdmZip|unzipper|tar[.]x[(]|ZipEntry|getName[(][)]`.
Flag joins without resolve plus a prefix check; `..` checks on the raw string (encoding,
absolute paths — Python `os.path.join` drops the base for an absolute input); archive
entry names used as paths; `tarfile` without `filter='data'`; symlinks followed.
Confirm: join then use with no `realpath` + `startsWith(base + sep)`.
Fix: ids mapped to server-side names; `realpath` and a prefix check with the trailing
separator; reject absolute and symlink entries; `extractall(filter='data')`.
Not a finding: Express `sendFile` with `root`; Flask `send_from_directory`;
`path.basename` applied first (symlinks aside).

### file.upload — unrestricted upload · CWE-434, CWE-646
Detect: `multer|busboy|formidable|UploadFile|request[.]files|request[.]FILES|MultipartFile|ActiveStorage|CarrierWave|putObject|createPresignedPost|getSignedUrl`.
Flag type checks by extension or client Content-Type; storage under the web root;
original filenames; no size limit; presigned POST without `content-length-range` and
Content-Type conditions; ImageMagick or Ghostscript on untrusted files. Serving user
files from the app origin is `xss.uploads` in `client.md`.
Confirm: the validation path and where the file is stored, executed or processed.
Fix: magic-byte allowlist; random names; object storage; size limits; re-encoded
images; presigned conditions; an ImageMagick policy.
Not a finding: admin-only uploads to private storage.

### xml.xxe — external entities and entity expansion · CWE-611, CWE-776
Detect: `DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory|lxml|etree[.](parse|fromstring)|minidom|libxmljs|Nokogiri::XML|XmlDocument|XmlReader|simplexml_load|DOMDocument`.
Flag Java factories without `disallow-doctype-decl`; lxml `resolve_entities=True` or
network on; libxmljs `noent: true`; Nokogiri `NOENT`/`DTDLOAD`; stdlib `xml.etree` on
untrusted input (billion laughs). Paths: SAML, SOAP, SVG, DOCX, XLSX.
Confirm: untrusted XML reaches the parser with that config.
Fix: DTDs off; `defusedxml`; secure-processing features; maintained SAML libraries.
Not a finding: `xml2js`, `fast-xml-parser` (no entity resolution); .NET 4.5.2+
defaults.

### redirect.open — open redirect · CWE-601
Detect: `res[.]redirect[(][^)]*req[.]|redirect[(][^)]*request[.]|HttpResponseRedirect[(]|NextResponse[.]redirect[(]|redirect_to`
with `next|returnTo|redirect|continue|url|dest|goto|callbackUrl`. Flag checks using
`startsWith('/')` (bypassed by `//evil.tld` and a backslash after the slash),
`includes(domain)`, or an unanchored regex.
Confirm: the parameter, the check, and a bypass string it accepts.
Fix: parse with `new URL(x, base)` and require `origin === base.origin`, or map ids to
paths.
Not a finding: alone it is LOW (exclusions §14); it rises only in a chain (OAuth, SSRF
following redirects).

## Crypto

### crypto.random — insecure randomness · CWE-330, CWE-338 · A04:2025
Detect: `(^|[^A-Za-z0-9_.])(Math[.]random[(]|random[.](random|randint|choice)[(]|new Random[(]|mt_rand[(]|rand[(]|uniqid[(])|uuid[.]?v1[(]|uuid1[(]|Date[.]now[(][)][.]toString`
in token, OTP, reset, session, API key, invite or nonce code.
Confirm: the value is security-relevant.
Fix: `crypto.randomBytes(32)`, `crypto.randomUUID()`, `secrets.token_urlsafe(32)`,
`SecureRandom`, `random_bytes`.
Not a finding: jitter, sampling, UI.

### crypto.cipher — cipher misuse and weak primitives · CWE-327, CWE-329, CWE-323, CWE-321 · A04:2025 · ASVS V11
Detect: `createCipher[(]|createCipheriv[(]|Cipher[.]getInstance[(]|AES/ECB|MODE_ECB|["'/-](DES|DESede|3DES|RC4|RC2|Blowfish)["'/-]|PKCS1v15|PKCS1Padding|createHash[(]["'](md5|sha1)["']|hashlib[.](md5|sha1)[(]|MessageDigest[.]getInstance[(]"(MD5|SHA-?1)"`
in security use; constant IVs or nonces; GCM nonce reuse; CBC without a MAC; keys
hardcoded or derived by a plain hash; RSA under 2048; homegrown crypto.
Confirm: the construction and where key and IV come from.
Fix: AEAD through a high-level library (libsodium, Tink, `cryptography` AESGCM with a
random 96-bit nonce per message); keys from KMS; RSA-OAEP; HKDF or argon2 for
derivation.
Not a finding: md5 or sha1 for checksums, cache keys, ETags.

### crypto.compare — timing-unsafe secret comparison · CWE-208
Detect: `(signature|hmac|digest|token|apiKey|api_key|secret|otp)[A-Za-z_]* *(===|==|!==|!=)|[.]equals[(](signature|token)|strcmp[(]`.
Confirm: an attacker-supplied value compared with a secret.
Fix: `crypto.timingSafeEqual` on equal-length buffers, `hmac.compare_digest`,
`MessageDigest.isEqual`, `hash_equals`; or look up by a hashed token.
Not a finding: DB lookup by the hash of a high-entropy token (note only).

### crypto.tls — certificate verification disabled · CWE-295
Detect: `verify=False|rejectUnauthorized: *false|NODE_TLS_REJECT_UNAUTHORIZED|InsecureSkipVerify: *true|CURLOPT_SSL_VERIFYPEER|TrustAllCerts|HostnameVerifier|curl -k|--insecure|sslmode=disable|ssl: *false`
on production paths.
Confirm: the setting is on a production code path or config.
Fix: keep verification on; pin a CA bundle; `sslmode=verify-full`.
Not a finding: tests against localhost.

## Leakage

### leak.errors — internals sent to clients · CWE-209, CWE-497, CWE-215
Detect: `res[.](send|json)[(](err|error)[)]|err[.]stack|traceback[.]format_exc|printStackTrace|detail=str[(]e[)]|include-stacktrace=always|DEBUG *= *True|app[.]debug *=|APP_DEBUG=true|X-Powered-By`;
GraphQL `extensions.exception`.
Confirm: the production path returns internals.
Fix: a global handler returning a generic message and a correlation id; details logged
server-side; debug off by environment.
Not a finding: field-level validation messages.

### leak.logs — secrets and PII in logs, APM, analytics · CWE-532, CWE-359 · A09:2025
Detect: `(log|logger|console)[.][a-z]+[(][^)]*(password|token|authorization|cookie|ssn|card|cvv|otp|secret)|console[.]log[(]req[.](body|headers)|logger[.][a-z]+[(]req[.](body|headers)|morgan[(][^)]*(body|authorization)|print[(]os[.]environ|console[.]log[(]process[.]env|sendDefaultPii: *true`;
full request bodies logged on auth or payment routes; tokens in URLs that proxies log.
Confirm: the field holds sensitive data on that path, and no redaction applies (pino
`redact`, structlog processors, Sentry `beforeSend`).
Fix: a redaction list in the logger; scrubbing in `beforeSend`; never log bodies of auth
or payment routes; tokens in headers, not URLs.
Not a finding: ids, URLs, masked values.

### leak.response — excessive data in responses · CWE-213, CWE-200 · API3:2023
Detect: whole ORM entities serialized (`res.json(user)`, `fields = '__all__'`, no DTO or
`toJSON`) on models holding `passwordHash`, `mfaSecret`, `resetToken` or internal flags;
list endpoints returning other users' emails or PII.
Confirm: the serializer path and the sensitive field on the model.
Fix: explicit response DTOs or `select`.
Not a finding: the caller's own non-sensitive fields.

### data.retention — retention and deletion · CWE-212 · GDPR Art. 5, 17
Detect: no TTL on sessions, reset tokens, OTPs or temp uploads; soft delete with no
purge; account deletion that misses backups, search indexes, object storage or
analytics.
Confirm: absence across code and IaC lifecycle rules.
Fix: TTL indexes and lifecycle rules; a deletion workflow covering every store.
Not a finding: HARDENING, unless a token or OTP never expires (then `authn.*`).

## Input-driven DoS (only what exclusions §11 and the overrides keep)

### dos.input — ReDoS, bombs, unbounded parsing · CWE-1333, CWE-409, CWE-770
Detect: `new RegExp[(]` with input; nested quantifiers (`(a+)+`, `(.*a){n}`) applied to
input on a backtracking engine; `gunzip|inflate|unzip` without `maxOutputLength` or size
caps; Pillow `MAX_IMAGE_PIXELS = None`; `sharp` without `limitInputPixels`; bcrypt on
unbounded input; raw or text body parsers without a limit.
Confirm: attacker input reaches it on a server request path.
Fix: RE2 or rewritten patterns plus length caps; output caps; pixel limits; body
limits.
Not a finding: regexes over config; admin batch jobs.

## Native code

### native.memory — memory-unsafe code on an input path · CWE-787, CWE-125, CWE-134, CWE-190
Detect: files from `inventory` `NATIVE`, plus Rust `unsafe` blocks, cgo, JNI and Python
C extensions: `strcpy|strcat|sprintf|gets|memcpy|alloca|printf[(][a-z_]+[)]|unsafe [{]|from_raw_parts|transmute|C[.]CString|JNIEXPORT`.
Flag unbounded copies; format strings from input; length arithmetic that can overflow
into an allocation size; `unsafe` slices built from input lengths; missing bounds checks
before indexing.
Confirm: the input path from an entry point into the native function, and the missing
bound.
Fix: bounded APIs (`snprintf`, `strlcpy`, checked arithmetic); safe abstractions
around `unsafe`; fuzz the boundary.
Not a finding: vendored native libraries with no repo-specific change (list them under
Not audited).
