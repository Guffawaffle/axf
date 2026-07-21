# Lifecycle and promotion

AXF lifecycle labels control normal discovery and routing. They make review
state visible, but they do not perform or certify the review.

This distinction matters: a valid manifest can still invoke the wrong command,
use the wrong authority, declare inaccurate side effects, or produce an
unstable result.

## States

### `draft`

A new or changing unit that is outside the normal active surface.

Typical characteristics:

- incomplete or still being fitted;
- available for explicit inspection;
- excluded from default resolution unless the caller opts into non-active
  lifecycle states;
- not appropriate for unattended use.

### `reviewed`

A unit whose owner declares that the intended review has occurred but which is
not yet part of the normal active surface.

A useful external review checks naming, manifest shape, side effects, policies,
arguments, launch plan, output contract, platform behavior, and tests. AXF does
not record who performed those checks or enforce a particular review system.

### `active`

A unit included in normal discovery and routing.

`active` means normally available. It is not proof of human review, a security
grant, provider authentication, or authorization for a particular invocation.
Callers must still inspect the contract and follow repository and host policy.

## Current CLI mechanics

Capability lifecycle state can be rewritten with:

```sh
axf promote <id> --to reviewed
axf promote <id> --to active
axf demote <id> --to reviewed
axf demote <id> --to draft
```

Both commands rewrite the capability manifest in place and validate its schema
before writing. `demote` requires a target earlier than the current lifecycle.
`promote` accepts any named lifecycle target and does not require an ordered
`draft → reviewed → active` sequence.

Neither command:

- runs tests or provider commands;
- verifies the declared side effects or output shape;
- establishes provider identity or authorization;
- requires or records human approval;
- proves that a review described by the repository actually happened.

Use lifecycle commands after the relevant external checks, not as a substitute
for them. `--json` returns a structured state-change result for automation.

Mounted capability IDs cannot be promoted directly; change the source
capability instead. Adapters and toolspace manifests also declare lifecycle
state, but the current `promote` and `demote` commands operate on capability
manifests. Review and edit other unit types through their owning file workflow.

## Materialization edge case

`axf init capability`, `axf init family`, and adapter scaffolding create drafts.
`axf init materialize <family> <command>` is different: the materialized
capability inherits the command's declared lifecycle when present and otherwise
defaults to `draft`.

Materializing an `active` family command can therefore create an active
standalone override immediately. If the next step is experimental editing,
demote the materialized capability to `draft` first.

## Recommended review practice

Before declaring a capability `reviewed`, establish evidence for:

- valid identity, schema, and adapter binding;
- accurate side effects, policies, and ownership;
- expected project and execution roots;
- public-to-provider argument mapping;
- resolved launch behavior on supported platforms;
- output and failure contracts;
- relevant tests and documentation.

Before declaring it `active`, confirm the route is intended for normal caller
discovery, its review evidence is current, and the repository has an owner for
future drift.

These are recommended repository controls. The AXF runtime currently enforces
manifest validation, lifecycle filtering, declared policies, argument schemas,
and adapter execution—not a complete organizational approval process.
