# Example Resolution Patterns

Three worked examples drawn from the current alpha manifests. All run
from any CWD with the `axf` binary on PATH.

## 1. Built-in internal capability — `echo say`

```
axf run echo say --message hello
```

Parsed path: scope `global`, module `echo`, capability `say`.
Resolved ID: `global.echo.say` (lifecycleState `active`).

Execution plan:
- type adapter: `internal`
- provider adapter: none
- execution target: handler `echo.say`
- args: `{ message: "hello" }`

Result shape:
```js
{
  ok: true,
  data: "hello",
  meta: { capabilityId: "global.echo.say", adapterType: "internal", ... }
}
```

## 2. Mounted capability — `toy echo say`

```
axf run toy echo say --message hello
```

Parsed path: scope `toolspace-local`, toolspace `toy`, module `echo`,
capability `say`.
Resolved ID: `toolspace.toy.echo.say` (lifecycleState `active`).

The `toy` toolspace mount remaps `global.echo` under
`toolspace.toy.echo` and injects its local defaults. The execution
target stays the same, but the resolved ID, defaults, and policy
surface can differ from the global capability.

## 3. Imported CLI family capability — `lex status`

```
axf run lex status
```

Parsed path: scope `global`, module `lex`, capability `status`.
Resolved ID: `global.lex.status` (lifecycleState `active`).

Execution plan:
- type adapter: `cli`
- provider adapter: none
- execution target: `node <AXF package root>/node_modules/@smartergpt/lex/dist/shared/cli/lex.js introspect --json --format compact`, declared in the imported Lex family manifest

The registry synthesizes this capability from
`manifests/families/lex.family.json`. Lex is the reference capability
family being routed by AXF; AXF remains the resolver, lifecycle, policy,
adapter, and executor control plane.

The generic `cli` adapter parses JSON stdout when the provider emits it:
```js
{
  ok: true,
  data: { ... },
  meta: {
    capabilityId: "global.lex.status",
    adapterType: "cli",
    command: "node"
  }
}
```

Other synthesized Lex capabilities follow the same route, including
`global.lex.recall`, `global.lex.search`, `global.lex.policy-check`,
`global.lex.remember`, `global.lex.log-frame`, and `global.lex.note`.
