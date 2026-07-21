# Integration author guide

This path is for the person fitting a repository's recurring operating
ceremony into AXF. The desired result is not a second command system. It is a
stable, inspectable route to the provider commands the repository already
trusts.

## Start with the ceremony

Name the repeated caller problem before choosing a manifest shape:

```text
agents repeatedly reconstruct a route
              ↓
identify the provider command of record
              ↓
declare the smallest stable capability contract
              ↓
inspect, review, and expose deliberately
```

Examples include selecting the correct validation subset, establishing session
context, producing a handoff, or running a platform-specific diagnostic.

If you have not established that the ceremony recurs, begin with the
[read-only fit evaluation](agent-evaluation.md). Do not scaffold during that
evaluation.

## Be the traffic cop

Preserve provider vocabulary by default:

- Use a **command family** when a provider already has a coherent command
  family worth exposing.
- Use the generic **`cli` type adapter** when normal exit codes, JSON or text
  output, and ordinary argument mapping are enough.
- **Materialize one command** only when that command needs project-owned
  defaults, a narrower schema, a different launcher, or another selective
  override.
- Add a **provider adapter** only when the provider needs semantic envelope,
  error, output, or argument normalization that the generic CLI route cannot
  express.
- Create a new, project-specific capability when the repository is composing a
  genuine workflow rather than renaming a provider command.

Avoid translating a complete provider vocabulary into AXF-flavored synonyms.
Stable public names are useful where they reduce ambiguity; wholesale renaming
adds drift and hides the system operators already know.

## Choose the integration shape

| Provider shape | AXF shape | Why |
|---|---|---|
| Existing CLI family with stable commands | Family manifest | Import the vocabulary once and synthesize capabilities. |
| Reusable module needs toolspace-local defaults or policy | Toolspace mount | Reuse the source while narrowing its local surface. |
| One family command needs local behavior | Materialized capability | Override only that command; retain its source-family link. |
| JSON-first CLI with reliable exit codes | Generic `cli` adapter | Pass structured data through without custom code. |
| Human-only text output | Generic `cli` adapter | Keep the string when the text is the intended result. |
| Text/envelope consumed programmatically | Provider adapter composing `cli` | Normalize a stable result or failure contract. |
| Repository workflow combining several steps | Project/workspace capability | Give the recurring intent one inspectable contract. |

## Fit a command family

Family manifests live at `manifests/families/<name>.family.json`. Each command
is synthesized into a capability and retains its family provenance.

```json
{
  "manifestVersion": "axf/v0",
  "family": "acme",
  "scope": "global",
  "provider": "acme",
  "adapterType": "cli",
  "executionTarget": { "command": "acme" },
  "providerArgStyle": "double-dash-kebab",
  "lifecycleState": "draft",
  "owner": "repo-platform",
  "commands": {
    "status": {
      "summary": "Show Acme status",
      "executionTarget": { "command": "acme", "args": ["status"] },
      "args": {
        "json": { "type": "boolean", "providerFlag": "--json" }
      },
      "sideEffects": "read"
    }
  }
}
```

Then inspect the synthesized route:

```sh
axf doctor
axf inspect global.acme.status --json
```

The family name is semantic identity. Project families shadow same-name
machine families, which shadow framework built-ins. Shadowing replaces a whole
family; materialize a single command for a selective override.

## Mount without cloning

A mount attaches a reusable module to a toolspace. Use it when one domain needs
a selected subset, local defaults, or additional policies without redefining
the provider or copying its capabilities:

```json
{
  "manifestVersion": "axf/v0",
  "toolspace": "ops",
  "lifecycleState": "draft",
  "moduleMounts": {
    "acme": {
      "source": "global.acme",
      "mode": "proxy",
      "capabilities": ["status"],
      "defaults": { "json": true },
      "policies": ["require_workspace_binding"]
    }
  }
}
```

The source capability remains authoritative. The mount adds toolspace-local
resolution, defaults, and policy. Inspect the mounted ID separately because it
is intentionally not equivalent to the global route.

## Execution plans and arguments

For CLI capabilities, `executionTarget` can name a command on `PATH`, a target
path with a launcher, an environment-bound target with a fallback, and an
explicit working directory. `axf inspect` shows the resolved `launchPlan`; the
executor consumes that same plan.

Public arguments are capability API. Map them to provider flags with per-arg
`providerFlag`, family `argMap`, or `providerArgStyle`. AXF reserves the
`axf-` public prefix for framework controls. The CLI `--` separator makes
ownership visible but never produces raw, schema-bypassing provider arguments.

Read [Launch plans](09-launch-plans.md) and
[Command families](10-command-families.md) before relying on platform-specific
launch behavior or argument derivation.

## Materialization and lifecycle

```sh
axf init materialize acme status
```

Materialization writes a standalone capability that shadows the imported
command. It inherits the command's declared lifecycle when present; otherwise
it defaults to `draft`. Therefore materializing an `active` family command can
produce an immediately active override. Demote it before experimental edits if
needed:

```sh
axf demote global.acme.status --to draft
```

After editing, inspect the manifest and launch plan, run the relevant review
and validation process, and only then change its lifecycle deliberately.
`axf promote` rewrites the lifecycle field and validates the manifest shape.
It does not run tests, establish provider authorization, or prove human review.

```sh
axf doctor
axf inspect global.acme.status --json
axf promote global.acme.status --to reviewed
axf promote global.acme.status --to active
```

The CLI permits direct lifecycle targets; the staged sequence above is a review
practice, not an automated gate. See
[Lifecycle and promotion](05-lifecycle-and-promotion.md).

## Normalization and drift

Prefer JSON pass-through. Keep human-oriented text as text. Normalize only
when callers need a stable programmatic `data` shape or the provider has a
different success/error contract. See
[Normalization guidance](11-normalization-guidance.md).

Materialized commands can drift when the source family changes. `axf doctor`
reports missing sources, argument additions/removals, flag changes, and
execution-target changes. Assign an owner and a review trigger; materialization
without drift ownership is not a stable fit.

## Mutation and authority boundaries

Scaffolding, materialization, lifecycle changes, `scout --write`, and
`integrate codex --write` mutate state. Keep them outside read-only evaluation
and request explicit approval for the intended scope.

AXF manifests describe routing and policy inputs. They do not grant provider
permissions. Project and execution roots bind filesystem locations, not
identity or authorization. Preserve provider authentication and let the host
or repository policy decide whether an invocation is allowed.

For the concrete repository layout, continue to
[Repo onboarding](13-repo-onboarding.md). For adapter code and folder contracts,
continue to [Adapter contract](04-adapter-contract.md) and
[Adapter folder shape](08-adapter-folder-shape.md).
