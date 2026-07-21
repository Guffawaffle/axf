# Documentation paths

AXF documentation has three current paths. Choose the job you are doing now;
do not read the framework reference merely to call a fitted capability.

| Audience | Start here | Core loop |
|---|---|---|
| Caller or coding agent | [Caller guide](callers.md) | `guide → inspect → run` |
| Integration author | [Integration author guide](integration-authors.md) | recurring ceremony → fit → review → expose |
| AXF framework author | [Framework author guide](framework-authors.md) | contract → source → tests |

## Caller path

Use this path when someone else owns the capability contracts.

1. Read the [Caller guide](callers.md).
2. Use `axf guide` for bounded repository entrypoints.
3. Use compact `list` and `explain` only when you need broader discovery.
4. `inspect` the selected capability's lifecycle, effects, policies, roots,
   arguments, provenance, and launch plan.
5. `run` only after the invocation is authorized.

For detailed discovery envelopes and MCP examples, continue to
[Agent discovery and workflow](15-agent-discovery-and-workflow-guide.md).
Stop there unless you are responsible for fitting provider or repository
ceremony.

## Integration author path

Use this path when you are turning an existing command family or recurring
repository workflow into stable capabilities.

1. If adoption is undecided, perform the
   [read-only fit evaluation](agent-evaluation.md).
2. Read the [Integration author guide](integration-authors.md).
3. Preserve provider vocabulary with
   [command families](10-command-families.md).
4. Use [launch plans](09-launch-plans.md) and argument mapping to express the
   real execution contract.
5. Materialize only selective overrides. Normalize only when callers need a
   stable programmatic result; see
   [Normalization guidance](11-normalization-guidance.md).
6. Treat lifecycle as declared routing state and keep review external to the
   state-changing command; see [Lifecycle and promotion](05-lifecycle-and-promotion.md).
7. Apply the concrete [Repo onboarding](13-repo-onboarding.md) steps only after
   approval.

## Framework author path

Use this path when you are changing AXF's loaders, resolver, adapters, policy,
execution, diagnostics, CLI, MCP, or response contracts.

Start with the [Framework author guide](framework-authors.md), which routes into
the relevant architecture references and source directories. Preserve the
framework's role as an inspectable traffic cop: repository and provider
contracts should remain outside core unless the behavior is genuinely general.

## Product boundaries

AXF owns current workflow discovery, declared execution contracts, and routing.
It does not own provider credentials or authorization, and filesystem roots do
not establish authority. Continuity systems such as Lex may supply historical
context separately; AXF does not require Lex, and retrieved history is evidence
rather than an instruction or grant.
