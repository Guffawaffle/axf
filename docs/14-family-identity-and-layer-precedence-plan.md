# Family Identity and Layer Precedence Plan

## Status

Planning handoff.

This document describes the intended model for command-family identity,
layered override behavior, and the extraction of shared packs such as Lex
from the AXF core package.

## Goal

AXF should remain a framework host with a minimal built-in surface.

The target design is:

1. AXF core ships only the smallest framework-owned example surface.
2. Shared packs such as Lex are optional wire-ins, not required runtime
   dependencies of the core package.
3. Family names represent semantic identity, not storage location.
4. Narrower layers override broader layers when they define the same
   family identity.
5. Local intent always wins over shared defaults.

## End State

The desired steady state is:

1. AXF core ships the framework, generic adapters, lifecycle gates,
   routing, and a tiny proof-of-life example such as `global.echo.say`.
2. AXF core does not require a built-in shared family such as Lex.
3. Shared packs can be installed or wired into normal AXF layers instead
   of being privileged inside core.
4. A machine-level `lex` family and a project-level `lex` family may both
   exist.
5. The project-level `lex` family wins because it is narrower and more
   intentional.
6. If the user wants two distinct packs to coexist, they use two
   different family names on purpose.

## Core Concepts

### Family identity

The `family` name is the semantic identity of a capability pack.

Examples:

- `lex`
- `git`
- `docker`
- `catalog`

The family name is not supposed to encode where the manifest was stored.

### Layer

A layer is the source level from which AXF discovered a family,
capability, or adapter.

The layer explains why one definition wins over another.

### Effective family

The effective family is the family definition that AXF actually uses after
applying precedence rules.

### Shadowed family

A shadowed family is a broader definition with the same family identity
that lost to a narrower one.

### Materialized override

A materialized capability is the command-level override mechanism.

Use same-family shadowing to replace the pack.
Use materialization to replace a command.

## Proposed Layer Model

From broadest to narrowest:

1. Framework built-ins
2. Machine-level AXF root
3. Project root
4. Toolspace-local layer
5. Materialized command override

### 1. Framework built-ins

This layer should stay minimal.

It exists only for framework-owned examples and framework-native runtime
surfaces. The long-term design should avoid shipping business-facing
families here.

### 2. Machine-level AXF root

This layer holds user- or machine-scoped shared packs that should be
available across many repos.

Examples:

- a shared `lex` pack installed for all repos on one machine
- a user-specific diagnostics pack
- a personal tool bundle

Exact path selection is a separate implementation decision. The contract
is the existence of a machine-level AXF layer, not a specific storage
path hardcoded into the design.

### 3. Project root

This layer holds repo-owned families, capabilities, adapters, and
toolspaces.

This is the main place where a repo intentionally wires in the surfaces it
needs.

### 4. Toolspace-local layer

This layer applies only within the toolspace that owns it.

It is the narrowest pack-level override surface before command
materialization.

### 5. Materialized command override

This is the narrowest executable override.

It should be used when a project wants to keep the same family identity
but replace one command's execution target, defaults, args, or lifecycle
state.

## Precedence Contract

### Family-level precedence

If multiple layers define the same family name, AXF should select the
narrowest layer's family as the effective family.

That means:

1. toolspace-local family shadows project-root family
2. project-root family shadows machine-level family
3. machine-level family shadows framework-built-in family

This is whole-family shadowing, not command-by-command merging.

The rationale is predictability: if a repo defines `lex`, operators should
not have to guess whether they are seeing a partial merge of machine and
repo definitions.

### Command-level precedence

Within the effective family, a materialized capability file shadows the
synthesized command from that family.

This is the supported way to override one command without renaming the
family or replacing the whole pack.

### Same-layer conflicts

If two families with the same name appear in the same layer, AXF should
report a conflict instead of guessing.

Same-name reuse is for hierarchy.
It is not for unresolved ambiguity.

## Naming Contract

### Reuse the same family name when the pack is the same concept

Examples:

- machine-level `lex`
- project-level `lex`
- toolspace-local `lex`

These are all the same conceptual pack at different levels of intent.

### Use different family names only when the user should see two distinct packs

Examples:

- `lex`
- `lex-experimental`
- `lex-ops`

These names should signal coexistence, not layering.

### Anti-goal

Do not force users to invent names such as `lex-global` or `lex-local`
just to express precedence.

That would move storage mechanics into the user-facing contract and make
the interface worse.

## Pack Inclusion Model

AXF should distinguish between:

1. core framework surfaces
2. optional shared packs
3. project-owned wiring

Shared packs should behave like normal layer content, not privileged core
special cases.

That means AXF should be able to support a shared Lex pack without making
Lex a required dependency of core.

## Lex Direction

The planned direction for Lex is:

1. remove Lex as a required core dependency
2. treat Lex as an optional pack
3. allow Lex to be wired at machine scope or project scope
4. let project-local `lex` shadow machine-level `lex`
5. keep the user-facing family identity as `lex`

The same rule should apply to any future shared pack.

## Storage Direction

The design needs a machine-level AXF root, but storage path selection does
not need to be coupled to the family model.

What matters now is the contract:

1. AXF must be able to discover a machine-level layer
2. AXF must be able to discover a project-root layer
3. AXF must be able to explain which layer supplied the effective family
4. AXF must explain when a broader family was shadowed by a narrower one

Path selection can be finalized separately through a small focused design
decision.

## Inspector and Doctor Expectations

Once layering exists, AXF should surface:

1. the effective family source layer
2. the effective manifest path
3. any shadowed broader family definitions
4. same-layer conflicts as explicit errors
5. whether a capability is synthesized from the effective family or
   materialized as a command-level override

This should be inspectable in both CLI and MCP output.

## Migration Plan

### Phase 1 — Codify source layers

Introduce first-class layer metadata for families, capabilities, and
adapters.

Deliverables:

1. every loaded family reports its layer
2. every synthesized capability retains that layer provenance
3. inspect and doctor can show where a family came from

### Phase 2 — Implement family shadowing

Add whole-family precedence by layer.

Deliverables:

1. same-name family at a narrower layer fully shadows the broader family
2. same-layer same-name family is a conflict
3. command materialization still works within the effective family

### Phase 3 — Add machine-level layer support

Introduce a machine-level AXF root as a normal shared-pack layer.

Deliverables:

1. machine-level families can be discovered without being built into core
2. project-root families can shadow machine-level families cleanly
3. inspect and doctor explain the winning layer

### Phase 4 — Extract Lex from core

Move the shared Lex pack out of AXF core and into an optional installable
or wire-in surface.

Deliverables:

1. AXF core returns to minimal dependency posture
2. blank AXF install does not depend on Lex
3. a machine-level or project-level Lex pack remains easy to wire in

### Phase 5 — Align docs and onboarding

Teach the layering model explicitly.

Deliverables:

1. docs describe family identity vs layer precedence clearly
2. onboarding shows how to wire in a shared pack intentionally
3. docs stop implying that a shared pack such as Lex is required by AXF

## Acceptance Criteria

The design is complete when all of the following are true:

1. AXF core can install and run without a required Lex dependency
2. a blank AXF install exposes only the tiny framework-owned built-ins
3. a machine-level `lex` pack can be installed and discovered
4. a project-level `lex` pack shadows the machine-level `lex` pack
5. a materialized `global.lex.status` override shadows the effective
   `lex` family command without renaming the family
6. same-layer duplicate `lex` families fail explicitly
7. inspect and doctor explain the winning source layer and any shadowed
   broader definitions

## Non-goals

This plan does not require:

1. command-by-command merging between families with the same name across
   layers
2. name suffixes to encode storage level
3. provider-specific hardcoding in AXF core beyond the intentionally tiny
   framework-owned example surface
4. immediate pack-manager design beyond supporting normal layered
   discovery

## Commander Build Guidance

Build toward these rules in order:

1. family name is semantic identity
2. layer decides precedence
3. same-name family shadowing is whole-family
4. command materialization is the narrow override mechanism
5. shared packs are optional and should not be required core identity
6. core should converge toward the smallest deliberate built-in surface
