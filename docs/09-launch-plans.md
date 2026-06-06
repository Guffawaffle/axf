# Launch Plans

A **launch plan** is the framework's resolution of a CLI capability's
`executionTarget` into a concrete `(command, argsPrefix, cwd, targetPath)`
tuple. The cli type adapter never re-derives this; both the runtime
executor and `axf inspect` ask the framework for the same plan.

## Shapes accepted in `executionTarget`

### Inline command (legacy)

```json
{ "executionTarget": { "command": "git" } }
```

The command is a literal program name on PATH. No target file.

### Target path with a launcher

```json
{
  "executionTarget": {
    "target": {
      "path": "scripts/run-build.sh",
      "relativeTo": "workspace"
    }
  }
}
```

`relativeTo: "workspace"` joins the path under the resolved project root
at runtime. `relativeTo: "framework"` joins the path under the AXF
package root, which is useful for framework-owned capabilities that
must launch bundled runtime dependencies without relying on global
shims. The cli adapter uses the resolved absolute path as the command
argument.

### Env-bound root with a fallback

```json
{
  "executionTarget": {
    "target": {
      "path": "tools/lex.js",
      "fromEnv": "LEX_HOME",
      "fallbackRoot": "vendor/lex",
      "fallbackRelativeTo": "workspace"
    }
  }
}
```

If `LEX_HOME` is set, the path is resolved under it. Otherwise the
fallback root is used (project-root-relative if `fallbackRelativeTo:
"workspace"`).

### Custom launcher

```json
{
  "executionTarget": {
    "target": { "path": "scripts/build.ps1", "relativeTo": "workspace" },
    "launcher": { "command": "pwsh", "args": ["-File"] }
  }
}
```

The cli adapter invokes `pwsh -File <resolved-path>`. Use this for
interpreter-fronted scripts (PowerShell, Python, Node, Ruby).

### Working directory

CLI capabilities run from the bound AXF execution root by default. This
keeps provider tools that discover project state from `process.cwd()`
anchored to the caller-facing execution root, even when AXF resolves the
capability target from a different project root.

Manifests may override the working directory explicitly:

```json
{
  "executionTarget": {
    "command": "npm",
    "args": ["test"],
    "cwd": { "path": "packages/app", "relativeTo": "workspace" }
  }
}
```

`executionTarget.cwd` may be an absolute string, an execution-root-relative
string, or an object with `path` and `relativeTo`. Supported
`relativeTo` values are `"workspace"` and `"process"`. For `cwd`,
`relativeTo: "workspace"` resolves against the execution root; for
target paths it resolves against the project root. If AXF has no bound
execution root, the current process cwd is used.

## Inspection

`axf inspect <id> --json` includes a `launchPlan` field for any cli
capability:

```json
{
  "launchPlan": {
    "command": "pwsh",
    "argsPrefix": ["-File", "/abs/scripts/build.ps1"],
    "requestedCommand": "pwsh",
    "resolvedCommand": "pwsh",
    "commandSource": "path:...",
    "launchStrategy": "direct",
    "cwd": "/abs/execution-root",
    "cwdSource": "workspace",
    "targetPath": "/abs/scripts/build.ps1",
    "targetSource": "relative:workspace"
  }
}
```

This is the source of truth — the runtime executor uses the same
resolver via `src/core/cli-launch-plan.js`.

## Windows npm shims

On Windows, npm-installed CLIs often resolve to `.cmd` or `.bat` shims
rather than native executables. For workspace-owned capabilities that
intentionally use a PATH command, AXF keeps the manifest contract simple
and resolves the platform detail at launch time:

- direct executables continue to run directly
- resolved `.cmd` / `.bat` shims are launched explicitly through
  `cmd.exe /d /s /c`
- `axf inspect` surfaces both the requested command and the resolved
  command so the behavior is observable

This keeps repo manifests portable and avoids per-repo PowerShell
wrapper scripts for standard npm-installed tools.

Optional shared packs can still choose a `target.relativeTo: "framework"`
or env-bound target when they own that dependency, but AXF core no
longer special-cases a package-local shared pack. Project-owned CLI
capabilities should normally use PATH commands only when that tool is
expected to exist in the caller's runtime.

## WSL diagnostics

`axf doctor` inspects the resolved `axf`, `lex`, `node`, and `npm`
commands when running under WSL. It warns when:

- PATH entries under `/mnt/c/...` are being used for npm shims
- a CLI capability resolves its command or target across the Linux /
  Windows boundary
- the documented native AXF entry at `/srv/axf/bin/axf.js` is missing

The goal is to diagnose Windows PATH contamination clearly, not to
label WSL itself as broken.

## Validation

The framework rejects malformed shapes at manifest load time:

- `target.path` must be a string when `target` is declared.
- `launcher.command` must be a string when `launcher` is declared.
- `cwd` must be a string or `{ "path": "...", "relativeTo": "workspace" | "process" }` when declared.
- A cli capability must declare either `command` or `target.path`.
