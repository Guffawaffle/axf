# axf

A manifest-driven capability router and scaffolding framework. axf
provides a small command surface, explicit manifests, adapter-based
execution, lifecycle gates, and schema-validated args for workspace
toolspaces.

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
production use, internal organizational use, employer/client use, SaaS
use, managed-service use, and embedding in another product, service,
SDK, platform, agent, workflow system, or commercial tooling require a
separate written license.

The npm package name is `@smartergpt/axf`. It installs two bins:

- `axf` — the CLI entrypoint
- `axf-mcp` — the stdio MCP server entrypoint

MCP clients should launch `axf-mcp`. The server exposes exactly one MCP
tool named `axf`, and that tool routes into AXF's existing capability
surface for the bound workspace.

### Global install

```sh
npm install --global @smartergpt/axf
```

Then use either bin directly:

```sh
axf doctor
axf-mcp
```

### Repo-local dev launch

From a local clone, run the bins directly with Node:

```sh
node /path/to/ax-framework/bin/axf.js doctor
node /path/to/ax-framework/bin/axf-mcp.js
```

A repo-local MCP configuration looks like this:

```json
{
  "mcpServers": {
    "axf": {
      "command": "node",
      "args": ["/path/to/ax-framework/bin/axf-mcp.js"],
      "cwd": "/path/to/workspace",
      "env": {
        "AXF_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

### npm / npx launch

The published-package launch shape was validated locally with the packed
tarball using these equivalent forms:

```sh
npx -y --package @smartergpt/axf axf doctor
npx -y --package @smartergpt/axf axf-mcp

npm exec --yes --package @smartergpt/axf -- axf doctor
npm exec --yes --package @smartergpt/axf -- axf-mcp
```

### Windows-native launch

For npm-installed Windows shims, use the `.cmd` entrypoints in MCP
configs:

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

Use the native binary and bind the target workspace explicitly:

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

`axf` and `axf-mcp` find the active workspace in this order:

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

- `list`
- `inspect`
- `doctor`
- `scout_check`
- `run`

Those operations route into AXF's manifest-backed discovery, resolver,
lifecycle, policy, adapter, and executor paths. MCP does not add a
second governance model or a raw shell bypass around AXF.

Lex appears through AXF only when the bound AXF workspace discovers or
mounts Lex capabilities such as `global.lex.*` or `toolspace.ops.lex.*`.
## What's wired up

### Built-in adapters

- **`internal`** — runs handlers in-process (`adapters/internal/`)
- **`cli`** — generic subprocess dispatcher with stdout JSON parsing
  (`adapters/cli/`)
- **`majel`** (provider) — the current provider-adapter example layered
  on top of `cli` (`adapters/majel/`)

### Built-in capabilities

| Capability | Provider | Lifecycle | Notes |
|---|---|---|---|
| `global.echo.say` | internal | active | smallest in-process capability example |
| `global.lex.*` | cli | active | imported Lex family pack: status/introspect/recall/search/policy-check plus write-classified remember/log-frame/note |
| `global.majel.status` | cli + majel | active | sample provider-adapter status capability |
| `global.majel.diff` | cli + majel | active | sample provider-adapter diff capability |

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
file contract. The provider-adapter example under
[`adapters/majel/`](adapters/majel/) is intentionally small and useful
as a shape reference.

## Layout

```
axf.workspace.json               # workspace marker
bin/axf.js                      # CLI entry (symlinked as /usr/local/bin/axf)
src/cli/                        # CLI parsing + main dispatch
src/core/                       # registry, resolver, executor, adapters, doctor, policy
adapters/<type>/                # type adapters (internal, cli, ...)
adapters/<provider>/            # provider adapters (majel, ...)
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
