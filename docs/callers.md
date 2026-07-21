# Caller guide

This path is for a person or agent using capabilities that a repository or
integration author has already fitted. You do not need to understand adapters,
family manifests, materialization, or framework internals.

## The caller loop

```text
guide → discover if needed → inspect → decide → run
```

Start with the repository's bounded workflow recommendations:

```sh
axf doctor
axf guide
axf guide context --json
```

`doctor` reports discovery and configuration health. `guide` returns declared
session-start, validation, and handoff entrypoints without executing them.

If the guide does not contain the route you need, search the registry without
loading every full manifest:

```sh
axf list --compact --search test --limit 20 --json
axf explain workspace.repo.check --json
```

Use `explain` when an expected capability is missing. It distinguishes a
missing command from lifecycle filtering, a family prefix, a load failure, or
a workspace-binding condition.

## Inspect before run

```sh
axf inspect workspace.repo.check --json
axf run workspace.repo.check
```

Before running, inspect at least:

- `lifecycleState` — whether the capability appears in the normal surface;
- `sideEffects` — the declared effect category;
- `policies` — runtime conditions AXF will enforce;
- `argsSchema` and `argMap` — public inputs and provider spellings;
- `launchPlan` — command, arguments, target, and working directory for CLI
  capabilities;
- source and ownership — which project, machine, or framework layer supplied
  the capability.

A lifecycle label is declared routing state, not proof that a person reviewed
the command or authorized this invocation. `active` means normally
discoverable and runnable. The caller or host must still evaluate side effects,
provider identity, repository policy, and the requested arguments.

## The vocabulary you need

- A **workspace** is the repository context whose paths you are using. AXF's
  precise root contract separates the **project root** used for discovery from
  the **execution root** used as the runtime working directory.
- A **module** is a reusable subsystem that exposes capabilities.
- A **capability** is one stable, inspectable operation.
- `inspect` reads the contract and resolved launch information.
- `run` validates and maps arguments, applies lifecycle and policy checks, and
  invokes the declared adapter.

The `--` boundary makes argument ownership explicit; it does not bypass AXF
validation:

```sh
axf --project-root /repo run global.logs.query \
  --axf-json -- \
  --json --limit 20
```

Arguments after `--` still go through the capability's schema, coercion,
argument mapping, policy checks, and adapter.

## CLI, MCP, and authority

MCP exposes one router tool named `axf`. Its operations are `help`, `guide`,
`list`, `explain`, `inspect`, `run`, `doctor`, and `scout_check`. Capabilities
do not become separate MCP tools. Prefer `guide`, then `inspect`, then `run`.

The CLI is the mutation control plane. MCP cannot initialize, materialize,
promote, demote, or write scout results.

Project and execution roots bind discovery and runtime filesystems. They are
not tenant identity, repository authorization, a grant, or proof of user
intent. A security-sensitive host must authorize first. Provider credentials
and authorization remain provider-owned; AXF does not replace them.

For detailed response envelopes, recommendation declarations, and diagnostics,
continue to the [Agent discovery and workflow guide](15-agent-discovery-and-workflow-guide.md).

## When to stop and ask

Do not run a capability merely because it exists. Stop when:

- effects are `write`, `network`, or `unknown` and approval is absent;
- the selected project or execution root is unexpected;
- the provider identity is unclear;
- a draft capability requires `--axf-any-lifecycle`;
- the manifest, documentation, and resolved launch plan disagree.

Report the inspected contract and the unresolved authority or drift question.
Do not work around the contract with a guessed shell command unless the caller
has separately authorized that path.
