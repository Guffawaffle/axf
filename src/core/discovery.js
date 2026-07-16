import { readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_COMPACT_LIMIT = 25;
export const DEFAULT_GUIDE_LIMIT = 12;
export const MAX_DISCOVERY_LIMIT = 100;

const INTENT_ALIASES = new Map([
  ["context", "session-start"],
  ["session", "session-start"],
  ["session-start", "session-start"],
  ["check", "validation"],
  ["validate", "validation"],
  ["validation", "validation"],
  ["handoff", "handoff"],
]);

const INTENT_LABELS = Object.freeze({
  "session-start": "context",
  validation: "check",
  handoff: "handoff",
});

const INTENT_ORDER = new Map([
  ["session-start", 10],
  ["validation", 20],
  ["handoff", 30],
]);

export function normalizeIntent(value) {
  if (value === null || value === undefined || value === "") return null;
  return INTENT_ALIASES.get(String(value).trim().toLowerCase()) ?? null;
}

export function normalizeDiscoveryLimit(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DISCOVERY_LIMIT) {
    throw new Error(
      `limit must be an integer between 1 and ${MAX_DISCOVERY_LIMIT}`,
    );
  }
  return parsed;
}

export function selectCapabilities(
  registry,
  {
    includeDrafts = false,
    search = null,
    sideEffects = null,
    compact = false,
    limit = compact ? DEFAULT_COMPACT_LIMIT : null,
  } = {},
) {
  const all = registry.listCapabilities({ includeDrafts });
  const searched = all.filter((capability) =>
    matchesSearch(capability, search),
  );
  const filtered = searched.filter((capability) =>
    matchesSideEffects(capability, sideEffects),
  );
  const normalizedLimit =
    limit === null || limit === undefined
      ? null
      : normalizeDiscoveryLimit(limit, DEFAULT_COMPACT_LIMIT);
  const selected = normalizedLimit ? filtered.slice(0, normalizedLimit) : filtered;

  return {
    capabilities: compact
      ? selected.map(summarizeCapabilityForDiscovery)
      : selected,
    total: filtered.length,
    count: selected.length,
    truncated: selected.length < filtered.length,
    filters: {
      search: search || null,
      sideEffects: sideEffects || null,
      includeDrafts: Boolean(includeDrafts),
      compact: Boolean(compact),
      limit: normalizedLimit,
    },
  };
}

export function summarizeCapabilityForDiscovery(capability) {
  const provenance = capabilityProvenance(capability);
  return {
    id: capability.id,
    summary: capability.summary,
    scope: capability.scope,
    lifecycleState: capability.lifecycleState,
    sideEffects: capability.sideEffects,
    sourceKind: provenance.kind,
    provenance,
  };
}

export function capabilityProvenance(capability) {
  let kind = "project-manifest";
  if (capability.sourceCapabilityId) kind = "mounted";
  else if (capability.origin === "imported") kind = "imported-family";
  else if (capability.origin === "materialized") kind = "materialized-family";
  else if (capability.layer === "framework") kind = "framework";
  else if (capability.layer === "machine") kind = "machine";
  else if (capability.scope === "workspace-local") kind = "workspace-local";

  return {
    kind,
    layer: capability.layer ?? capability.provenance ?? "project",
    manifestPath: capability.manifestPath ?? null,
    owner: capability.owner ?? null,
    provider: capability.provider ?? null,
    family: capability.sourceFamily
      ? {
          family: capability.sourceFamily.family,
          command: capability.sourceFamily.command,
          layer: capability.sourceFamily.layer ?? capability.layer ?? null,
          manifestPath: capability.sourceFamily.manifestPath ?? null,
        }
      : null,
    mount: capability.mount ?? null,
    sourceCapabilityId: capability.sourceCapabilityId ?? null,
  };
}

export function explainCapability(
  registry,
  queryValue,
  { includeDrafts = false, workspaceSummary = null } = {},
) {
  const tokens = Array.isArray(queryValue)
    ? queryValue.filter(Boolean)
    : [String(queryValue ?? "").trim()].filter(Boolean);
  const query = tokens.join(" ");
  if (!query) {
    throw new Error("explain requires a capability id, path, family, or search term");
  }

  try {
    const resolved = registry.resolveInspectable(tokens);
    const capability = resolved.capability;
    const reasons = [];
    let filtered = false;
    if (capability.lifecycleState !== "active" && !includeDrafts) {
      filtered = true;
      reasons.push({
        code: "lifecycle_filtered",
        message: `capability is ${capability.lifecycleState}; include non-active lifecycle states to discover it`,
      });
    }
    const requiresBinding =
      capability.scope === "workspace-local" ||
      (capability.policies ?? []).includes("require_workspace_binding");
    const executionBinding =
      workspaceSummary?.executionRoot ?? workspaceSummary?.workspace ?? null;
    if (
      requiresBinding &&
      executionBinding &&
      !executionBinding.viaMarker &&
      !executionBinding.markerPresent
    ) {
      filtered = true;
      reasons.push({
        code: "workspace_binding_required",
        message:
          "capability requires a marker-bound execution workspace, but the active execution root is unmarked",
        executionRoot: executionBinding,
      });
    }
    if ((capability.policies ?? []).length > 0) {
      reasons.push({
        code: "policy_requirements",
        message:
          "capability execution remains subject to its declared AXF policies",
        policies: capability.policies,
      });
    }
    if (reasons.length === 0) {
      reasons.push({
        code: "loaded",
        message: "capability is loaded and discoverable in the active registry",
      });
    }
    return {
      query,
      status: filtered ? "filtered" : "available",
      capability: summarizeCapabilityForDiscovery(capability),
      reasons,
      examples: buildCapabilityExamples(capability),
      suggestions: [],
    };
  } catch {
    // Continue through structured absence diagnostics below.
  }

  const candidates = buildQueryCandidates(tokens);
  const allCapabilities = registry.listCapabilities({ includeDrafts: true });
  const prefixMatches = allCapabilities
    .filter((capability) =>
      candidates.some(
        (candidate) =>
          capability.id === candidate || capability.id.startsWith(`${candidate}.`),
      ),
    )
    .slice(0, 10);
  if (prefixMatches.length > 0) {
    return {
      query,
      status: "prefix",
      capability: null,
      reasons: [
        {
          code: "capability_prefix",
          message:
            "the requested value is a capability or family prefix, not a runnable capability id",
        },
      ],
      suggestions: prefixMatches.map(summarizeCapabilityForDiscovery),
    };
  }

  const normalizedQuery = query.toLowerCase();
  const familyQueryParts = normalizedQuery.split(/[.\s]+/).filter(Boolean);
  const familyQueryName = ["global", "workspace"].includes(
    familyQueryParts[0],
  )
    ? familyQueryParts[1]
    : familyQueryParts[0];
  const family = (registry.families ?? []).find(
    (candidate) =>
      candidate.family.toLowerCase() === familyQueryName,
  );
  if (family) {
    const familyCapabilities = allCapabilities
      .filter(
        (capability) => capability.sourceFamily?.family === family.family,
      )
      .slice(0, 10);
    return {
      query,
      status: "family-loaded-command-missing",
      capability: null,
      reasons: [
        {
          code: "family_loaded_command_missing",
          message: `family '${family.family}' is loaded, but the requested command is not declared`,
        },
      ],
      family: {
        name: family.family,
        layer: family.layer,
        manifestPath: family.manifestPath,
      },
      suggestions: familyCapabilities.map(summarizeCapabilityForDiscovery),
    };
  }

  const matchingIssues = (registry.loadIssues ?? [])
    .filter((issue) => issue.message.toLowerCase().includes(normalizedQuery))
    .slice(0, 10);
  const searchSuggestions = selectCapabilities(registry, {
    includeDrafts: true,
    search: query,
    compact: true,
    limit: 10,
  }).capabilities;
  const reasons = [];
  if (matchingIssues.length > 0) {
    reasons.push({
      code: "manifest_load_failure",
      message: "matching manifest or normalization failures were recorded",
      issues: matchingIssues,
    });
  } else {
    reasons.push({
      code: "not_loaded",
      message: "no matching capability, prefix, or loaded family was found",
    });
  }
  if (workspaceSummary) {
    reasons.push({
      code: "workspace_context",
      message: "workspace binding may affect which families and manifests are loaded",
      projectRoot: workspaceSummary.projectRoot ?? null,
      executionRoot: workspaceSummary.executionRoot ?? null,
      notes: workspaceSummary.notes ?? [],
    });
  }

  return {
    query,
    status: "missing",
    capability: null,
    reasons,
    suggestions: searchSuggestions,
  };
}

export async function buildWorkflowGuide(
  registry,
  { projectRoot, intent = null, limit = DEFAULT_GUIDE_LIMIT } = {},
) {
  const normalizedIntent = normalizeIntent(intent);
  if (intent && !normalizedIntent) {
    throw new Error(
      "intent must be context, session-start, check, validation, or handoff",
    );
  }
  const normalizedLimit = normalizeDiscoveryLimit(limit, DEFAULT_GUIDE_LIMIT);
  const { declarations, warnings } = await readWorkspaceRecommendations(
    projectRoot,
  );

  for (const capability of registry.listCapabilities({ includeDrafts: true })) {
    for (const declaredIntent of normalizeIntentList(capability.recommendedFor)) {
      declarations.push({
        intent: declaredIntent,
        capabilityId: capability.id,
        label: null,
        declaredBy: "capability",
        manifestPath: capability.manifestPath ?? null,
      });
    }
  }

  const deduped = new Map();
  for (const declaration of declarations) {
    if (normalizedIntent && declaration.intent !== normalizedIntent) continue;
    const key = `${declaration.intent}:${declaration.capabilityId}`;
    if (!deduped.has(key)) deduped.set(key, declaration);
  }

  const recommendations = [...deduped.values()]
    .sort(compareRecommendations)
    .slice(0, normalizedLimit)
    .map((declaration) => {
      const capability =
        registry.getCapability(declaration.capabilityId) ??
        registry.findMountedById(declaration.capabilityId);
      if (!capability) {
        return {
          intent: declaration.intent,
          label:
            declaration.label ?? INTENT_LABELS[declaration.intent] ?? declaration.intent,
          capabilityId: declaration.capabilityId,
          status: "missing",
          lifecycleState: null,
          sideEffects: null,
          summary: null,
          provenance: null,
          declaredBy: declaration.declaredBy,
          manifestPath: declaration.manifestPath,
        };
      }
      return {
        intent: declaration.intent,
        label:
          declaration.label ?? INTENT_LABELS[declaration.intent] ?? declaration.intent,
        capabilityId: capability.id,
        status:
          capability.lifecycleState === "active" ? "available" : "non-active",
        lifecycleState: capability.lifecycleState,
        sideEffects: capability.sideEffects,
        summary: capability.summary,
        provenance: capabilityProvenance(capability),
        declaredBy: declaration.declaredBy,
        manifestPath: declaration.manifestPath,
        inspect: {
          cli: `axf inspect ${capability.id}`,
          mcp: { operation: "inspect", target: { id: capability.id } },
        },
      };
    });

  for (const recommendation of recommendations) {
    if (recommendation.status === "missing") {
      warnings.push(
        `recommendation '${recommendation.label}' targets missing capability '${recommendation.capabilityId}'`,
      );
    }
  }

  return {
    intent: normalizedIntent,
    recommendations,
    count: recommendations.length,
    truncated: deduped.size > recommendations.length,
    limit: normalizedLimit,
    warnings,
  };
}

export function buildCapabilityExamples(capability) {
  const properties = capability.argsSchema?.properties ?? {};
  const required = new Set(capability.argsSchema?.required ?? []);
  const args = {};
  const mapping = [];

  for (const [name, schema] of Object.entries(properties)) {
    const hasDefault =
      Object.hasOwn(capability.defaults ?? {}, name) || schema.default !== undefined;
    if (!required.has(name) && !hasDefault && schema.example === undefined) {
      mapping.push(buildArgumentMapping(capability, name, schema, false, null));
      continue;
    }
    const value = exampleValue(name, schema, capability.defaults?.[name]);
    args[name] = value;
    mapping.push(
      buildArgumentMapping(capability, name, schema, required.has(name), value),
    );
  }

  const cliArgs = Object.entries(args).flatMap(([name, value]) => [
    `--${toKebab(name)}`,
    formatCliValue(value),
  ]);
  return {
    declared: Array.isArray(capability.examples) ? capability.examples : [],
    inspect: {
      cli: `axf inspect ${capability.id}`,
      mcp: { operation: "inspect", target: { id: capability.id } },
    },
    run: {
      cli: [
        `axf run ${capability.id}`,
        ...(cliArgs.length > 0 ? ["--", ...cliArgs] : []),
      ].join(" "),
      mcp: {
        operation: "run",
        target: { id: capability.id },
        args,
      },
    },
    argumentMapping: mapping,
  };
}

async function readWorkspaceRecommendations(projectRoot) {
  const declarations = [];
  const warnings = [];
  if (!projectRoot) return { declarations, warnings };
  const markerPath = path.join(projectRoot, "axf.workspace.json");
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      warnings.push(`cannot read recommendations from '${markerPath}': ${error.message}`);
    }
    return { declarations, warnings };
  }

  const recommendations = marker.recommendations;
  if (recommendations === undefined) return { declarations, warnings };
  if (
    recommendations === null ||
    typeof recommendations !== "object" ||
    Array.isArray(recommendations)
  ) {
    warnings.push("axf.workspace.json recommendations must be an object");
    return { declarations, warnings };
  }

  for (const [intentValue, rawEntries] of Object.entries(recommendations)) {
    const intent = normalizeIntent(intentValue);
    if (!intent) {
      warnings.push(`unknown recommendation intent '${intentValue}'`);
      continue;
    }
    for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : [rawEntries]) {
      const entry = normalizeRecommendationEntry(rawEntry);
      if (!entry) {
        warnings.push(`invalid recommendation for intent '${intentValue}'`);
        continue;
      }
      declarations.push({
        intent,
        capabilityId: entry.capabilityId,
        label: entry.label,
        declaredBy: "workspace",
        manifestPath: "axf.workspace.json",
      });
    }
  }
  return { declarations, warnings };
}

function normalizeRecommendationEntry(value) {
  if (typeof value === "string" && value.length > 0) {
    return { capabilityId: value, label: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capabilityId = value.capability ?? value.capabilityId ?? value.id;
  if (typeof capabilityId !== "string" || capabilityId.length === 0) return null;
  return {
    capabilityId,
    label: typeof value.label === "string" ? value.label : null,
  };
}

function normalizeIntentList(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map(normalizeIntent).filter(Boolean);
}

function compareRecommendations(left, right) {
  const intentOrder =
    (INTENT_ORDER.get(left.intent) ?? 100) -
    (INTENT_ORDER.get(right.intent) ?? 100);
  if (intentOrder !== 0) return intentOrder;
  if (left.declaredBy !== right.declaredBy) {
    return left.declaredBy === "workspace" ? -1 : 1;
  }
  return left.capabilityId.localeCompare(right.capabilityId);
}

function matchesSearch(capability, search) {
  if (!search) return true;
  const terms = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    capability.id,
    capability.summary,
    capability.provider,
    capability.owner,
    capability.manifestPath,
    capability.origin,
    capability.layer,
    capability.sourceFamily?.family,
    capability.sourceFamily?.command,
    capability.sourceCapabilityId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function matchesSideEffects(capability, sideEffects) {
  if (!sideEffects) return true;
  const expected = String(sideEffects).toLowerCase();
  const values = Array.isArray(capability.sideEffects)
    ? capability.sideEffects
    : [capability.sideEffects];
  return values.some((value) => String(value).toLowerCase() === expected);
}

function buildQueryCandidates(tokens) {
  const dotted = tokens.join(".");
  const candidates = new Set([dotted]);
  if (!/^(global|workspace|toolspace)\./.test(dotted)) {
    candidates.add(`global.${dotted}`);
    candidates.add(`workspace.${dotted}`);
  }
  return [...candidates];
}

function buildArgumentMapping(capability, name, schema, required, value) {
  return {
    publicName: name,
    publicFlag: `--${toKebab(name)}`,
    providerFlag: capability.argMap?.[name] ?? null,
    required,
    type: schema.type ?? "string",
    exampleValue: value,
  };
}

function exampleValue(name, schema, capabilityDefault) {
  if (capabilityDefault !== undefined) return capabilityDefault;
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer" || schema.type === "number") {
    return schema.minimum ?? 1;
  }
  if (schema.type === "array") return [];
  if (schema.type === "object") return {};
  return `<${name}>`;
}

function formatCliValue(value) {
  if (typeof value === "string" && !/\s/.test(value)) return value;
  return JSON.stringify(value);
}

function toKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_+/g, "-")
    .toLowerCase();
}
