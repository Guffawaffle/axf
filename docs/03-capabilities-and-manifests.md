# AXF Capabilities and Manifest Model

## Goal

Every runnable unit in AXF should be declared before it enters normal routing.

The manifest layer is the framework/control-plane contract that lets:
- humans inspect a capability
- agents scaffold safely
- AXF resolve consistently
- policies enforce lifecycle state and side effects

Lifecycle makes declared review state visible; it does not prove review or
grant authority. See [Lifecycle and promotion](05-lifecycle-and-promotion.md).

## Capability identity

Human syntax may be short, but AXF should resolve to a fully qualified capability ID.

Examples:

- `global.echo.say`
- `toolspace.toy.echo.say`
- `workspace.repo.status`

## Capability manifest fields

Suggested baseline fields:

- `id`
- `summary`
- `provider`
- `adapterType`
- `executionTarget`
- `argsSchema`
- `outputModes`
- `sideEffects`
- `scope`
- `lifecycleState`
- `defaults`
- `policies`
- `owner`
- `recommendedFor` (optional workflow intents such as `session-start`, `validation`, or `handoff`)
- `examples`

## Example capability manifest

```json
{
  "id": "global.echo.say",
  "summary": "Return a message through the built-in echo provider",
  "provider": "echo",
  "adapterType": "internal",
  "executionTarget": {
    "handler": "echo.say"
  },
  "argsSchema": {
    "type": "object",
    "properties": {
      "message": { "type": "string" }
    },
    "required": ["message"],
    "additionalProperties": false
  },
  "outputModes": ["json", "text"],
  "sideEffects": "none",
  "scope": "global",
  "lifecycleState": "active",
  "defaults": {},
  "policies": [],
  "owner": "module:echo",
  "recommendedFor": ["session-start"],
  "examples": ["axf run echo say --message hello"]
}
```

## Mount manifest idea

A toolspace mount should not redefine the provider from scratch unless needed.
It can narrow and wrap a shared provider.

Example:

```json
{
  "toolspace": "toy",
  "moduleMounts": {
    "echo": {
      "source": "global.echo",
      "mode": "proxy",
      "capabilities": [
        "say"
      ],
      "defaults": {
        "prefix": "[toy]"
      },
      "policies": [
        "require_workspace_binding"
      ]
    }
  }
}
```

## Resolver behavior

The resolver should:

1. parse the CLI path
2. identify the intended scope
3. load manifests for that scope
4. resolve a logical path to a fully qualified capability ID
5. bind the right adapter and execution target
6. inject allowed defaults
7. enforce lifecycle and policy gates

## Why this matters

Without AXF manifests:
- agents guess
- naming drifts
- output contracts drift
- side effects become unclear
- mounts become hand-wavy shell wrappers

With AXF manifests:
- the system becomes inspectable
- scaffold generation becomes reliable
- lifecycle promotion becomes meaningful
