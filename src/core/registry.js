import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxError, UnknownCapabilityError } from "./errors.js";
import { parseCapabilityInput } from "./path-model.js";
import { synthesizeMountedCapability } from "./resolver.js";
import {
  validateCapabilityManifest,
  validateToolspaceManifest,
} from "./manifest-validator.js";
import { loadFamilies, synthesizeFamilyCapabilities } from "./family-loader.js";

export const SUPPORTED_MANIFEST_VERSIONS = new Set(["axf/v0"]);

export const MACHINE_ROOT_ENV = "AXF_MACHINE_ROOT";

export const REGISTRY_LAYER_PRECEDENCE = Object.freeze({
  framework: 10,
  machine: 20,
  project: 30,
});

export const FRAMEWORK_MANIFESTS_ROOT = fileURLToPath(
  new URL("../../manifests/", import.meta.url),
);

export async function createRegistry({
  rootDir,
  strict = true,
  enableFrameworkGlobals = false,
  enableFrameworkBuiltins = enableFrameworkGlobals,
  frameworkManifestsRoot = FRAMEWORK_MANIFESTS_ROOT,
  machineRoot = null,
  machineRoots = [],
} = {}) {
  const manifestRoot = path.join(rootDir, "manifests");
  const registry = new ManifestRegistry(rootDir, { strict });

  if (enableFrameworkBuiltins && frameworkManifestsRoot) {
    const sameRoot = await pathsEqual(manifestRoot, frameworkManifestsRoot);
    if (!sameRoot) {
      await registry.loadLayer({
        manifestsRoot: frameworkManifestsRoot,
        layerRoot: path.dirname(frameworkManifestsRoot),
        layer: "framework",
      });
    }
  }

  for (const root of normalizeRoots([machineRoot, ...machineRoots])) {
    const machineManifestsRoot = path.join(root, "manifests");
    const sameAsProject = await pathsEqual(manifestRoot, machineManifestsRoot);
    const sameAsFramework = frameworkManifestsRoot
      ? await pathsEqual(frameworkManifestsRoot, machineManifestsRoot)
      : false;
    if (sameAsProject || sameAsFramework) continue;
    await registry.loadLayer({
      manifestsRoot: machineManifestsRoot,
      layerRoot: root,
      layer: "machine",
    });
  }

  await registry.loadLayer({
    manifestsRoot: manifestRoot,
    layerRoot: rootDir,
    layer: "project",
  });
  registry.finalizeFamilies();
  return registry;
}

function normalizeRoots(roots) {
  return roots.filter(Boolean).map((root) => path.resolve(root));
}

function compareLayers(left, right) {
  return (
    (REGISTRY_LAYER_PRECEDENCE[left] ?? 0) -
    (REGISTRY_LAYER_PRECEDENCE[right] ?? 0)
  );
}

function formatLayerPath(relativePath, layer) {
  return layer === "project" ? relativePath : `${layer}:${relativePath}`;
}

function familyKey(family) {
  return `${family.scope ?? "global"}:${family.family}`;
}

function resolveFamilyCandidates(candidates) {
  const byKey = new Map();
  for (const family of candidates) {
    const key = familyKey(family);
    const list = byKey.get(key) ?? [];
    list.push(family);
    byKey.set(key, list);
  }

  const effective = [];
  const shadowed = [];
  const conflicts = [];

  for (const list of byKey.values()) {
    const sorted = [...list].sort((left, right) => {
      const precedence = compareLayers(right.layer, left.layer);
      if (precedence !== 0) return precedence;
      return left.manifestPath.localeCompare(right.manifestPath);
    });
    const winningLayer = sorted[0].layer;
    const winners = sorted.filter((family) => family.layer === winningLayer);
    if (winners.length > 1) {
      conflicts.push({
        family: sorted[0].family,
        scope: sorted[0].scope ?? "global",
        layer: winningLayer,
        manifestPaths: winners.map((family) => family.manifestPath).sort(),
      });
      shadowed.push(
        ...sorted.filter((family) => family.layer !== winningLayer),
      );
      continue;
    }

    const [winner] = winners;
    effective.push(winner);
    shadowed.push(
      ...sorted
        .filter((family) => family !== winner)
        .map((family) => ({
          ...family,
          shadowedBy: {
            family: winner.family,
            scope: winner.scope ?? "global",
            layer: winner.layer,
            manifestPath: winner.manifestPath,
          },
        })),
    );
  }

  effective.sort((left, right) => {
    const familyOrder = left.family.localeCompare(right.family);
    if (familyOrder !== 0) return familyOrder;
    return (left.scope ?? "global").localeCompare(right.scope ?? "global");
  });
  shadowed.sort((left, right) =>
    left.manifestPath.localeCompare(right.manifestPath),
  );

  return { effective, shadowed, conflicts };
}

async function pathsEqual(a, b) {
  try {
    const [ra, rb] = await Promise.all([realpath(a), realpath(b)]);
    return ra === rb;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export class ManifestRegistry {
  constructor(rootDir, { strict = true } = {}) {
    this.rootDir = rootDir;
    this.strict = strict;
    this.capabilities = new Map();
    this.capabilityLayers = new Map();
    this.toolspaces = new Map();
    this.families = [];
    this.familyCandidates = [];
    this.shadowedFamilies = [];
    this.familyConflicts = [];
    this.files = [];
    this.projectFiles = [];
    this.loadIssues = [];
    this.rejected = [];
  }

  async loadLayer({ manifestsRoot, layerRoot, layer }) {
    await this.loadFrom(manifestsRoot, { layerRoot, layer });
    await this.loadFamiliesFrom(path.join(manifestsRoot, "families"), {
      layerRoot,
      layer,
    });
  }

  async loadFrom(
    manifestRoot,
    { layerRoot = this.rootDir, layer = "project" } = {},
  ) {
    const files = await listJsonFiles(manifestRoot, { skipDirs: ["families"] });
    this.files.push(...files);
    if (layer === "project") {
      this.projectFiles.push(...files);
    }

    for (const filePath of files) {
      await this.loadFile(filePath, { layerRoot, layer });
    }
  }

  async loadFamiliesFrom(
    familiesRoot,
    { layerRoot = this.rootDir, layer = "project" } = {},
  ) {
    const { families, issues } = await loadFamilies({
      familiesRoot,
      rootDir: layerRoot,
    });
    this.loadIssues.push(...issues);
    for (const family of families) {
      this.familyCandidates.push({
        ...family,
        manifestPath: formatLayerPath(family.manifestPath, layer),
        layer,
        provenance: layer,
      });
    }
  }

  finalizeFamilies() {
    const { effective, shadowed, conflicts } = resolveFamilyCandidates(
      this.familyCandidates,
    );
    this.families = effective;
    this.shadowedFamilies = shadowed;
    this.familyConflicts = conflicts;
    this.loadIssues.push(
      ...conflicts.map((conflict) => ({
        severity: "error",
        message: `family conflict: ${conflict.layer} layer declares '${conflict.family}' more than once (${conflict.manifestPaths.join(", ")})`,
      })),
    );

    for (const family of effective) {
      const protectedIds = new Set(
        [...this.capabilities.keys()].filter(
          (id) =>
            compareLayers(this.capabilityLayers.get(id), family.layer) >= 0,
        ),
      );
      const synthesized = synthesizeFamilyCapabilities(family, {
        existingIds: protectedIds,
      });
      for (const cap of synthesized) {
        const existingLayer = this.capabilityLayers.get(cap.id);
        if (existingLayer && compareLayers(existingLayer, family.layer) >= 0) {
          continue;
        }
        this.capabilities.set(cap.id, cap);
        this.capabilityLayers.set(cap.id, family.layer);
      }
    }
    // Mark capabilities whose id matches a family entry: they are
    // materialized overrides of an imported command.
    for (const family of effective) {
      const scope = family.scope ?? "global";
      const idPrefix = scope === "workspace-local" ? "workspace" : "global";
      for (const cmdKey of Object.keys(family.commands)) {
        const id = `${idPrefix}.${family.family}.${cmdKey}`;
        const declared = this.capabilities.get(id);
        if (declared && declared.origin !== "imported") {
          declared.origin = "materialized";
          declared.sourceFamily = {
            family: family.family,
            command: cmdKey,
            manifestPath: family.manifestPath,
            ...(declared.sourceFamily ?? {}),
            layer: family.layer,
          };
        }
      }
    }
  }

  async loadFile(
    filePath,
    { layerRoot = this.rootDir, layer = "project" } = {},
  ) {
    const relativePath = formatLayerPath(
      path.relative(layerRoot, filePath),
      layer,
    );
    let manifest;
    try {
      manifest = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      this.loadIssues.push({
        severity: "error",
        message: `${relativePath} failed to parse: ${error.message}`,
      });
      this.rejected.push(relativePath);
      return;
    }

    if (manifest.id) {
      const issues = validateCapabilityManifest(manifest, relativePath);
      if (this.strict && issues.some((i) => i.severity === "error")) {
        this.loadIssues.push(...issues);
        this.rejected.push(relativePath);
        return;
      }
      this.loadIssues.push(...issues);
      this.setCapability(
        manifest.id,
        {
          ...manifest,
          manifestPath: relativePath,
          layer,
          provenance: layer,
        },
        layer,
      );
      return;
    }

    if (manifest.toolspace) {
      const issues = validateToolspaceManifest(manifest, relativePath);
      if (this.strict && issues.some((i) => i.severity === "error")) {
        this.loadIssues.push(...issues);
        this.rejected.push(relativePath);
        return;
      }
      this.loadIssues.push(...issues);
      this.toolspaces.set(manifest.toolspace, {
        ...manifest,
        manifestPath: relativePath,
        layer,
        provenance: layer,
      });
      return;
    }

    this.loadIssues.push({
      severity: "error",
      message: `${relativePath} is not a recognized axf manifest (no 'id' or 'toolspace' field)`,
    });
    this.rejected.push(relativePath);
  }

  setCapability(id, capability, layer) {
    const existingLayer = this.capabilityLayers.get(id);
    if (existingLayer && compareLayers(existingLayer, layer) === 0) {
      this.loadIssues.push({
        severity: "error",
        message: `capability conflict: ${layer} layer declares '${id}' more than once`,
      });
      return;
    }
    if (existingLayer && compareLayers(existingLayer, layer) > 0) {
      return;
    }
    this.capabilities.set(id, capability);
    this.capabilityLayers.set(id, layer);
  }

  hasToolspace(name) {
    return this.toolspaces.has(name);
  }

  getToolspace(name) {
    return this.toolspaces.get(name);
  }

  getCapability(id) {
    return this.capabilities.get(id);
  }

  listCapabilities({ includeDrafts = false } = {}) {
    const declared = [...this.capabilities.values()];
    const mounted = this.listMountedCapabilities();
    return [...declared, ...mounted]
      .filter(
        (capability) => includeDrafts || capability.lifecycleState === "active",
      )
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  listMountedCapabilities() {
    const mounted = [];
    for (const toolspace of this.toolspaces.values()) {
      for (const [moduleName, mount] of Object.entries(
        toolspace.moduleMounts ?? {},
      )) {
        for (const capabilityPath of mount.capabilities ?? []) {
          const sourceId = `${mount.source}.${capabilityPath}`;
          const sourceCapability = this.capabilities.get(sourceId);
          if (!sourceCapability) continue;
          mounted.push(
            synthesizeMountedCapability({
              toolspace,
              moduleName,
              mount,
              capabilityPath,
              sourceCapability,
            }),
          );
        }
      }
    }
    return mounted;
  }

  resolveInspectable(inputTokens) {
    const parsed = parseCapabilityInput(this, inputTokens);

    if (parsed.kind === "id") {
      const capability =
        this.capabilities.get(parsed.id) ?? this.findMountedById(parsed.id);
      if (!capability) {
        throw this.unknownCapabilityError(parsed.id);
      }
      return {
        input: parsed,
        capability,
        injectedDefaults: capability.defaults ?? {},
      };
    }

    if (parsed.scope === "global") {
      const id = `global.${parsed.module}.${parsed.capabilityPath}`;
      const capability = this.capabilities.get(id);
      if (capability) {
        return {
          input: parsed,
          capability,
          injectedDefaults: capability.defaults ?? {},
        };
      }
      // Fallback to workspace-local: workspace.<module>.<cap>
      const wsId = `workspace.${parsed.module}.${parsed.capabilityPath}`;
      const wsCapability = this.capabilities.get(wsId);
      if (wsCapability) {
        return {
          input: { ...parsed, scope: "workspace-local" },
          capability: wsCapability,
          injectedDefaults: wsCapability.defaults ?? {},
        };
      }
      throw this.unknownCapabilityError(id, { alsoTried: [wsId] });
    }

    const toolspace = this.toolspaces.get(parsed.toolspace);
    const mount = toolspace?.moduleMounts?.[parsed.module];
    if (!toolspace || !mount) {
      throw new AxError(
        `unknown mount '${parsed.toolspace}.${parsed.module}'`,
        2,
      );
    }

    const sourceId = `${mount.source}.${parsed.capabilityPath}`;
    const sourceCapability = this.capabilities.get(sourceId);
    if (!sourceCapability) {
      throw new AxError(
        `mount source capability '${sourceId}' is not declared`,
        2,
      );
    }

    const capability = synthesizeMountedCapability({
      toolspace,
      moduleName: parsed.module,
      mount,
      capabilityPath: parsed.capabilityPath,
      sourceCapability,
    });

    return {
      input: parsed,
      capability,
      injectedDefaults: mount.defaults ?? {},
    };
  }

  findMountedById(id) {
    return this.listMountedCapabilities().find(
      (capability) => capability.id === id,
    );
  }

  unknownCapabilityError(requestedId, { alsoTried = [] } = {}) {
    const suggestions = this.findCapabilitiesByPrefix(requestedId);
    const triedText =
      alsoTried.length > 0 ? ` (also tried '${alsoTried.join("', '")}')` : "";

    if (suggestions.length === 0) {
      return new UnknownCapabilityError(
        `unknown capability '${requestedId}'${triedText}`,
        {
          requestedId,
          alsoTried,
          suggestions: [],
        },
      );
    }

    const suggestionIds = suggestions.map((capability) => capability.id);
    const suggestionText = suggestionIds.join(", ");
    return new UnknownCapabilityError(
      `unknown capability '${requestedId}'${triedText}; '${requestedId}' is a capability prefix, not a runnable capability. Available capabilities: ${suggestionText}`,
      {
        requestedId,
        alsoTried,
        prefix: requestedId,
        reason: "capability_prefix",
        suggestions: suggestions.map((capability) => ({
          id: capability.id,
          summary: capability.summary,
          lifecycleState: capability.lifecycleState,
          sideEffects: capability.sideEffects,
        })),
        nextSteps: [
          {
            action: "inspect_capability",
            description:
              "Inspect one of the suggested runnable capability ids.",
            example: suggestionIds[0],
          },
          {
            action: "run_capability",
            description:
              "Run one of the suggested capability ids after inspection.",
            example: suggestionIds[0],
          },
        ],
      },
    );
  }

  findCapabilitiesByPrefix(prefix) {
    const prefixWithDot = `${prefix}.`;
    return [...this.capabilities.values(), ...this.listMountedCapabilities()]
      .filter((capability) => capability.id.startsWith(prefixWithDot))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

async function listJsonFiles(dirPath, { skipDirs = [] } = {}) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const results = [];
  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      results.push(...(await listJsonFiles(childPath, { skipDirs })));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      // Family files use a distinct suffix so listJsonFiles excludes them.
      if (entry.name.endsWith(".family.json")) continue;
      results.push(childPath);
    }
  }
  return results;
}
