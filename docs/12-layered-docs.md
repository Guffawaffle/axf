# Documentation Layers

AXF documentation is split into three audiences. Read only what you need.

## Caller — uses capabilities someone else defined

You want to discover what's available in a workspace and run things.
You do not author manifests or adapters.

Read in this order:

1. [README.md](../README.md) — install + first run
2. [01-vocabulary.md](01-vocabulary.md) — workspace, module, capability
3. The four caller commands:
   - `axf doctor`
   - `axf list`
   - `axf inspect <id-or-path>`
   - `axf run <id-or-path>`

That is the entire caller surface. Stop here unless you are integrating
a provider or building the framework itself.

## Integrator — wires a provider into a workspace

You bring a provider's command vocabulary (git, gh, kubectl, your
own CLI) into AXF so other people can call it through a single
contract.

Read in this order:

1. [02-architecture.md](02-architecture.md) — registry → resolver →
   adapter loader → executor
2. [03-capabilities-and-manifests.md](03-capabilities-and-manifests.md)
   — capability manifest fields
3. [04-adapter-contract.md](04-adapter-contract.md) — type vs provider
   adapters
4. [09-launch-plans.md](09-launch-plans.md) — interpreter-aware launch
   plans, env-bound roots, fallback paths
5. [10-command-families.md](10-command-families.md) — family imports,
   public-to-provider arg mapping, materialization, drift
6. [11-normalization-guidance.md](11-normalization-guidance.md) —
   JSON-first vs text-first providers, when to write a provider adapter
7. [05-lifecycle-and-promotion.md](05-lifecycle-and-promotion.md) —
   draft → reviewed → active

Integrator workflow:

```text
import → inspect → refine → materialize (only what you must) → promote
```

## Author — extends the framework itself

You add or change framework internals (loaders, validators, type
adapters that ship with AXF, drift detectors).

Read in this order:

1. [00-foundation.md](00-foundation.md) — why axf exists at all
2. [02-architecture.md](02-architecture.md) — full picture
3. [04-adapter-contract.md](04-adapter-contract.md) — both kinds
4. [08-adapter-folder-shape.md](08-adapter-folder-shape.md)
5. [07-v0-bootstrap-plan.md](07-v0-bootstrap-plan.md)
6. Source: `src/core/`, `adapters/`, `test/`

Adopt the existing test style (`node:test`, zero deps, real tmp
workspaces) for any new feature.
