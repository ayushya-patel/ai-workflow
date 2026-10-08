# Plan — <Module name>

Derived from `spec.md`. This is where implementation details are allowed.

## Approach

The chosen approach in a paragraph, and why it beat the alternatives. If a choice
here is expensive to reverse, it needs an ADR — link it.

## Touched surface

| Path | Change |
|---|---|
| `<path>` | new / modified / deleted |

## Data

Which system owns each piece of data (backend service / CMS / API gateway / client state), what the
shapes are, and where the boundary is enforced.

## Consumed contracts

What this module reads from each upstream system, and what happens when the upstream
shape changes.

| Contract | Read from | Parsed at | On shape mismatch |
|---|---|---|---|
| `<Name>` | <owning system> | `<path>` | throw / degrade / fall back |

New or changed contracts land in the repo's shared type location **before** the code
that uses them, so a mismatch fails typecheck rather than rendering `undefined`.

## Entry points

Routes, endpoints, jobs or screens added or changed; what runs server-side vs
client-side; caching and revalidation behaviour; and what happens on failure.

## Risks

| Risk | Mitigation |
|---|---|
| <risk> | <mitigation> |

## Test strategy

What gets a test and what deliberately does not, per the repo's testing rules.
