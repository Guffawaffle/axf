import { redactMcpResponse } from "./redaction.js";

export const AXF_RESPONSE_DETAILS = Object.freeze([
  "compact",
  "standard",
  "diagnostic",
]);

export const DEFAULT_AXF_RESPONSE_DETAIL = "compact";

const LEGACY_WORKSPACE_FIELDS = Object.freeze([
  "workspace",
  "executionWorkspace",
  "workspaces",
]);

const SUCCESS_RUN_TRACE_FIELDS = new Set([
  "capabilityId",
  "sourceCapabilityId",
  "adapterType",
  "providerAdapter",
  "command",
  "args",
  "cwd",
  "launchPlan",
]);

export function projectMcpResponse(
  payload,
  responseDetail = DEFAULT_AXF_RESPONSE_DETAIL,
) {
  let projected;
  if (responseDetail === "diagnostic") {
    projected = payload;
  } else {
    const standard = projectStandardResponse(payload);
    projected =
      responseDetail === "compact"
        ? projectCompactResponse(standard)
        : standard;
  }

  return redactMcpResponse(projected, payload);
}

function projectStandardResponse(payload) {
  const projected = { ...payload };

  for (const field of LEGACY_WORKSPACE_FIELDS) delete projected[field];
  omitEmptyField(projected, "notes");
  omitNullField(projected, "projectRoot");
  omitNullField(projected, "executionRoot");

  if (projected.operation === "help") {
    delete projected.projectRoot;
    delete projected.executionRoot;
    delete projected.notes;
  }

  if (projected.operation === "run") {
    delete projected.input;
    delete projected.args;
    projected.capability = withoutNullFields(projected.capability);

    if (projected.ok) {
      delete projected.error;
      projected.meta = withoutInvocationTrace(projected.meta);
      omitEmptyField(projected, "meta");
    } else {
      delete projected.data;
      projected.meta = withoutInvocationTrace(projected.meta);
      omitEmptyField(projected, "meta");
    }
  }

  return projected;
}

function projectCompactResponse(payload) {
  const base = {
    ok: payload.ok,
    operation: payload.operation,
  };

  if (payload.ok === false && payload.error) {
    if (payload.operation === "run" && isRecord(payload.capability)) {
      base.capability = pickAgentValues(payload.capability, [
        "id",
        "lifecycleState",
      ]);
      copyAgentValue(base, payload, "meta");
    }
    copyAgentValue(base, payload, "error");
    return withCompactContext(base, payload);
  }

  switch (payload.operation) {
    case "help":
      return compactHelp(base, payload);
    case "list":
      return compactList(base, payload);
    case "guide":
      return compactGuide(base, payload);
    case "explain":
      return compactExplain(base, payload);
    case "inspect":
      return compactInspect(base, payload);
    case "run":
      return compactRun(base, payload);
    case "doctor":
      return compactDoctor(base, payload);
    case "scout_check":
      return compactScoutCheck(base, payload);
    default:
      copyAgentValue(base, payload, "error");
      return base;
  }
}

function compactHelp(base, payload) {
  copyAgentValue(base, payload, "tool");
  if (isRecord(payload.contract)) {
    base.contract = pickAgentValues(payload.contract, [
      "summary",
      "responseDetail",
      "discoveryFlow",
      "runRules",
    ]);
  }
  if (Array.isArray(payload.operations)) {
    base.operations = payload.operations.map((operation) =>
      pickAgentValues(operation, ["name", "purpose", "readOnly"]),
    );
  }
  return withCompactContext(base, payload);
}

function compactList(base, payload) {
  base.capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.map(summarizeCapability)
    : [];
  copyAgentValue(base, payload, "total");
  copyAgentValue(base, payload, "count");
  copyAgentValue(base, payload, "truncated");
  copyAgentValue(base, payload.filters ?? {}, "limit");
  return withCompactContext(base, payload);
}

function compactGuide(base, payload) {
  copyAgentValue(base, payload, "intent");
  base.recommendations = Array.isArray(payload.recommendations)
    ? payload.recommendations.map((recommendation) =>
        pickAgentValues(recommendation, [
          "intent",
          "label",
          "capabilityId",
          "status",
          "lifecycleState",
          "sideEffects",
          "summary",
        ]),
      )
    : [];
  for (const field of ["count", "truncated", "limit", "warnings"]) {
    copyAgentValue(base, payload, field);
  }
  return withCompactContext(base, payload);
}

function compactExplain(base, payload) {
  for (const field of ["query", "status", "reasons", "error"]) {
    copyAgentValue(base, payload, field);
  }
  if (payload.capability) base.capability = summarizeCapability(payload.capability);
  if (Array.isArray(payload.suggestions) && payload.suggestions.length > 0) {
    base.suggestions = payload.suggestions.map(summarizeCapability);
  }
  return withCompactContext(base, payload);
}

function compactInspect(base, payload) {
  if (isRecord(payload.capability)) {
    base.capability = pickAgentValues(payload.capability, [
      "id",
      "summary",
      "scope",
      "lifecycleState",
      "sideEffects",
      "argsSchema",
      "defaults",
      "policies",
      "outputModes",
      "warnings",
      "details",
    ]);
  }
  copyAgentValue(base, payload, "injectedDefaults");
  copyAgentValue(base, payload, "error");
  return withCompactContext(base, payload);
}

function compactRun(base, payload) {
  if (isRecord(payload.capability)) {
    base.capability = pickAgentValues(payload.capability, [
      "id",
      "lifecycleState",
    ]);
  }

  if (payload.ok) {
    base.data = payload.data;
    copyAgentValue(base, payload, "meta");
  } else {
    copyAgentValue(base, payload, "error");
    copyAgentValue(base, payload, "meta");
  }
  return withCompactContext(base, payload);
}

function compactDoctor(base, payload) {
  for (const field of [
    "status",
    "capabilityCount",
    "toolspaceCount",
    "manifestCount",
    "rejectedCount",
    "adapterCount",
    "familyCount",
    "issues",
  ]) {
    copyAgentValue(base, payload, field);
  }
  return withCompactContext(base, payload);
}

function compactScoutCheck(base, payload) {
  for (const field of [
    "status",
    "changeCount",
    "changes",
    "issues",
    "readOnly",
  ]) {
    copyAgentValue(base, payload, field);
  }
  return withCompactContext(base, payload);
}

function summarizeCapability(capability) {
  return pickAgentValues(capability, [
    "id",
    "summary",
    "scope",
    "lifecycleState",
    "sideEffects",
    "sourceKind",
    "provider",
    "provenance",
  ]);
}

function withCompactContext(projected, payload) {
  const projectRoot = payload.projectRoot?.root;
  const executionRoot = payload.executionRoot?.root;
  if (projectRoot && executionRoot && projectRoot !== executionRoot) {
    projected.projectRoot = payload.projectRoot;
    projected.executionRoot = payload.executionRoot;
  }
  copyAgentValue(projected, payload, "notes");
  return projected;
}

function withoutInvocationTrace(meta) {
  if (!isRecord(meta)) return meta;
  return Object.fromEntries(
    Object.entries(meta).filter(
      ([key, value]) =>
        !SUCCESS_RUN_TRACE_FIELDS.has(key) && hasAgentValue(value),
    ),
  );
}

function withoutNullFields(value) {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null),
  );
}

function pickAgentValues(value, fields) {
  if (!isRecord(value)) return value;
  const picked = {};
  for (const field of fields) copyAgentValue(picked, value, field);
  return picked;
}

function copyAgentValue(target, source, field) {
  if (hasAgentValue(source?.[field])) target[field] = source[field];
}

function hasAgentValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function omitEmptyField(target, field) {
  if (!hasAgentValue(target[field])) delete target[field];
}

function omitNullField(target, field) {
  if (target[field] === null || target[field] === undefined) delete target[field];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
