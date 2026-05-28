# AXF

Agent eXoskeleton Framework for workspace-native agent capabilities.

AXF (Agent eXoskeleton Framework) gives teams a framework for building
workspace-native agent exoskeletons: small, self-describing capabilities
that encode how each codebase is built, tested, searched, diagnosed,
and operated safely.

The goal is not to automate judgment. The goal is to compress repeated
local ceremony into reliable workspace capabilities, so agents can spend
more attention on the actual problem.

**When AXF helps**

- agents keep guessing which build, test, or validation command applies
- agents repeatedly search for the same repo facts before editing
- local safety rules live in prose, convention, or human memory
- brittle shell chains keep getting rebuilt for repo-specific chores

**AXF is not**

AXF is not a universal command catalog, a replacement for judgment, or
an MCP-only product. It is the framework and control plane for building
workspace-native agent exoskeletons from workspace-owned capabilities.
MCP is one adapter surface; workspaces own the repo-specific
capabilities agents use as their local exoskeleton.

> Status: **alpha**. The core loop is in place: scout, inspect,
> execute, scaffold, and promote capabilities through one contract.
> Manifest version `axf/v0` is the current alpha contract.

## Install and MCP

### License

AXF is source-available under the custom personal-use license in
[`LICENSE`](LICENSE). It is not open source.

Permitted use is limited to personal, non-commercial evaluation,
development, and local execution.

Redistribution, resale, sublicensing, commercial use, business use,
production use, internal organizational use, SaaS use, managed-service
use, and embedding in another product, service, SDK, platform, agent,
workflow system, or commercial tooling require a separate written
license.

The npm package name is `@smartergpt/axf`. It installs two bins:

- `axf` — the CLI entrypoint, including the stdio MCP launch subcommand `axf mcp`
- `axf-mcp` — the stdio MCP server entrypoint

MCP clients may launch `axf-mcp` directly. For registry-driven or
package-driven launch, prefer `axf mcp` so the package can stay centered
on the base `axf` command surface. Both entrypoints start the same stdio
MCP server. The server exposes exactly one MCP tool named `axf`, and
that tool routes into AXF's existing capability surface for the bound
workspace.

### Global install

```sh
npm install --global @smartergpt/axf
```

Then use either bin directly:

```sh
axf doctor
axf mcp
axf-mcp
```

### Repo-local dev launch

From a local clone, run the bins directly with Node:

```sh
node /path/to/axf/bin/axf.js doctor
node /path/to/axf/bin/axf.js mcp
node /path/to/axf/bin/axf-mcp.js
```

A repo-local MCP configuration can either call the direct MCP bin or the
CLI subcommand. Prefer the CLI subcommand when the client supports
command arguments cleanly:

```json
{
  "mcpServers": {
    "axf": {
      "command": "node",
      "args": ["/path/to/axf/bin/axf.js", "mcp"],
      "cwd": "/path/to/workspace",
      "env": {
        "AXF_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

Direct-bin configs remain valid:

```json
{
  "mcpServers": {
    "axf": {
      "command": "node",
      "args": ["/path/to/axf/bin/axf-mcp.js"],
      "cwd": "/path/to/workspace",
      "env": {
        "AXF_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

### npm / npx launch

Published-package smoke tests must run from a clean directory such as
`/tmp`, not from the AXF repo root. Running from the repo root can let
`npx` or `npm exec` pick up a repo-local or globally installed `axf`
binary instead of the package-installed one.

The registry-friendly launch shape is `axf mcp`, but the direct MCP bin
remains valid for manual configurations. These equivalent forms were
validated locally with the packed tarball:

```sh
npx -y --package @smartergpt/axf axf doctor
npx -y --package @smartergpt/axf axf mcp
npx -y --package @smartergpt/axf axf-mcp

npm exec --yes --package @smartergpt/axf -- axf doctor
npm exec --yes --package @smartergpt/axf -- axf mcp
npm exec --yes --package @smartergpt/axf -- axf-mcp
```

### Windows-native launch

For registry-style Windows MCP configs, prefer the base `axf.cmd`
launcher with `mcp` as an argument:

```json
{
  "mcpServers": {
    "axf": {
      "command": "axf.cmd",
      "args": ["mcp"],
      "cwd": "C:\\src\\my-workspace",
      "env": {
        "AXF_WORKSPACE": "C:\\src\\my-workspace"
      }
    }
  }
}
```

Direct-bin `.cmd` configs are still valid:

```json
{
  "mcpServers": {
    "axf": {
      "command": "axf-mcp.cmd",
      "args": [],
      "cwd": "C:\\src\\my-workspace",
      "env": {
        "AXF_WORKSPACE": "C:\\src\\my-workspace"
      }
    }
  }
}
```

### WSL / Linux launch

For registry-style WSL/Linux MCP configs, prefer the base `axf` command
with `mcp` as the first argument:

```json
{
  "mcpServers": {
    "axf": {
      "command": "axf",
      "args": ["mcp"],
      "cwd": "/home/user/src/my-workspace",
      "env": {
        "AXF_WORKSPACE": "/home/user/src/my-workspace"
      }
    }
  }
}
```

Direct-bin configs remain valid:

```json
{
  "mcpServers": {
    "axf": {
      "command": "axf-mcp",
      "args": [],
      "cwd": "/home/user/src/my-workspace",
      "env": {
        "AXF_WORKSPACE": "/home/user/src/my-workspace"
      }
    }
  }
}
```

### Workspace binding

`axf`, `axf mcp`, and `axf-mcp` find the active workspace in this order:

1. explicit `--workspace`
2. `AXF_WORKSPACE`
3. nearest `axf.workspace.json` from `cwd`
4. nearest `axf.workspace.json` from the installed script location
5. `cwd` fallback

For MCP clients, set both `cwd` and `AXF_WORKSPACE` to the intended
workspace when possible. That makes the exposed command surface
deterministic and keeps workspace-relative execution targets anchored to
the right repo.

From any directory once installed:

```sh
axf doctor
axf list
axf inspect echo say
axf run echo say --message hello
axf scout --check
axf run toy echo say --message hello
axf init capability global.acme.status
```

`axf doctor` reports the workspace source it selected and, under WSL,
warns when `axf`, `lex`, `node`, or `npm` resolve through Windows PATH
entries under `/mnt/c/...`.

### MCP routing and governance

The MCP server exposes one tool named `axf`. Supported operations are:

- `help`
- `list`
- `inspect`
- `run`
- `doctor`
- `scout_check`

Those operations route into AXF's manifest-backed discovery, resolver,
lifecycle, policy, adapter, and executor paths. MCP does not add a
second governance model or a raw shell bypass around AXF.

AXF MCP is intentionally not full CLI parity yet. The CLI remains the
authoritative mutation and control plane for commands such as `init`,
`promote`, `demote`, `scout --write`, and other registry/materialization
flows.

Capabilities such as `global.lex.status` and `global.echo.say` are not
separate MCP tools. Use `operation=help` to learn the router contract,
`operation=list` to discover capabilities, and `operation=inspect`
before `operation=run`. Treat capability
`lifecycleState`, `sideEffects`, `policies`, and workspace binding as
part of the execution contract.

`scout_check` is AXF's MCP-specific read-only structured scout
diagnostics surface. It is not intended to promise literal CLI parity
with `axf scout --check`.

Registry and manifest updates still happen through normal AXF CLI and
filesystem/control-plane flows. The MCP server reloads registry state
per request, so external AXF updates become visible on later MCP calls
without restarting the server.

Full CLI parity may be considered later behind explicit policy and
approval gates.

Lex appears through AXF only when the bound AXF workspace discovers or
mounts Lex capabilities such as `global.lex.*` or `toolspace.ops.lex.*`.

## What's wired up

### Built-in adapters

AXF ships two public built-in adapter types:

- **`internal`** — runs handlers in-process (`adapters/internal/`)
- **`cli`** — generic subprocess dispatcher with stdout JSON parsing
  (`adapters/cli/`)

The standard Lex capability family uses the generic `cli` adapter. It
does not require a dedicated Lex adapter.

### Built-in capabilities

| Capability | Provider | Lifecycle | Notes |
|---|---|---|---|
| `global.echo.say` | internal | active | smallest in-process capability example |
| `global.lex.status` | Lex via cli | active | compact Lex state and health summary |
| `global.lex.recall` | Lex via cli | active | recall frames by query or list recent frames |
| `global.lex.search` | Lex via cli | active | search Lex frames by query |
| `global.lex.policy-check` | Lex via cli | active | validate Lex policy files and optional module mapping |
| `global.lex.remember` | Lex via cli | active | write-classified capture of a work-session frame |
| `global.lex.log-frame` | Lex via cli | active | write-classified alias for frame logging |
| `global.lex.note` | Lex via cli | active | write-classified alias for repo notes |

Lex is a reference capability family routed by AXF. It demonstrates how
workspace-native memory and policy capabilities can sit behind AXF's
resolver, lifecycle, policy, adapter, and executor path without defining
the framework itself.

### Toolspaces

- **`toy`** — smallest mount example; re-mounts `echo.say` with a local default
- **`ops`** — multi-capability mount example for grouped launch surfaces, including the reusable read-only Lex pack

## Repo onboarding

The recommended repo flow is:

1. Add `axf.workspace.json` at the repo root so workspace binding is explicit.
2. Reuse the imported `global.lex.*` family or mount the read-only Lex pack into a toolspace.
3. Add repo-specific capabilities separately under `manifests/capabilities/` or `manifests/families/`.
4. Keep MCP optional; AXF works as a plain CLI capability router without it.
5. Mark mutating capabilities with `sideEffects: "write"`. AXF does not yet have a first-class `approvalRequired` field, so approval gates stay a repo policy or review convention for now.

See [`docs/13-repo-onboarding.md`](docs/13-repo-onboarding.md) for a concrete pattern including Lex mounts and WSL/Windows notes.

## How to add a new provider

The contract is open. Every new provider goes through the same
scaffolders and lifecycle gates:

```sh
# 1. Scaffold a draft provider adapter (only if the provider has an
#    envelope or quirks the generic cli adapter shouldn't carry):
axf init adapter --kind provider acme --composes cli

# 2. Scaffold each capability:
axf init capability global.acme.status

# 3. Edit the drafts, then:
axf doctor
axf run acme status --any-lifecycle
```

The four canonical prompts under [`prompts/`](prompts/) walk an agent
through discovery → planning → scaffolding → review against the actual
file contract. JSON-first providers can usually use the generic `cli`
adapter directly; provider adapters are for wrappers that need envelope,
error, or argument normalization beyond the generic route.

## Layout

```
axf.workspace.json               # workspace marker
bin/axf.js                      # CLI entry (symlinked as /usr/local/bin/axf)
src/cli/                        # CLI parsing + main dispatch
src/core/                       # registry, resolver, executor, adapters, doctor, policy
adapters/<type>/                # type adapters (internal, cli, ...)
adapters/<provider>/            # optional provider adapters for wrapped CLIs
manifests/capabilities/         # capability manifests
manifests/toolspaces/           # toolspace mount manifests
prompts/                        # canonical prompts for agent-authored adapters
docs/                           # architecture, contract, lifecycle, prompts
test/                           # node:test, zero-dep
```

## Reading order

1. [`docs/00-foundation.md`](docs/00-foundation.md) — why axf exists
2. [`docs/01-vocabulary.md`](docs/01-vocabulary.md)
3. [`docs/02-architecture.md`](docs/02-architecture.md)
4. [`docs/03-capabilities-and-manifests.md`](docs/03-capabilities-and-manifests.md)
5. [`docs/04-adapter-contract.md`](docs/04-adapter-contract.md) — the
   two-kind adapter model (type + provider)
6. [`docs/05-lifecycle-and-promotion.md`](docs/05-lifecycle-and-promotion.md)
7. [`docs/06-canonical-prompts.md`](docs/06-canonical-prompts.md)
8. [`docs/07-v0-bootstrap-plan.md`](docs/07-v0-bootstrap-plan.md) —
  alpha implementation milestones
9. [`docs/08-adapter-folder-shape.md`](docs/08-adapter-folder-shape.md)
   — the concrete file contract
10. [`docs/09-launch-plans.md`](docs/09-launch-plans.md) —
    interpreter-aware launch plans, env-bound roots, fallback paths
11. [`docs/10-command-families.md`](docs/10-command-families.md) —
    family imports, public-to-provider arg mapping, materialization,
    drift
12. [`docs/11-normalization-guidance.md`](docs/11-normalization-guidance.md)
    — JSON-first vs text-first providers, when to write a provider
    adapter
13. [`docs/12-layered-docs.md`](docs/12-layered-docs.md) — caller /
    integrator / author paths through the docs
14. [`docs/13-repo-onboarding.md`](docs/13-repo-onboarding.md) —
  workspace markers, standard Lex capabilities, and platform guidance

## Tests

```sh
npm test
```

Zero dependencies. Uses Node's built-in `node:test`.

## What is intentionally **not** here

- a broad command-alias layer
- privileged integration paths
- a plugin marketplace
- mandatory remote execution or MCP support
- agent-generated capabilities that auto-promote
