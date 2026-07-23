# AXF

**Fit the repository once. Let every agent follow the same paved path.**

An agent can read your code. It still has to rediscover how this repository
wants to be built, tested, searched, diagnosed, and operated. The clues are
usually scattered across scripts, package tasks, prose, CI, and human memory.

AXF (Agent eXoskeleton Framework) turns that repeated local ceremony into
small, self-describing capabilities. Fit the exoskeleton deliberately once;
later agents can discover the right route, inspect its contract, and run it
without rebuilding the procedure from scratch.

```text
recurring repository ceremony
          ↓ fit once
inspectable AXF capabilities
          ↓ reuse
agent discovers → inspects → runs
```

AXF is a traffic cop, not a replacement vocabulary. It preserves a provider's
existing command family by default, then projects or normalizes only the parts
that need a clearer agent-facing contract. The goal is not to automate
judgment. It is to spend less judgment on reconstructing the same route.

## The five caller concepts

You do not need the framework vocabulary to use a fitted repository:

- **Workspace** — the repository context whose operating paths you need. In
  root-sensitive contracts, AXF distinguishes the project root used for
  discovery from the execution root used as the runtime working directory.
- **Module** — a reusable capability pack, such as the built-in `echo` module
  or a repository-owned validation pack.
- **Capability** — one named operation with declared arguments, output modes,
  side effects, lifecycle, policies, and an execution target.
- **Inspect** — read the complete contract before execution.
- **Run** — execute through that contract after checking its effects and
  authority requirements.

The smallest proof of life is:

```sh
npm install --global @smartergpt/axf
axf doctor
axf list --compact
axf inspect echo say
axf run echo say --message hello
```

The package is source-available and subject to the license terms below. A
fitted repository normally adds its own capabilities; `echo.say` only proves
that the registry, resolver, adapter, and executor are connected.

## Before and after fitting

Before AXF, a new agent searches multiple instruction files, reverse-engineers
package scripts, guesses the safe validation subset, and repeats that work in
the next session.

After a deliberate fit, the repository can expose stable entries such as
`context`, `check`, and `handoff`. A caller starts with `axf guide`, inspects
the selected capability, and runs the repository-owned route. AXF makes the
route visible; the repository still owns it.

## Is this repository a fit?

AXF helps when:

- agents repeatedly guess which build, test, or validation command applies;
- the same repository facts must be rediscovered before editing;
- local safety rules live in scattered prose, convention, or human memory;
- brittle shell chains keep being rebuilt for repo-specific chores.

AXF is probably not a fit when one obvious command already covers the work,
the ceremony is unlikely to recur, or the provider surface changes faster than
the team can maintain a capability contract.

The adoption question is:

> Does this repository have repeated local operating ceremony that is worth
> fitting once into stable, inspectable agent capabilities?

For a bounded, strictly read-only assessment, give an agent this prompt:

```text
Evaluate whether this repository is a fit for AXF by following
docs/agent-evaluation.md. Do not install AXF, edit files, scaffold or promote
capabilities, invoke MCP tools, or run repository code. Inspect only the
existing scripts, package tasks, documentation, agent instructions, CI and
platform/runtime constraints. Identify repeated mistakes and existing overlap,
then return exactly one verdict: adopt, pilot, defer, or not a fit. Include the
evidence, expected fitting cost, ongoing drift cost, authority boundaries, and
the smallest reversible pilot. Do not perform the pilot without separate
approval.
```

See [Agent fit evaluation](docs/agent-evaluation.md) for the evidence checklist,
verdict definitions, and response template.

## Choose your path

| You are... | Start here | Your job |
|---|---|---|
| A caller or coding agent | [Caller guide](docs/callers.md) | Discover, inspect, and run capabilities someone else fitted. |
| An integration author | [Integration author guide](docs/integration-authors.md) | Fit existing repository or provider ceremony into stable capabilities. |
| An AXF framework author | [Framework author guide](docs/framework-authors.md) | Change loaders, resolution, adapters, policy, MCP, or other AXF internals. |

Stop at the caller guide unless you are responsible for fitting a provider or
changing AXF itself. The complete audience map is in
[Documentation layers](docs/12-layered-docs.md).

> Status: **alpha**. The core loop is in place: scout, inspect, execute,
> scaffold, and promote capabilities through one contract. Manifest version
> `axf/v0` is the current alpha contract.

## What AXF is not

AXF is not a universal command catalog, a source of authorization, a
replacement for provider identity, a substitute for review, or an MCP-only
product. MCP is one agent-facing surface over the same registry and execution
path.

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
reopen Codex afterward. For one-call AXF + Lex bootstrap, including the
explicit `off | shadow` KnowledgeFrame provider rollout, see the packaged
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
`responseDetail: "compact"`: the deterministic minimum safe envelope with
capability data, actionable errors, warnings, and required safety state.
Request `responseDetail: "standard"` for an expanded canonical result or
`responseDetail: "diagnostic"` explicitly when investigating provenance,
workspace binding, or launch behavior. Invocation traces stay out of normal
success and failure results. Diagnostic framework metadata is redacted for
sensitive field names and values. Response detail never truncates, redacts, or
otherwise transforms capability-owned `data`.

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
controls the surrounding agent-facing response envelope. A default compact
MCP `list` response is independently bounded to 25 results when `limit` is
omitted; this does not enable the list item `compact` option. Supply an
explicit `limit` to replace that bound, or explicitly request `standard` or
`diagnostic` without a limit to opt out of the default bound.

AXF 2.0 changes the implicit MCP response from the pre-2.0 rich envelope to
`compact`. Callers that consume provenance or launch metadata must request
`diagnostic`; callers that need the expanded result without invocation traces
can request `standard`.

AXF project and execution roots are filesystem discovery/execution bindings,
not tenant, repository, workspace, grant, or authorization evidence. Ambient
root environment variables remain compatibility/configuration inputs only;
AXF never treats them as authority. Security-sensitive hosts should pass roots
explicitly and authorize the operation before invoking AXF. Provider-owned
identity and authorization stay with the provider; AXF does not require Lex or
reconstruct Lex authority.

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
- `guide`
- `list`
- `explain`
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

The contract is open. First decide whether the provider needs a command family,
a selective materialized override, or a provider adapter. The
[Integration author guide](docs/integration-authors.md) contains that decision
path. A provider adapter is only needed when the generic CLI route cannot
express the provider's argument, envelope, failure, or output contract.

When a provider adapter is justified, the scaffold starts in `draft`:

```sh
# 1. Scaffold a draft provider adapter (only if the provider has an
#    envelope or quirks the generic cli adapter shouldn't carry):
axf init adapter --kind provider acme --composes cli

# 2. Scaffold each capability:
axf init capability global.acme.status

# 3. Edit the drafts, then:
axf doctor
axf inspect global.acme.status --json
```

The four canonical prompts under [`prompts/`](prompts/) walk an agent
through discovery → planning → scaffolding → review against the actual
file contract. JSON-first providers can usually use the generic `cli`
adapter directly; provider adapters are for wrappers that need envelope,
error, or argument normalization beyond the generic route.

Running a non-active capability requires an explicit lifecycle opt-in and can
still execute real provider effects. Do that only after inspection and the
repository's normal approval process. Lifecycle changes validate manifests;
they do not perform the review.

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

## Documentation

Start with the path for your current job:

- [Caller guide](docs/callers.md) — discover, inspect, and run fitted
  capabilities.
- [Integration author guide](docs/integration-authors.md) — fit recurring
  repository or provider ceremony while preserving provider vocabulary.
- [Framework author guide](docs/framework-authors.md) — change AXF internals
  and cross-surface contracts.

[Documentation paths](docs/12-layered-docs.md) routes each audience to the
relevant reference documents. Use the
[read-only agent fit evaluation](docs/agent-evaluation.md) before onboarding an
undecided repository.

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
