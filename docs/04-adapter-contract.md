# AXF Adapter Contract

> Status: alpha — the two adapter kinds below are both implemented and
> exercised by built-in and provider-wrapped examples. v0.1 may tighten
> field names; it will not change the two-kind shape.

## Goal

An AXF adapter bridges a provider into AXF's capability model.

The provider may be:

- a built-in AXF implementation (a function in this repo)
- a CLI tool
- a library
- later: an RPC or MCP surface

The adapter is owned by AXF's integration model. **A provider does not
need to implement AXF-specific hooks.** AXF adapts to the provider, never
the reverse.

## Two adapter kinds

AXF recognizes two complementary kinds of adapter folder. They live
side-by-side under `adapters/`. The loader keys them differently and
the executor composes them when both are involved.

### Type adapter — generic dispatcher per `adapterType`

One folder per execution channel. Today: `internal`, `cli`. Each type
adapter knows how to run any capability that declares
`adapterType: <type>`. Capability-specific behavior comes from each
capability's `executionTarget`, not from the adapter.

```text
adapters/
  internal/
    adapter.manifest.json       # { kind: "type-adapter", type: "internal" }
    index.js                    # exports async execute(resolved)
    handlers/                   # internal-only registry of named handlers
  cli/
    adapter.manifest.json       # { kind: "type-adapter", type: "cli" }
    index.js                    # spawns executionTarget.command, parses stdout
```

### Provider adapter — capability-specific wrapper composed over a type adapter

One folder per provider when the provider has quirks the generic type
adapter shouldn't carry: a non-standard envelope, idiosyncratic error
conventions, args-to-flags translation that differs from the generic
rule. A provider adapter declares the type it `composes`, and the
executor calls it with a context that exposes the underlying type
adapter so the provider can pre-process, delegate, post-process, or
all three.

```text
adapters/
  wrapped-cli/
    adapter.manifest.json       # { kind: "provider", name: "wrapped-cli", composes: "cli" }
    index.js                    # exports async execute(resolved, ctx)
```

A capability opts in by declaring `providerAdapter: "<name>"` alongside
its `adapterType`. Without that field, the type adapter handles
execution directly.

## Capability execution flow

```
capability manifest
  ├── adapterType:      "<type>"        // required, picks the type adapter
  └── providerAdapter:  "<name>"?       // optional, picks a provider wrapper

executor
  1. lookup type adapter by adapterType   (must exist)
  2. lookup provider adapter by providerAdapter (if set)
  3. assert provider.composes === adapterType
  4. evaluate policies (warnings ride along; errors short-circuit)
  5. call (provider ?? typeAdapter).execute(resolved, ctx)
     where ctx = { types, typeAdapter }
  6. attach providerAdapter + policyWarnings to result.meta
```

## Result shape (the only contract every adapter must honor)

```js
// success
{ ok: true,  data: <any>,  meta: { capabilityId, adapterType, ...} }

// failure
{ ok: false, error: { message: "..." }, meta: { capabilityId, adapterType, ...} }
```

`meta` is the place to put adapter-specific telemetry (durations, raw
envelopes, hints). The framework attaches `providerAdapter` and
`policyWarnings` itself; everything else is up to the adapter.

## Adapter responsibilities

Every adapter must answer:

1. Which capabilities does it serve? (type adapter: any with matching
   `adapterType`; provider: any with matching `providerAdapter`.)
2. How is execution performed?
3. How are args translated to the provider's calling convention?
4. How are outputs normalized into the axf result shape above?
5. What defaults or policies can AXF inject safely?

## Worked examples in this repo

| Provider | Type adapter | Provider adapter | Why |
|---|---|---|---|
| `global.echo.say` | `internal` | none | smallest in-process capability |
| `global.lex.status` | `cli` | none | sample CLI-backed read capability from the imported Lex family |
| `global.lex.remember` | `cli` | none | sample CLI-backed write capability with visible `sideEffects: "write"` |
| `global.majel.status` | `cli` | `majel` | sample provider-adapter capability with envelope normalization |

The provider-adapter example under [`adapters/majel/index.js`](../adapters/majel/index.js)
shows the envelope-translation pattern in its smallest useful form.

## Toolspace-private adapters

Both adapter kinds may also live **privately under a single toolspace**
rather than globally. The loader walks `toolspaces/<toolspace>/adapters/`
in addition to `adapters/`. Toolspace-private adapters are visible only
to capabilities mounted under their toolspace; they take precedence over
any same-named global adapter when that toolspace is in play.

```text
toolspaces/<toolspace>/
  adapters/
    <type>/                     # private type-adapter
      adapter.manifest.json
      index.js
    <name>/                     # private provider adapter
      adapter.manifest.json
      index.js
```

Resolution order, per `(adapterType, providerAdapter)` lookup:

1. If the resolved capability is mounted, try `toolspaces/<ts>/adapters/`.
2. Fall back to the global `adapters/`.
3. Otherwise the executor errors with the search paths it tried.

`workspace-local` capabilities have no mount and therefore only ever
resolve global adapters. Cross-toolspace reuse is not a goal: each
toolspace's private adapters are isolated.

`axf doctor` warns when:

- a `toolspaces/<ts>/adapters/` tree exists but no toolspace mount
  declares `<ts>` (orphaned dir);
- a private adapter shadows a same-named global one (so the override
  is intentional, not silent).

Use `axf init adapter --toolspace <ts> <name>` to scaffold a private
adapter directly into the right path.

## When to reach for a provider adapter

Use a provider adapter when **any** of these is true:

- The provider's stdout has a wrapper envelope you don't want every
  caller to unwrap.
- The provider conveys success/failure outside the process exit code.
- Args need transformation the generic CLI rule (`--key value`)
  doesn't capture (positional args, stdin payloads, config files).
- The provider has hints / suggestions / next-step hooks worth
  surfacing on `result.meta`.

Otherwise the generic type adapter is enough. Default to "no provider
adapter" until pain proves otherwise.

## Lifecycle

Adapters ship with `lifecycleState: "draft" | "reviewed" | "active"`.
`axf doctor` reports adapter load issues; promotion is deliberate. There
is no implicit promotion when an adapter "works once."

## Agent-assisted adapter work

`axf init adapter <type>` and `axf init adapter --kind provider <name>`
both scaffold a draft adapter against this contract. Agents are
encouraged to drive the planning and scaffolding loop using the
prompts under [`prompts/`](../prompts/). The contract is open on
purpose: any agent that follows it can ship an adapter without privileged
knowledge of AXF framework internals.
