import { isImplemented, isKnown } from "./policy.js";
import { detectFamilyDrift } from "./drift.js";

export function inspectRegistry(registry, { adapters } = {}) {
  const issues = [...registry.loadIssues];

  // Mount referential integrity (validators don't see the cross-toolspace world).
  for (const toolspace of registry.toolspaces.values()) {
    for (const [moduleName, mount] of Object.entries(
      toolspace.moduleMounts ?? {},
    )) {
      for (const capabilityPath of mount.capabilities ?? []) {
        const sourceId = `${mount.source}.${capabilityPath}`;
        if (!registry.getCapability(sourceId)) {
          issues.push({
            severity: "error",
            message: `${toolspace.toolspace}.${moduleName}.${capabilityPath} points at missing source ${sourceId}`,
          });
        }
      }
    }
  }

  // Duplicate id detection (last-wins is a footgun).
  // The registry already deduplicates via Map; we re-scan the loaded files
  // by path to catch silent overrides only when the same id appears twice.
  // Skipped here because Map storage erased it; reported via load issues
  // when strict mode rejects duplicates is a future improvement.

  // Adapter availability for declared capabilities.
  if (adapters) {
    const seenTypes = new Set();
    for (const capability of registry.capabilities.values()) {
      if (capability.adapterType) seenTypes.add(capability.adapterType);
    }
    for (const type of seenTypes) {
      if (!adapters.get(type)) {
        issues.push({
          severity: "error",
          message: `no adapter loaded for declared adapterType '${type}'`,
        });
      }
    }
    issues.push(...adapters.loadIssues);

    // Toolspace-private adapter shadowing & orphan detection.
    for (const [ts, m] of adapters.toolspaceTypes ?? new Map()) {
      if (!registry.hasToolspace(ts)) {
        issues.push({
          severity: "warning",
          message: `toolspaces/${ts}/adapters/ holds adapters but no toolspace mount declares '${ts}'`,
        });
      }
      for (const type of m.keys()) {
        if (adapters.types.has(type)) {
          issues.push({
            severity: "warning",
            message: `toolspace '${ts}' private type-adapter '${type}' shadows the global type-adapter '${type}'`,
          });
        }
      }
    }
    for (const [ts, m] of adapters.toolspaceProviders ?? new Map()) {
      if (!registry.hasToolspace(ts)) {
        issues.push({
          severity: "warning",
          message: `toolspaces/${ts}/adapters/ holds providers but no toolspace mount declares '${ts}'`,
        });
      }
      for (const name of m.keys()) {
        if (adapters.providers.has(name)) {
          issues.push({
            severity: "warning",
            message: `toolspace '${ts}' private provider '${name}' shadows the global provider '${name}'`,
          });
        }
      }
    }
  }

  // Policy declared-but-unenforced warnings.
  const seenPolicyWarnings = new Set();
  const allCapabilities = [
    ...registry.capabilities.values(),
    ...registry.listMountedCapabilities(),
  ];
  for (const capability of allCapabilities) {
    for (const name of capability.policies ?? []) {
      if (!isKnown(name)) {
        const key = `unknown:${name}:${capability.id}`;
        if (seenPolicyWarnings.has(key)) continue;
        seenPolicyWarnings.add(key);
        issues.push({
          severity: "error",
          message: `${capability.id} declares unknown policy '${name}'`,
        });
        continue;
      }
      if (!isImplemented(name)) {
        const key = `unenforced:${name}`;
        if (seenPolicyWarnings.has(key)) continue;
        seenPolicyWarnings.add(key);
        issues.push({
          severity: "warning",
          message: `policy '${name}' is declared but has no runtime implementation yet`,
        });
      }
    }
  }

  return {
    capabilityCount: registry.capabilities.size,
    toolspaceCount: registry.toolspaces.size,
    manifestCount: registry.files.length,
    rejectedCount: registry.rejected.length,
    adapterCount: adapters ? adapters.adapters.size : 0,
    adaptersByType: adapters ? collectAdapterProvenance(adapters) : [],
    familyCount: registry.families?.length ?? 0,
    families: summarizeFamilies(registry.families ?? []),
    shadowedFamilies: summarizeFamilies(registry.shadowedFamilies ?? []),
    familyConflicts: registry.familyConflicts ?? [],
    drift: collectDrift(registry, issues),
    issues,
  };
}

function summarizeFamilies(families) {
  return families.map((family) => ({
    family: family.family,
    scope: family.scope ?? "global",
    layer: family.layer ?? family.provenance ?? null,
    provenance: family.provenance ?? null,
    manifestPath: family.manifestPath,
    shadowedBy: family.shadowedBy ?? null,
  }));
}

function collectDrift(registry, issues) {
  const drift = detectFamilyDrift(registry);
  for (const item of drift) {
    issues.push({
      severity: item.kind === "missing-source" ? "error" : "warning",
      message: `drift: ${item.capabilityId}: ${item.message}`,
    });
  }
  return drift;
}

function collectAdapterProvenance(adapters) {
  const out = [];
  for (const r of adapters.types.values()) {
    out.push({
      kind: "type-adapter",
      type: r.manifest.type,
      provenance: r.provenance,
      manifestPath: r.manifestPath,
    });
  }
  for (const r of adapters.providers.values()) {
    out.push({
      kind: "provider",
      name: r.manifest.name,
      composes: r.manifest.composes,
      provenance: r.provenance,
      manifestPath: r.manifestPath,
    });
  }
  for (const [ts, m] of adapters.toolspaceTypes ?? new Map()) {
    for (const r of m.values()) {
      out.push({
        kind: "type-adapter",
        type: r.manifest.type,
        provenance: r.provenance ?? `toolspace:${ts}`,
        manifestPath: r.manifestPath,
      });
    }
  }
  for (const [ts, m] of adapters.toolspaceProviders ?? new Map()) {
    for (const r of m.values()) {
      out.push({
        kind: "provider",
        name: r.manifest.name,
        composes: r.manifest.composes,
        provenance: r.provenance ?? `toolspace:${ts}`,
        manifestPath: r.manifestPath,
      });
    }
  }
  return out;
}
