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

This repository is **source-available**, not open source.

You may view, fork, modify, and run this project for personal,
non-commercial use under the [SmarterGPT Source-Available Personal Use
License](./LICENSE.md).

Commercial use, organizational use, employer/client use, production use,
hosted-service use, redistribution, sublicensing, or embedding in another
product or platform requires a separate written license from Joseph Gustavson /
Guffawaffle / SmarterGPT.

Public visibility on GitHub does not grant open-source rights or
business-use rights.

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

Audit a Codex MCP package pin before assuming the configured server matches the
installed CLI:

```sh
axf integrate codex --check
axf integrate codex --write
axf integrate codex --check --smoke
```

Writes are scoped to the AXF package spec in Codex `config.toml`; restart or
reopen Codex afterward. For one-call AXF + Lex bootstrap, see the packaged
`templates/session-context` workspace recipe and
[`docs/13-repo-onboarding.md`](docs/13-repo-onboarding.md).

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
      "cwd": "/path/to/project",
      "env": {
        "AXF_PROJECT_ROOT": "/path/to/project",
        "AXF_EXECUTION_ROOT": "/path/to/project"
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
      "cwd": "/path/to/project",
      "env": {
        "AXF_PROJECT_ROOT": "/path/to/project",
        "AXF_EXECUTION_ROOT": "/path/to/project"
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
remains valid for manual configurations. These equivalent package-driven
forms use the published npm package:

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
      "cwd": "C:\\src\\my-project",
      "env": {
        "AXF_PROJECT_ROOT": "C:\\src\\my-project",
        "AXF_EXECUTION_ROOT": "C:\\src\\my-project"
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
      "cwd": "C:\\src\\my-project",
      "env": {
        "AXF_PROJECT_ROOT": "C:\\src\\my-project",
        "AXF_EXECUTION_ROOT": "C:\\src\\my-project"
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
      "cwd": "/home/user/src/my-project",
      "env": {
        "AXF_PROJECT_ROOT": "/home/user/src/my-project",
        "AXF_EXECUTION_ROOT": "/home/user/src/my-project"
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
      "cwd": "/home/user/src/my-project",
      "env": {
        "AXF_PROJECT_ROOT": "/home/user/src/my-project",
        "AXF_EXECUTION_ROOT": "/home/user/src/my-project"
      }
    }
  }
}
```

WSL users should use a native WSL AXF install on `PATH`, not Windows npm
shims or npm's `_npx` cache. Optional shared packs that launch native
CLIs should follow the same rule: prefer Linux-native tools earlier on
PATH and avoid crossing into Windows shims from WSL.

### Root binding

`axf`, `axf mcp`, and `axf-mcp` resolve the active project root and
execution root in this order:

1. explicit `--project-root` and `--execution-root`
2. `AXF_PROJECT_ROOT` and `AXF_EXECUTION_ROOT`
3. legacy CLI aliases: `--workspace`, `--registry-workspace`, `--execution-workspace`
4. legacy environment aliases: `AXF_WORKSPACE`, `AXF_REGISTRY_WORKSPACE`, `AXF_EXECUTION_WORKSPACE`
5. nearest `axf.workspace.json` from `cwd`
6. nearest `axf.workspace.json` from the installed script location
7. `cwd` fallback

For `axf run`, unprefixed root flags are global only before the subcommand;
after `run` they are capability-owned. Non-run commands retain their legacy
placement because they have no downstream argument owner. The
`--axf-project-root`, `--axf-execution-root`, and `--axf-workspace`
spellings are accepted later in the AXF-controlled portion of a command.
After an `axf run ... --` boundary, root-like names belong to the capability.

### Run argument ownership

AXF reserves the `--axf-*` namespace for framework controls and leaves
natural public argument names to capabilities. Use an explicit boundary
when the ownership should be visible in the command itself:

```sh
axf --project-root /repo run global.logs.query \
  --axf-json --axf-any-lifecycle -- \
  --json --limit 20 --workspace downstream-name
```

Options before `--` are AXF run controls. Options after `--` are public
capability arguments: AXF still parses them, validates and coerces them with
`argsSchema`, maps them through `argMap`, and executes them through the
declared adapter. The boundary never enables raw or schema-bypassing argv.
The same name may appear on both sides with different ownership, but a
duplicate within either explicit section is rejected.

Existing no-boundary invocations such as `axf run echo say --message hello`
remain supported. In that compatibility form, legacy `--json`,
`--any-lifecycle`, and `--allow-draft` remain AXF controls unless the
capability explicitly declares the same argument. Use `--axf-json` and
`--axf-any-lifecycle` when AXF ownership must be unambiguous.

### Agent-first discovery

Start with the bounded workspace guide instead of requesting every full
manifest:

```sh
axf guide
axf guide context --json
axf list --compact --search lex --limit 20 --json
axf explain global.lex
axf inspect global.lex.status --json
```

The MCP router exposes the same `guide`, compact/search `list`, `explain`, and
`inspect` results. `guide` returns workspace- or family-declared context,
validation, and handoff entrypoints without executing them. Compact list
entries retain lifecycle, side effects, and source provenance while omitting
full schemas and execution targets until `inspect`.

AI agents are the primary consumer of MCP results, so AXF defaults to
`responseDetail: "standard"`: capability data and safety-relevant fields stay
intact while compatibility-only workspace aliases, echoed run input, empty
metadata, and successful invocation traces are omitted. Request
`responseDetail: "compact"` for the smallest safe result or
`responseDetail: "diagnostic"` when investigating provenance, workspace
binding, or launch behavior. Response detail never truncates or transforms a
capability's `data`.

```json
{
  "operation": "run",
  "responseDetail": "compact",
  "target": { "id": "global.lex.status" },
  "args": {}
}
```

The `compact` list option and `responseDetail` are intentionally separate:
`compact` selects summarized capability entries, while `responseDetail`
controls the surrounding agent-facing response envelope.

See [Agent Discovery and Workflow Guide](docs/15-agent-discovery-and-workflow-guide.md)
for recommendation declarations, missing-capability diagnostics, and CLI/MCP
examples.

When discovery and execution should use the same repo, set both
`AXF_PROJECT_ROOT` and `AXF_EXECUTION_ROOT` to the same path. When they
should differ, set them independently. Legacy `AXF_WORKSPACE` remains a
compatibility alias that binds both roots to one path.

For MCP clients, set `cwd` to the intended caller execution directory and
set `AXF_PROJECT_ROOT` / `AXF_EXECUTION_ROOT` explicitly when possible.
That keeps manifest discovery and caller-facing execution deterministic.

Set `AXF_MACHINE_ROOT` when you want a user- or machine-scoped AXF root
to contribute optional shared packs across projects. Project-root
families shadow machine-level families with the same family name.

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

Capabilities such as `global.echo.say` are not
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

Shared packs appear through AXF only when the bound AXF project root or
machine layer discovers or mounts those capabilities.

## What's wired up

### Built-in adapters

AXF ships two public built-in adapter types:

- **`internal`** — runs handlers in-process (`adapters/internal/`)
- **`cli`** — generic subprocess dispatcher with stdout JSON parsing
  (`adapters/cli/`)

Shared command families use the same adapter contract as project-owned
capabilities. A shared pack can use the generic `cli` adapter, a
provider adapter, or an internal handler, but AXF core does not require
that pack as a runtime dependency.

### Built-in capabilities

| Capability | Provider | Lifecycle | Notes |
|---|---|---|---|
| `global.echo.say` | internal | active | smallest in-process capability example |

Optional shared packs, including a Lex pack, can be added at machine or
project scope. They route through the same resolver, lifecycle, policy,
adapter, and executor path without defining the framework itself.

### Toolspaces

- **`toy`** — smallest mount example; re-mounts `echo.say` with a local default

## Repo onboarding

The recommended repo flow is:

1. Add `axf.workspace.json` at the repo root so workspace binding is explicit.
2. Add shared packs intentionally at machine or project scope when a repo wants them.
3. Add repo-specific capabilities separately under `manifests/capabilities/` or `manifests/families/`.
4. Keep MCP optional; AXF works as a plain CLI capability router without it.
5. Mark mutating capabilities with `sideEffects: "write"`. AXF does not yet have a first-class `approvalRequired` field, so approval gates stay a repo policy or review convention for now.

See [`docs/13-repo-onboarding.md`](docs/13-repo-onboarding.md) for the concrete onboarding pattern and platform notes.

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
axf run acme status --axf-any-lifecycle
```

The four canonical prompts under [`prompts/`](prompts/) walk an agent
through discovery → planning → scaffolding → review against the actual
file contract. JSON-first providers can usually use the generic `cli`
adapter directly; provider adapters are for wrappers that need envelope,
error, or argument normalization beyond the generic route.

## Layout

```
axf.workspace.json               # workspace marker
bin/axf.js                      # CLI entrypoint
src/cli/                        # CLI parsing + main dispatch
src/core/                       # registry, resolver, executor, adapters, doctor, policy
adapters/<type>/                # type adapters (internal, cli, ...)
adapters/<provider>/            # optional provider adapters for wrapped CLIs
manifests/capabilities/         # capability manifests
manifests/toolspaces/           # toolspace mount manifests
prompts/                        # canonical prompts for agent-authored adapters
docs/                           # architecture, contract, lifecycle, prompts
test/                           # node:test suite
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
  workspace markers, shared packs, and platform guidance
15. [`docs/14-family-identity-and-layer-precedence-plan.md`](docs/14-family-identity-and-layer-precedence-plan.md) —
  family identity, layer precedence, and optional shared-pack direction

## Tests

```sh
npm test
```

Uses Node's built-in `node:test`; no external test runner is required.

## What is intentionally **not** here

- a broad command-alias layer
- privileged integration paths
- a plugin marketplace
- mandatory remote execution or MCP support
- agent-generated capabilities that auto-promote
