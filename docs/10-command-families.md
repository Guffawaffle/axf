# Command Families

A **command family** is a provider's existing command vocabulary
described as one declarative manifest. Authoring one capability file
per `git` subcommand (or `gh`, `kubectl`, `docker compose`) is
tedious and brittle. Family manifests let you import an entire
vocabulary at once and materialize only the commands you need to
override.

## Family manifest

`manifests/families/<name>.family.json`:

```json
{
  "manifestVersion": "axf/v0",
  "family": "git",
  "scope": "global",
  "provider": "git",
  "adapterType": "cli",
  "executionTarget": { "command": "git" },
  "providerArgStyle": "double-dash-kebab",
  "lifecycleState": "active",
  "owner": "import",
  "commands": {
    "status": {
      "summary": "Show working tree status",
      "executionTarget": { "command": "git", "args": ["status"] },
      "args": {
        "porcelain": { "type": "boolean" },
        "branch": { "type": "string", "providerFlag": "--branch" }
      }
    }
  }
}
```

The registry synthesizes one capability per command at load time. For a
family with `scope: "global"`, command `status` becomes capability
`global.git.status`. Synthesized capabilities carry:

- `origin: "imported"`
- `sourceFamily: { family, command, manifestPath }`
- `argMap: { <publicName>: <providerFlag> }`

Run `axf inspect global.git.status` to see all of these.

## Public-to-provider arg mapping

Each command's args go through three layers when computing
`providerFlag`:

1. **Per-arg override** — `args.<name>.providerFlag: "--my-flag"`
2. **Family-level override** — `argMap: { "<publicName>": "--my-flag" }`
3. **Style derivation** from `providerArgStyle`:
   - `"double-dash-kebab"` (default) → `kebab-case` → `--kebab-case`
   - `"powershell-pascal"` → `kebab-case` → `-PascalCase`

The cli type adapter uses `capability.argMap` when constructing the
provider command line. Public arg names are kept stable across providers;
the provider flag changes underneath.

### Reserved names

These public arg names are reserved by axf and rejected at family load:

```text
json, workspace, any-lifecycle, allow-draft, include-drafts, all
```

If a provider uses these, expose them under a different public name and
map back via `providerFlag`.

## Materialization

Most commands stay imported. When you need to override a command —
custom defaults, a different launcher, narrower argsSchema — materialize
just that one:

```sh
axf init materialize git status
```

This writes `manifests/capabilities/global.git.status.json` derived
from the family entry, with `lifecycleState: "draft"` and the
`sourceFamily` back-reference preserved.

The materialized file shadows the imported synthesis. `inspect` reports
`origin: materialized`. Edit it freely.

## Drift

Once a command is materialized, it can drift from the family it came
from (provider added a new flag; you renamed an arg locally; the
family changed `executionTarget`). `axf doctor` runs drift detection
and reports each kind:

| Kind | Meaning |
|---|---|
| `missing-source` | `sourceFamily` references a family or command that no longer exists |
| `args-added` | family declares args the materialized capability does not |
| `args-removed` | materialized capability declares args the family no longer has |
| `arg-flag-changed` | a shared arg's `providerFlag` differs between family-derived map and the materialized `argMap` |
| `execution-target-changed` | family's `executionTarget` no longer matches the materialized capability |

`missing-source` is reported as an error; the others are warnings.
Resolve drift either by re-materializing (delete the file and run
`axf init materialize` again) or by editing the materialized file to
bring it back in line.

## Scout imports

`axf scout` is the explicit executable-discovery boundary for repo-local
command sources. Normal `axf list`, `axf inspect`, and `axf run` stay
manifest-backed; `scout` reads declared imports from `axf.workspace.json`
and reconciles those sources into family and capability manifests.

Example workspace marker:

```json
{
  "manifestVersion": "axf/v0",
  "name": "my-repo",
  "imports": [
    {
      "kind": "ax-inventory",
      "family": "my-repo",
      "path": ".ax/ax.ps1",
      "providerArgStyle": "powershell-pascal"
    }
  ]
}
```

Scout modes:

```sh
axf scout          # preview drift from declared import sources
axf scout --check  # fail if manifests are out of sync
axf scout --write  # update materialized manifests
```

For `ax-inventory` imports, scout runs the declared `.ax` dispatcher with
`list -Json`. Commands that expose framework-reserved public args, such
as `all`, are emitted as standalone capability files so the family
manifest remains loadable.

Provider command names are normalized to AXF-safe kebab-case command
keys. For example, a provider command named `dist:win` is exposed as
`dist-win`, while the generated `executionTarget.args` still invokes the
provider's original `dist:win` command.

## Workflow

```text
import (write family manifest)
  ↓
inspect    (axf inspect <id> --json)
  ↓
refine     (edit family manifest in place)
  ↓
materialize  (only what you must override; axf init materialize)
  ↓
promote    (axf promote <id> --to active)
```

For repo-local `.ax` command families, use `scout` as the compiler step
between source command inventory and runtime manifests.
