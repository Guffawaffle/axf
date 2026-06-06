# Example Resolution Patterns

Three worked examples drawn from the current alpha model. All run from
any CWD with the `axf` binary on PATH after project-root binding is
resolved.

## 1. Built-in internal capability — `echo say`

```sh
axf run echo say --message hello
```

Parsed path: scope `global`, module `echo`, capability `say`.
Resolved ID: `global.echo.say` (lifecycleState `active`).

Execution plan:

- type adapter: `internal`
- provider adapter: none
- execution target: handler `echo.say`
- args: `{ "message": "hello" }`

Result shape:

```js
{
  ok: true,
  data: "hello",
  meta: { capabilityId: "global.echo.say", adapterType: "internal" }
}
```

## 2. Mounted capability — `toy echo say`

```sh
axf run toy echo say --message hello
```

Parsed path: scope `toolspace-local`, toolspace `toy`, module `echo`,
capability `say`.
Resolved ID: `toolspace.toy.echo.say` (lifecycleState `active`).

The `toy` toolspace mount remaps `global.echo` under
`toolspace.toy.echo` and injects its local defaults. The execution
target stays the same, but the resolved ID, defaults, and policy
surface can differ from the global capability.

## 3. Optional command family capability

An optional family can live in the project root or in a machine-level
AXF root such as `AXF_MACHINE_ROOT`.

Example family command:

```json
{
  "manifestVersion": "axf/v0",
  "family": "demo",
  "scope": "global",
  "provider": "demo",
  "adapterType": "cli",
  "executionTarget": { "command": "demo" },
  "lifecycleState": "active",
  "commands": {
    "status": {
      "summary": "Show demo status",
      "executionTarget": { "command": "demo", "args": ["status"] },
      "args": {},
      "sideEffects": "read"
    }
  }
}
```

The registry synthesizes `global.demo.status` from that family. If a
machine layer and project root both define `family: "demo"`, the
project-root family shadows the machine-level family. If the project
needs to override just one command, materialize that command into
`manifests/capabilities/global.demo.status.json` and leave the family
name unchanged.
