# Repo Onboarding

This is the recommended path for bringing a repository onto AXF without
copying bespoke Lex wrapper scripts into every repo.

## 1. Add the workspace marker first

Create `axf.workspace.json` at the repo root.

```json
{
  "manifestVersion": "axf/v0",
  "name": "my-repo"
}
```

This is the anchor AXF uses for workspace binding. Without it, `axf`
may fall back to the current directory or to the installed framework
workspace, and `axf doctor` will say so explicitly.

## 2. Reuse the standard Lex family

AXF ships an imported `global.lex.*` family so repos can reuse the same
Lex command surface without local wrapper manifests.

Read-oriented capabilities:

- `global.lex.status`
- `global.lex.introspect`
- `global.lex.recall`
- `global.lex.search`
- `global.lex.policy-check`

Write-oriented capabilities:

- `global.lex.remember`
- `global.lex.log-frame`
- `global.lex.note`

The write capabilities are intentionally visible as
`sideEffects: "write"`.

## 3. Mount shared capabilities, keep repo-specific ones separate

Mount the shared read pack into a toolspace when you want a grouped
surface:

```json
{
  "manifestVersion": "axf/v0",
  "toolspace": "ops",
  "lifecycleState": "active",
  "moduleMounts": {
    "lex": {
      "source": "global.lex",
      "mode": "proxy",
      "capabilities": ["status", "introspect", "recall", "search", "policy-check"]
    }
  }
}
```

Keep repo-specific capabilities separate under:

- `manifests/capabilities/` for single commands
- `manifests/families/` for reusable command families

This keeps the shared Lex pack stable while repo-local capability work
remains obvious and reviewable.

## 4. Keep MCP optional

AXF does not require MCP. A repo can start with the workspace marker,
the imported Lex family, and local CLI or internal capabilities. Add
MCP only if the repo actually needs it.

## 5. Mark write surfaces clearly

AXF today has first-class `sideEffects`, not a first-class
`approvalRequired` field.

Current recommendation:

- mark mutating capabilities with `sideEffects: "write"`
- mount read and write surfaces separately when that helps review
- enforce approvals through repo policy, review, or higher-level
  orchestration outside AXF

## Platform notes

### Windows

Use standard PATH-based commands such as `"command": "lex"` in
manifests. AXF resolves npm `.cmd` / `.bat` shims itself and launches
them through `cmd.exe` only when needed.

### WSL

Prefer Linux-native `axf`, `lex`, `node`, and `npm` ahead of Windows
PATH entries. `axf doctor` warns when commands resolve under
`/mnt/c/...`, which usually means Windows shims are leaking into WSL.

### Linux / macOS

Use the native `bin/axf.js` entry on PATH and standard CLI manifests.

## Suggested onboarding loop

1. Add `axf.workspace.json`.
2. Run `axf doctor` and confirm the workspace source is the repo, not a fallback.
3. Use `axf list` to confirm the shared `global.lex.*` family is visible.
4. Mount the read-only Lex pack into a toolspace if the repo wants grouped commands.
5. Add repo-specific capabilities after the shared surfaces are working.