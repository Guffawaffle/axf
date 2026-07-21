# Framework author guide

This path is for changes to AXF itself: registry loading, resolution, launch
planning, adapter execution, lifecycle or policy enforcement, diagnostics,
CLI parsing, MCP routing, and response projection.

If you are exposing an existing provider or repository workflow, use the
[integration author guide](integration-authors.md) instead. Provider-specific
behavior belongs in manifests or provider adapters unless it changes a general
framework contract.

## The invariant

AXF is the exoskeleton framework and traffic cop. It should make repository-
owned operating routes stable and inspectable without replacing provider
vocabulary, identity, authorization, or judgment.

The runtime path is:

```text
CLI or single MCP router
  → registry
  → resolver
  → lifecycle and policy checks
  → adapter binding
  → launch plan / executor
  → normalized AXF result
```

Preserve these boundaries:

- friendly CLI paths resolve to explicit canonical capability IDs;
- manifests declare runnable units before normal routing exposes them;
- registry discovery and execution cwd remain separate root concepts;
- root inputs never become authority evidence;
- the framework owns adapter contracts, so providers need no AXF hook;
- provider identity and authorization stay provider-owned;
- the CLI remains the mutation control plane;
- MCP remains one bounded router tool over the same registry and execution
  paths, not a parallel plugin or governance system;
- capability-owned result `data` is not silently summarized, truncated, or
  redacted by AXF response projection;
- lifecycle changes do not masquerade as completed review.

## Reading path

Read only the references relevant to the contract you are changing:

1. [Foundation](00-foundation.md) — the design problem and non-goals.
2. [Vocabulary](01-vocabulary.md) — canonical nouns and root distinctions.
3. [Architecture](02-architecture.md) — runtime layers and resolution.
4. [Capabilities and manifests](03-capabilities-and-manifests.md) — declared
   contract shape.
5. [Adapter contract](04-adapter-contract.md) and
   [adapter folder shape](08-adapter-folder-shape.md) — type versus provider
   adapters and loader boundaries.
6. [Lifecycle and promotion](05-lifecycle-and-promotion.md) — current mechanics
   and the review boundary.
7. [Launch plans](09-launch-plans.md) — platform-aware command resolution.
8. [Command families](10-command-families.md) and
   [layer precedence](14-family-identity-and-layer-precedence-plan.md) — imports,
   overrides, and drift.
9. [Agent discovery and workflow](15-agent-discovery-and-workflow-guide.md) —
   caller-facing discovery and response contracts.

Then inspect the matching source and tests:

- `src/cli/` — parsing, CLI ownership, and mutation commands;
- `src/core/` — registry, resolver, policy, execution, doctor, and discovery;
- `src/mcp/` — the single-tool MCP contract and response envelopes;
- `adapters/` — shipped type and provider adapters;
- `test/` — executable contracts and cross-surface parity.

Some older planning documents retain future-looking language. Current source,
tests, and user-facing command help are the implementation evidence when a
plan and runtime differ.

## Change checklist

Before changing runtime behavior:

1. Identify whether the change belongs in core, a type adapter, a provider
   adapter, or a manifest. Keep provider quirks out of core.
2. Trace the same capability through registry load, resolution, inspection,
   policy, execution, and result projection.
3. Check both CLI and MCP surfaces when the behavior is shared. MCP need not
   have mutation parity.
4. Preserve project-root versus execution-root semantics across platforms.
5. Make lifecycle, side effects, policies, provenance, and argument ownership
   visible enough for a caller to decide safely.
6. Add or update `node:test` coverage using temporary workspaces and no new
   runtime dependencies unless the change explicitly requires one.
7. Run `npm run lint` and `npm test`.

Do not broaden runtime behavior merely to make an example easier. Documentation
and examples should demonstrate the current contract; proposed behavior belongs
in a plan or issue until implemented.
