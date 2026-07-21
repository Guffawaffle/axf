# Read-only AXF fit evaluation

Use this assessment before installing AXF or changing a repository. Its only
question is whether repeated local operating ceremony is worth fitting once
into stable, inspectable capabilities.

This is an evaluation, not onboarding. It must end with a recommendation, not
with new files or a working AXF installation.

## Non-negotiable boundary

The evaluation is strictly read-only.

Do not:

- install AXF or another dependency;
- edit, create, delete, or format files;
- scaffold manifests, adapters, toolspaces, or workspace markers;
- invoke MCP tools or start an MCP server;
- run package scripts, repository code, provider commands, or discovered
  workflows;
- call `axf init`, `axf promote`, `axf demote`, `axf scout --write`, or
  `axf integrate codex --write`;
- change user, editor, shell, or repository configuration.

Read existing files and inspect already-available version-control metadata.
If evidence would require execution or mutation, name the unknown instead of
crossing the boundary. Installation, scaffolding, promotion, and any pilot all
require separate approval.

## Evidence to inspect

Keep the pass bounded. Prefer the repository's root-level control files and
follow links only when they affect recurring agent work.

1. **Scripts and package tasks** — package manifests, task runners, Makefiles,
   shell or PowerShell dispatchers, and repeated command chains.
2. **Documentation and instructions** — README files, contributor guides,
   agent instructions, runbooks, and comments that define local procedure.
3. **CI and platform constraints** — the commands CI treats as canonical,
   operating-system branches, required runtimes, working-directory rules, and
   interpreter or PATH assumptions.
4. **Current agent surfaces** — existing MCP configuration, repo-native tools,
   command catalogs, wrappers, or capability-like conventions. Record overlap;
   do not assume AXF should replace them.
5. **Repeated mistakes** — evidence that agents or humans repeatedly choose the
   wrong command, omit a required step, lose the intended working directory, or
   reconstruct the same repository facts.
6. **Authority boundaries** — who authenticates, who authorizes side effects,
   which provider owns identity, and which operations require human approval.
   Filesystem roots and retrieved context are inputs, not proof of authority.
7. **Likely maintenance owners** — who would review capability contracts and
   update them when scripts, provider flags, outputs, or policy change.

Do not infer repeated pain merely from the presence of many scripts. Look for a
recurring caller need and a route that can remain more stable than its
implementation.

## What makes a good candidate

A strong candidate has most of these properties:

- the ceremony recurs across sessions, agents, or contributors;
- the correct path requires repository-specific knowledge;
- the inputs, outputs, side effects, and execution root can be declared;
- a stable capability name can survive changes to the underlying script;
- existing tools can remain the provider of record;
- someone can own drift review.

A weak candidate is a one-off task, an obvious single command, a rapidly
changing experiment, an operation whose authority cannot be represented
safely, or a repository with no owner for the contract.

## Verdicts

Return exactly one:

- **adopt** — several recurring, high-value routes have clear contracts and a
  credible owner; deliberate onboarding is justified.
- **pilot** — one bounded route can test the value cheaply before broader
  adoption.
- **defer** — the need may be real, but a current blocker such as unstable
  scripts, unclear authority, platform churn, or missing ownership makes a fit
  premature.
- **not a fit** — existing paths are already obvious and reliable, the work is
  not recurring, or AXF would add more ceremony than it removes.

Do not use `adopt` to authorize changes. It is still a recommendation.

## Required response

Use this compact structure:

```text
Verdict: adopt | pilot | defer | not a fit

Repeated ceremony:
- <route and evidence>

Existing overlap:
- <scripts, docs, MCP, wrappers, or conventions AXF should preserve>

Candidate capability contracts:
- <stable caller intent → current provider route → side effects>

Costs:
- Initial fitting: <low/medium/high, with why>
- Ongoing drift: <low/medium/high, likely triggers, and owner>

Authority and runtime boundaries:
- <authentication, authorization, roots, platforms, unknowns>

Smallest reversible pilot:
- <one read-only or otherwise low-risk route, validation evidence, and rollback>

Unknowns:
- <facts that could not be established without execution or mutation>
```

The pilot is a proposal only. Keep it small enough to remove cleanly, avoid
duplicating an entire provider vocabulary, and define what evidence would make
the team expand, revise, or abandon it.
