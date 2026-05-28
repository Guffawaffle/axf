# AXF Foundational Design Note

## Status

Draft foundation

## Purpose

This is a foundation note, not an ADR.

It does not record one isolated architecture decision. It establishes the starting thesis, boundaries, sequencing, and design guardrails for AXF as Agent eXoskeleton Framework.

## Thesis

AXF gives teams a framework for building workspace-native agent exoskeletons: small, self-describing capabilities that encode how each codebase is built, tested, searched, diagnosed, and operated safely.

The goal is not to automate judgment. The goal is to compress repeated local ceremony into reliable workspace capabilities, so agents can spend more attention on the actual problem.

AXF does not ship a single fixed workflow or the repo-specific capabilities themselves. AXF ships the framework and control plane for declaring, generating, and evolving those workspace-owned capabilities safely.

## Core problem

A single launcher can easily be asked to carry too many responsibilities:

- shortcut launcher
- global command bucket
- repo-specific wrapper
- workflow glue
- AI affordance layer
- future platform concept

That leads to ambiguity around:

- what system is being invoked
- who owns a command
- what scope applies
- what output is expected
- whether a generated extension is trusted

## Strategic direction

AXF should stay a framework host with a small, deliberate surface.

That means:

1. AXF owns launch, routing, manifests, scaffolding, and lifecycle gates.
2. Workspaces and toolspaces own domain-specific capabilities.
3. Modules can be mounted globally or inside toolspaces.
4. Capabilities are typed, inspectable, and fully qualified internally.
5. Agents extend axf only through declared contracts.

## Roles and boundaries

### AXF

AXF is the:

- launcher
- runtime host
- resolver
- manifest loader
- scaffolding system
- capability router
- lifecycle gate

### Providers

Providers are execution targets, not the framework itself.

Providers may be:

- in-process handlers
- CLIs on PATH
- repo-local binaries
- future remote surfaces

AXF may integrate with many providers, but no single provider should
define the runtime model, manifest vocabulary, or lifecycle rules.

## Non-goals

AXF v0 is not:

- a bag of shell aliases
- a dumping ground for every script
- "agents can build whatever they want"
- a migration vehicle for adjacent projects
- a reason to flatten all commands into one namespace
- a replacement for provider-native tooling

## Key rule

Build AXF first.
Then build real toolspaces on top of AXF once the framework is stable.

Not the other way around.

## Why broader adoption is intentionally deferred

Higher-risk adoption should wait until AXF has been battle-tested in
lower-risk spaces.

That means:

- no work-first design pressure
- no immediate migration expectations
- no forcing enterprise-ish workflow needs onto the first version

This is important. If AXF gets shaped first by the most constrained
environments, the framework will likely overfit too early.

## North star statement

AXF provides the constrained, mountable framework for a
workspace-native agent exoskeleton: scoped defaults, policies,
capability resolution, and lifecycle gates for capabilities owned by the
workspace or toolspace.
