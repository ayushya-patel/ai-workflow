# Provides — <Module name>

This module's **public boundary**. Everything another module — in this repo or in
another team's repo — is allowed to depend on.

Anything not listed here is internal and may change without notice. Anything listed
here cannot change without checking the **Consumed by** column first — that column is
your blast radius. A breaking change to a surface another team consumes needs that
receiver's code-owner approval (see the ai-workflow plugin `law/`).

## Routes / endpoints

| Path | Params | Query / search params | Returns or renders |
|---|---|---|---|
| `/<path>/:id` | `id` — <what it is> | `?sort=` optional | <what the caller gets> |

## Output

| Route / endpoint | Returns | Type |
|---|---|---|
| `/<path>` | <plain description> | `<shared type location>` → `<TypeName>` |

Link the type. **Do not restate its fields here** — a field list in markdown is a
second truth that nothing checks, and it will disagree with the code inside a month.

## Input

| Route / endpoint | Method | Accepts | Returns | On failure |
|---|---|---|---|---|
| `/<path>` | POST | `<InputShape>` | <result or redirect> | 422 with field errors |

## Status and redirect behaviour

| Situation | Response |
|---|---|
| Not found | 404 |
| Unauthorised | 401, or redirect to sign-in |

## Consumed by

Which other modules depend on the above. **Keep this current** — it is the only cheap
way to know what a change here will break.

| Module | Depends on | Why |
|---|---|---|
| `<repo>/<nnn>-<slug>` | the `/<path>/:id` shape | <why> |

If this table is empty and the module has shipped, either nothing uses it (say so
explicitly) or the table is stale.
