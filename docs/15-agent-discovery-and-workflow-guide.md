# Agent Discovery and Workflow Guide

AXF keeps canonical capability IDs authoritative while giving arriving agents
a bounded front door.

## Bootstrap flow

Use `guide` first when the workspace declares normal entrypoints:

```sh
axf guide
axf guide context --json
axf guide check --json
axf guide handoff --json
```

The MCP equivalent uses the same discovery implementation:

```json
{ "operation": "guide" }
```

Each recommendation exposes its canonical capability ID, lifecycle, side
effects, provenance, and an inspect invocation. `guide` never executes a
capability. Results default to 12 entries and are always bounded by a maximum
of 100.

When a workspace declares a composite session-context capability, prefer that
single operation for startup/resume/compaction. The packaged
`templates/session-context` recipe combines AXF guidance with bounded Lex
history without coupling Lex into AXF core. Its provider is read-only and
degrades to whichever component is available.

## Workspace recommendations

Declare repo-owned entrypoints in `axf.workspace.json`:

```json
{
  "manifestVersion": "axf/v0",
  "name": "my-repo",
  "recommendations": {
    "session-start": [
      {
        "label": "context",
        "capability": "global.my-repo.session-context"
      }
    ],
    "validation": "global.my-repo.check",
    "handoff": "global.my-repo.handoff"
  }
}
```

`context` aliases `session-start`; `check` aliases `validation`. AXF reports a
warning when a declared target is missing instead of silently substituting a
different capability.

## Family and capability recommendations

Reusable packs can recommend commands without hard-coding provider behavior in
AXF core. Put `recommendedFor` on a capability manifest or family command:

```json
{
  "commands": {
    "check": {
      "summary": "Validate the repository",
      "recommendedFor": ["validation"],
      "executionTarget": { "command": "my-cli", "args": ["check"] },
      "args": {},
      "sideEffects": "read"
    }
  }
}
```

Workspace declarations win presentation order; canonical resolution and run
policy remain unchanged.

## Compact discovery

Use compact/search discovery when the registry is larger than the immediate
workflow guide:

```sh
axf list --compact --search lex --limit 20 --json
axf list --compact --side-effects read
```

```json
{
  "operation": "list",
  "compact": true,
  "search": "lex",
  "sideEffects": "read",
  "limit": 20
}
```

Compact entries retain ID, summary, lifecycle, side effects, scope, source
kind, layer, manifest path, owner, provider, family, and mount provenance.
Full `list` output remains available when complete manifests are required.

## Missing-capability explanations

Use `explain` rather than reconstructing registry internals:

```sh
axf explain global.lex --json
axf explain global.lex.missing-command --json
```

```json
{ "operation": "explain", "query": "global.lex.missing-command" }
```

AXF distinguishes loaded, lifecycle-filtered, prefix-only, loaded-family with
missing command, manifest-load failure, and absent capability states. Missing
results include the active project/execution roots and bounded suggestions.

## Inspect examples

`inspect` includes declared examples plus generated CLI and MCP inspect/run
shapes. It also shows public argument names and provider flag mappings when a
family declares an `argMap`. Generated placeholders are explicit; provider- or
workspace-authored examples remain the source for real environment-specific
values.

## Manifest scan boundary

AXF reads only these AXF-owned paths:

- `manifests/capabilities/**/*.json`
- `manifests/families/*.family.json`
- `manifests/toolspaces/**/*.json`

Domain JSON elsewhere under `manifests/` is ignored. This lets repositories
keep gameplay, hook, or application manifests nearby without producing false
AXF doctor errors.
