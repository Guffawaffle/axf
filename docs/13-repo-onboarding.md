# Repo Onboarding

This is the recommended path for bringing a repository onto AXF without
copying bespoke wrapper scripts into every repo.

AXF provides the workspace-native agent exoskeleton framework and
control plane. The repository owns the capabilities that describe how it
is built, tested, searched, diagnosed, and operated safely.

## 1. Add the project marker first

Create `axf.workspace.json` at the repo root.

```json
{
  "manifestVersion": "axf/v0",
  "name": "my-repo"
}
```

This is the anchor AXF uses for project-root binding. Without it, `axf`
may fall back to the current directory or to the installed framework
location, and `axf doctor` will say so explicitly.

## 2. Start with the built-in proof of life

AXF core intentionally ships a tiny built-in capability surface.

The reliable first check is:

```sh
axf run echo say --message hello
```

That proves the CLI, registry, resolver, internal adapter, and executor
are all wired before the repo adds its own capability pack.

## 3. Add shared packs intentionally

Shared packs are optional layer content, not required AXF core
dependencies.

Use a machine-level AXF root when one pack should be available across
many repos:

```sh
export AXF_MACHINE_ROOT="$HOME/.config/axf"
```

Use the project root when the repo owns the pack or wants to override a
machine-level default. If both layers define the same family name, the
project-root family wins because it is narrower and more intentional.

## 4. Keep repo-specific capabilities separate

Keep repo-specific capabilities under:

- `manifests/capabilities/` for single commands
- `manifests/families/` for reusable command families

This keeps shared packs stable while repo-local capability work remains
obvious and reviewable.

## 5. Mount shared capabilities only when useful

Mount a shared pack into a toolspace when a repo wants grouped commands
or toolspace-local defaults:

```json
{
  "manifestVersion": "axf/v0",
  "toolspace": "ops",
  "lifecycleState": "active",
  "moduleMounts": {
    "echo": {
      "source": "global.echo",
      "mode": "proxy",
      "capabilities": ["say"],
      "defaults": { "prefix": "ops" }
    }
  }
}
```

For a shared Lex pack, use the same shape with `source: "global.lex"`
after the repo or machine layer has intentionally supplied that family.

## 6. Keep MCP optional

AXF does not require MCP. A repo can start with the project marker,
the built-in echo capability, and local CLI or internal capabilities.
Add MCP only if the repo actually needs it.

## 7. Mark write surfaces clearly

AXF today has first-class `sideEffects`, not a first-class
`approvalRequired` field.

Current recommendation:

- mark mutating capabilities with `sideEffects: "write"`
- mount read and write surfaces separately when that helps review
- enforce approvals through repo policy, review, or higher-level
  orchestration outside AXF

## Platform notes

### Windows

Use PATH-based commands only for project-owned tools that are expected
on PATH. AXF resolves npm `.cmd` / `.bat` shims itself and launches them
through `cmd.exe` only when needed.

### WSL

Prefer Linux-native `axf`, `node`, `npm`, and provider CLIs ahead of
Windows PATH entries. `axf doctor` warns when commands resolve under
`/mnt/c/...`, which usually means Windows shims are leaking into WSL.

### Linux / macOS

Use the native `bin/axf.js` entry on PATH and standard CLI manifests.

## Suggested onboarding loop

1. Add `axf.workspace.json`.
2. Run `axf doctor` and confirm the project root is the repo, not a fallback.
3. Use `axf run echo say --message hello` to confirm the core route.
4. Add optional shared packs at machine or project scope if the repo wants them.
5. Add repo-specific capabilities after the core route is working.
