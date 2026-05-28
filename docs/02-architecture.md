# AXF Architecture Overview

## Architecture statement

AXF should be built as a small platform with clear layers.

The layers are:

1. CLI surface
2. resolver
3. manifest registry
4. adapter execution layer
5. lifecycle and policy gates
6. optional provider integrations

## High-level shape

```text
axf CLI
  -> parser
  -> resolver
  -> registry
  -> adapter binding
  -> executor
  -> normalized result
```

## CLI and MCP surfaces

The CLI remains AXF's full control plane.

That includes lifecycle and registry mutation commands such as
`init`, `promote`, `demote`, and `scout --write`.

The MCP server is a separate, agent-safe router over the current AXF
registry. It is intentionally a safe subset, not full CLI parity.

Current MCP scope:

- `help`
- `list`
- `inspect`
- `run`
- `doctor`
- `scout_check`

Capabilities such as `global.lex.status` and `global.stfc-mod.status`
remain registry entries discovered through the single MCP tool `axf`.
They are not separate MCP tools.

Registry/manifests still change through normal AXF CLI or filesystem
flows. MCP reloads registry state per request so external AXF updates
become visible without a dedicated MCP refresh command.

Full CLI parity can be considered later, but only behind explicit
policy and approval gates.

## Command grammar

Conceptual grammar:

`axf <toolspace?> <module> <capability> [args...]`

Examples:

- `axf echo say`
- `axf toy echo say`
- `axf acme status`

Important: the CLI path is not the execution target.
It is a lookup path.

## Global vs mounted distinction

### `axf echo ...`

This means:
- use the global `echo` module exposed through AXF
- no toolspace-local mount is assumed
- global defaults and policies apply

### `axf toy echo ...`

This means:
- enter the `toy` toolspace
- use the `echo` mount declared there
- apply `toy` scope, defaults, policies, and restrictions

These are not equivalent by definition.

Even if the first implementation proxies one through the other, AXF should preserve the distinction internally.

## Resolution order

Preferred conceptual order:

1. workspace-local *(implemented; resolves `workspace.<module>.<cap>` and is reachable via shorthand `axf run <module> <cap>` when no global match exists)*
2. toolspace-local
3. global

This allows toolspaces and workspaces to narrow or override broader behavior in predictable ways.

## Why axf owns the mount model

Mounted modules should be resolved by AXF through declared manifests and adapter bindings.

Providers do not need to implement AXF-specific hooks unless they want richer native integration.

This keeps AXF open without making every provider responsible for AXF internals.

## Provider integration stance

AXF should support multiple adapter styles:

- `internal`
- `cli`
- `library`
- future: `rpc` or `mcp`

For v0, `internal` and `cli` are enough.

## Recommended top-level repo shape

```text
axf/
  README.md
  docs/
  prompts/
  schemas/
  examples/
  src/
    cli/
    parser/
    resolver/
    registry/
    adapters/
    execution/
    manifests/
    lifecycle/
    policy/
```

## Suggested first implementation targets

Keep the framework small.

Minimum useful commands:

- `axf list`
- `axf inspect <id>`
- `axf run <id>`
- `axf init toolspace`
- `axf init capability`
- `axf doctor`

Do not start by broadening the CLI surface before the core loop is solid.
