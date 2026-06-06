// Family imports.
//
// A "command family" is a provider's existing command vocabulary
// (git, gh, majel, kubectl, ...). Authoring one capability manifest per
// command is tedious and brittle; family manifests describe the whole
// family declaratively and the registry synthesizes capabilities from
// them at load time.
//
// Two consumption modes are supported:
//
//   imported       The family manifest is the source of truth. The
//                  registry creates synthetic capabilities in memory.
//                  Cheap, reversible, no per-command files to maintain.
//
//   materialized   A specific command is written out as a real
//                  capability manifest under manifests/capabilities/.
//                  The materialized file shadows the family entry and
//                  becomes hand-editable. Drift between the two is
//                  detectable (see doctor / drift detection).
//
// Argument mapping (issue #1) lives here too: each command synthesizes
// an `argMap` (public arg name -> provider flag) using a priority
// chain of explicit per-arg overrides, family-level argMap, and the
// declared providerArgStyle ("double-dash-kebab" by default,
// "powershell-pascal" for PowerShell-style providers).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { LIFECYCLE_STATES } from "./manifest-validator.js";

const SUPPORTED_FAMILY_VERSIONS = new Set(["axf/v0"]);
const SUPPORTED_ARG_STYLES = new Set([
  "double-dash-kebab",
  "powershell-pascal",
]);
const SUPPORTED_SCOPES = new Set(["global", "workspace-local"]);
const LIFECYCLE_ALIASES = new Map([["stable", "active"]]);

const DESCRIPTIVE_METADATA_KEYS = ["warnings", "details"];

// Args the framework reserves for itself. A family or capability that
// declares one of these as a public arg is rejected, because the CLI
// would have no way to disambiguate them at the command line.
export const RESERVED_ARG_NAMES = new Set([
  "json",
  "workspace",
  "any-lifecycle",
  "allow-draft",
  "include-drafts",
  "all",
]);

export async function loadFamilies({ familiesRoot, rootDir }) {
  const families = [];
  const issues = [];

  let entries;
  try {
    entries = await readdir(familiesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { families, issues };
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".family.json")) continue;
    const filePath = path.join(familiesRoot, entry.name);
    const relativePath = path.relative(rootDir, filePath);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      issues.push({
        severity: "error",
        message: `${relativePath} failed to parse: ${error.message}`,
      });
      continue;
    }
    const { manifest: normalized, issues: validation } =
      normalizeFamilyManifest(manifest, relativePath);
    if (validation.some((i) => i.severity === "error")) {
      issues.push(...validation);
      continue;
    }
    issues.push(...validation);
    families.push({ ...normalized, manifestPath: relativePath });
  }
  return { families, issues };
}

export function validateFamilyManifest(manifest, label) {
  return normalizeFamilyManifest(manifest, label).issues;
}

function normalizeFamilyManifest(manifest, label) {
  const normalized = {
    ...manifest,
    commands: manifest.commands
      ? Object.fromEntries(
          Object.entries(manifest.commands).map(([cmdKey, cmd]) => [
            cmdKey,
            { ...cmd },
          ]),
        )
      : manifest.commands,
  };
  const issues = [];
  if (!SUPPORTED_FAMILY_VERSIONS.has(normalized.manifestVersion)) {
    issues.push({
      severity: "error",
      message: `${label}: unsupported family manifestVersion '${normalized.manifestVersion}'`,
    });
  }
  if (!normalized.family || !/^[a-z][a-z0-9-]*$/.test(normalized.family)) {
    issues.push({
      severity: "error",
      message: `${label}: family must be a kebab-case name`,
    });
  }
  if (!normalized.adapterType) {
    issues.push({
      severity: "error",
      message: `${label}: family missing 'adapterType'`,
    });
  }
  if (normalized.scope && !SUPPORTED_SCOPES.has(normalized.scope)) {
    issues.push({
      severity: "error",
      message: `${label}: family scope '${normalized.scope}' must be 'global' or 'workspace-local'`,
    });
  }
  if (
    normalized.providerArgStyle !== undefined &&
    !SUPPORTED_ARG_STYLES.has(normalized.providerArgStyle)
  ) {
    issues.push({
      severity: "error",
      message: `${label}: providerArgStyle '${normalized.providerArgStyle}' is not supported (use 'double-dash-kebab' or 'powershell-pascal')`,
    });
  }
  const familyLifecycle = canonicalizeLifecycleState(normalized.lifecycleState);
  if (normalized.lifecycleState !== undefined && familyLifecycle === null) {
    issues.push({
      severity: "error",
      message: `${label}: invalid lifecycleState '${normalized.lifecycleState}'`,
    });
  } else if (familyLifecycle && familyLifecycle !== normalized.lifecycleState) {
    issues.push({
      severity: "warning",
      message: `${label}: lifecycleState '${normalized.lifecycleState}' normalized to '${familyLifecycle}'`,
    });
    normalized.lifecycleState = familyLifecycle;
  }

  if (
    !normalized.commands ||
    typeof normalized.commands !== "object" ||
    Array.isArray(normalized.commands)
  ) {
    issues.push({
      severity: "error",
      message: `${label}: family requires a 'commands' object`,
    });
    return { manifest: normalized, issues };
  }
  for (const [cmdKey, cmd] of Object.entries(normalized.commands)) {
    if (!/^[a-z][a-z0-9-]*$/.test(cmdKey)) {
      issues.push({
        severity: "error",
        message: `${label}: command key '${cmdKey}' must be kebab-case`,
      });
    }
    const commandLifecycle = canonicalizeLifecycleState(cmd.lifecycleState);
    if (cmd.lifecycleState !== undefined && commandLifecycle === null) {
      issues.push({
        severity: "error",
        message: `${label}: command '${cmdKey}' has invalid lifecycleState '${cmd.lifecycleState}'`,
      });
    } else if (commandLifecycle && commandLifecycle !== cmd.lifecycleState) {
      issues.push({
        severity: "warning",
        message: `${label}: command '${cmdKey}' lifecycleState '${cmd.lifecycleState}' normalized to '${commandLifecycle}'`,
      });
      cmd.lifecycleState = commandLifecycle;
    }
    if (cmd.args) {
      for (const argName of Object.keys(cmd.args)) {
        if (RESERVED_ARG_NAMES.has(argName)) {
          issues.push({
            severity: "error",
            message: `${label}: command '${cmdKey}' arg '${argName}' collides with a framework-reserved name`,
          });
        }
      }
    }
  }
  return { manifest: normalized, issues };
}

// Build the capability records the registry exposes for a family.
// Skips commands whose synthesized id is already declared (materialized).
export function synthesizeFamilyCapabilities(
  family,
  { existingIds, origin = "imported" },
) {
  const out = [];
  const scope = family.scope ?? "global";
  const idPrefix = scope === "workspace-local" ? "workspace" : "global";
  for (const [cmdKey, cmd] of Object.entries(family.commands)) {
    const id = `${idPrefix}.${family.family}.${cmdKey}`;
    if (existingIds.has(id)) continue; // materialized override wins
    const argMap = computeArgMap(cmd.args ?? {}, family);
    const capability = {
      manifestVersion: "axf/v0",
      id,
      summary: cmd.summary ?? `${family.family} ${cmdKey}`,
      provider: family.provider ?? family.family,
      adapterType: family.adapterType,
      providerAdapter: cmd.providerAdapter ?? family.providerAdapter,
      executionTarget: cmd.executionTarget ?? family.executionTarget ?? {},
      argsSchema: cmd.argsSchema ?? buildArgsSchema(cmd.args ?? {}),
      outputModes: cmd.outputModes ?? family.outputModes ?? ["text"],
      sideEffects: cmd.sideEffects ?? family.sideEffects ?? "unknown",
      scope,
      lifecycleState: cmd.lifecycleState ?? family.lifecycleState ?? "active",
      defaults: cmd.defaults ?? {},
      policies: cmd.policies ?? family.policies ?? [],
      owner: cmd.owner ?? family.owner ?? "imported",
      argMap,
      sourceFamily: {
        family: family.family,
        command: cmdKey,
        manifestPath: family.manifestPath,
        layer: family.layer,
      },
      manifestPath: family.manifestPath,
      origin,
      layer: family.layer,
      provenance: family.provenance,
    };
    copyDescriptiveMetadata(capability, cmd);
    out.push(capability);
  }
  return out;
}

export function copyDescriptiveMetadata(target, ...sources) {
  for (const key of DESCRIPTIVE_METADATA_KEYS) {
    const source = sources.find((candidate) => candidate?.[key] !== undefined);
    if (source) {
      target[key] = source[key];
    }
  }
  return target;
}

// Build a minimal argsSchema from an args descriptor. The family format
// keeps the args description compact; the registry surfaces a real
// JSON Schema so existing code paths (validators, inspect output)
// continue to work unchanged.
function buildArgsSchema(args) {
  const properties = {};
  const required = [];
  for (const [name, spec] of Object.entries(args)) {
    properties[name] = { type: spec.type ?? "string" };
    if (spec.description) properties[name].description = spec.description;
    if (spec.required) required.push(name);
  }
  const schema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

export function computeArgMap(args, family) {
  const style = family.providerArgStyle ?? "double-dash-kebab";
  const familyOverrides = family.argMap ?? {};
  const map = {};
  for (const [name, spec] of Object.entries(args)) {
    const explicit = spec.providerFlag ?? familyOverrides[name];
    map[name] = explicit ?? deriveFlag(name, style);
  }
  return map;
}

export function deriveFlag(name, style) {
  if (style === "powershell-pascal") {
    return `-${toPascal(name)}`;
  }
  return `--${toKebab(name)}`;
}

function toKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_+/g, "-")
    .toLowerCase();
}

function toPascal(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function canonicalizeLifecycleState(value) {
  if (value === undefined) return undefined;
  const normalized = LIFECYCLE_ALIASES.get(value) ?? value;
  return LIFECYCLE_STATES.has(normalized) ? normalized : null;
}
