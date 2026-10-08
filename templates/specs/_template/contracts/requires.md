# Requires — <Module name>

What this module needs from outside itself, and how it behaves when that changes
underneath it.

The point of this file is a one-glance answer to *"upstream changed X — what breaks?"*

## Upstream data

**Reference the shared type; never redefine it.** A hand-written copy of an upstream
shape is a second truth that nothing checks.

List only the fields this module actually reads, and the client call it reads them
through. That narrowness is the value: it turns "upstream changed its envelope" into a
grep.

| Client call | Entity | Fields read | Type | If missing or renamed |
|---|---|---|---|---|
| `<client>.getProduct(handle)` | `Product` | `id`, `price` | `<shared type location>` → `Product` | throw at parse — a wrong price must never render |
| `<client>.getProduct(handle)` | `Product` (block `Hero`) | `heading`, `image` | `<shared type location>` → `Product` | degrade: skip the block, log once |

Every row's failure behaviour is `throw` or `degrade`. There is no third option, and
"it won't happen" is not one of them. Commerce fields throw; content fields degrade —
even when both arrive in one response, the distinction is what keeps a wrong price
off the page.

## Parsed at

Where the boundary is enforced — in the repo's client layer, immediately on the
response, never deep in business logic or in a component.

| Source | Parsed in |
|---|---|
| <upstream> | `<path>` |

## Other modules

Contracts from sibling modules that this one depends on. Each must appear in that
module's `contracts/provides.md` — **if it does not, you are depending on someone's
internals** and that is a blocking finding in `/ai-workflow:check`.

| Module | Depends on | Listed in their provides? |
|---|---|---|
| `<repo>/<nnn>-<slug>` | the `/<path>/:id` shape | yes / **no ← fix this** |

## Environment

| Variable | Purpose | Required |
|---|---|---|
| `<VAR>` | <purpose> | yes / no |

Credentials for a system this repo must not call directly do not appear here — a key
for one is a finding, not a configuration choice.
