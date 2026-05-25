import { loadAdapters } from "../core/adapter-loader.js";
import { resolveCliLaunchPlan } from "../core/cli-launch-plan.js";
import { prepareCommandInvocation } from "../core/command-invocation.js";
import { inspectRegistry } from "../core/doctor.js";
import { AxError } from "../core/errors.js";
import { executeResolvedCapability } from "../core/executor.js";
import { createRegistry } from "../core/registry.js";
import { resolveCapability } from "../core/resolver.js";
import {
  collectRuntimeDiagnostics,
  summarizeWorkspaceBinding,
} from "../core/runtime-diagnostics.js";
import { scoutWorkspace } from "../core/scout.js";
import { findWorkspaceRoot } from "../core/workspace.js";

const OPERATIONS = new Set(["list", "inspect", "doctor", "scout_check", "run"]);

export class MCPInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "MCPInputError";
    this.code = "INVALID_PARAMS";
  }
}

export async function performOperation(rawInput, options = {}) {
  const fallbackOperation =
    typeof rawInput?.operation === "string" ? rawInput.operation : "unknown";
  let workspaceSummary = null;

  try {
    const input = validateInput(rawInput);
    const context = await createContext(input, options);
    workspaceSummary = context.workspaceSummary;

    switch (input.operation) {
      case "list":
        return performList(context);
      case "inspect":
        return await performInspect(context);
      case "doctor":
        return await performDoctor(context);
      case "scout_check":
        return await performScoutCheck(context);
      case "run":
        return await performRun(context);
      default:
        throw new MCPInputError(
          `operation must be one of ${[...OPERATIONS].join(", ")}`,
        );
    }
  } catch (error) {
    return attachWorkspace(
      {
        ok: false,
        operation: fallbackOperation,
        error: formatOperationError(error, fallbackOperation),
      },
      workspaceSummary,
    );
  }
}

function performList(context) {
  const includeDrafts = Boolean(
    context.input.includeDrafts ?? context.input.allowAnyLifecycle,
  );
  const capabilities = context.registry.listCapabilities({ includeDrafts });

  return attachWorkspace(
    {
      ok: true,
      operation: "list",
      capabilities,
      count: capabilities.length,
    },
    context.workspaceSummary,
  );
}

async function performInspect(context) {
  const targetTokens = resolveTargetTokens(context.input.target, "inspect");
  const adapters = await loadAdapters({ rootDir: context.workspace.root });
  const resolved = context.registry.resolveInspectable(targetTokens);
  const capability = resolved.capability;
  const launchPlan =
    capability.adapterType === "cli"
      ? buildInspectableLaunchPlan(capability, context.runtime, context.env)
      : null;
  const typeAdapter =
    adapters.get(capability.adapterType, { toolspace: capability.toolspace }) ??
    null;
  const providerAdapter = capability.providerAdapter
    ? (adapters.getProvider(capability.providerAdapter, {
        toolspace: capability.toolspace,
      }) ?? null)
    : null;

  const payload = {
    ok: true,
    operation: "inspect",
    ...resolved,
  };

  if (launchPlan) {
    payload.launchPlan = launchPlan;
  }

  if (typeAdapter) {
    payload.adapter = {
      type: capability.adapterType,
      provenance: typeAdapter.provenance,
      manifestPath: typeAdapter.manifestPath,
      provider: providerAdapter
        ? {
            name: capability.providerAdapter,
            provenance: providerAdapter.provenance,
            manifestPath: providerAdapter.manifestPath,
          }
        : null,
    };
  }

  return attachWorkspace(payload, context.workspaceSummary);
}

async function performDoctor(context) {
  const adapters = await loadAdapters({ rootDir: context.workspace.root });
  const report = inspectRegistry(context.registry, { adapters });
  const runtimeDiagnostics = collectRuntimeDiagnostics(context.registry, {
    workspace: context.workspace,
    env: context.env,
    cwd: context.cwd,
    platform: context.runtime.platform,
  });
  const issues = [...report.issues, ...runtimeDiagnostics.issues];
  const ok = !issues.some((issue) => issue.severity === "error");

  return {
    ok,
    operation: "doctor",
    status: ok ? "ok" : "error",
    capabilityCount: report.capabilityCount,
    toolspaceCount: report.toolspaceCount,
    manifestCount: report.manifestCount,
    rejectedCount: report.rejectedCount,
    adapterCount: report.adapterCount,
    adaptersByType: report.adaptersByType,
    familyCount: report.familyCount,
    drift: report.drift,
    issues,
    runtime: runtimeDiagnostics.runtime,
    workspace: context.workspaceSummary.workspace,
    notes: context.workspaceSummary.notes,
  };
}

async function performScoutCheck(context) {
  const report = await scoutWorkspace({
    rootDir: context.workspace.root,
    check: false,
    write: false,
    env: context.env,
  });
  const ok =
    report.issues.every((issue) => issue.severity !== "error") &&
    report.changeCount === 0;

  return attachWorkspace(
    {
      ok,
      operation: "scout_check",
      status: ok ? "ok" : report.changeCount > 0 ? "changes-detected" : "error",
      imports: report.imports,
      changeCount: report.changeCount,
      changes: report.changes,
      issues: report.issues,
      readOnly: true,
    },
    context.workspaceSummary,
  );
}

async function performRun(context) {
  const targetTokens = resolveTargetTokens(context.input.target, "run");
  const adapters = await loadAdapters({ rootDir: context.workspace.root });
  const resolved = resolveCapability(context.registry, targetTokens, {
    args: context.input.args ?? {},
    allowDraft: Boolean(context.input.allowAnyLifecycle),
  });
  const execution = await executeResolvedCapability(resolved, {
    adapters,
    runtime: context.runtime,
  });

  return attachWorkspace(
    {
      ok: execution.ok,
      operation: "run",
      capability: summarizeCapability(resolved.capability),
      input: resolved.input,
      args: resolved.args,
      data: execution.ok ? execution.data : null,
      error: execution.ok
        ? null
        : {
            code:
              execution.meta?.policyErrors?.length > 0
                ? "EXECUTION_BLOCKED"
                : "EXECUTION_FAILED",
            message:
              execution.error?.message ?? "capability execution failed",
          },
      meta: execution.meta ?? null,
    },
    context.workspaceSummary,
  );
}

async function createContext(input, options) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const workspace = findWorkspaceRoot({
    cwd,
    env,
    explicit: input.workspace ?? undefined,
  });
  const registry = await createRegistry({
    rootDir: workspace.root,
    enableFrameworkGlobals: workspace.viaMarker,
  });
  const workspaceSummary = summarizeWorkspaceBinding(registry, workspace, {
    cwd,
  });

  return {
    input,
    cwd,
    env,
    workspace,
    workspaceSummary,
    registry,
    runtime: buildRuntime(workspace, env, cwd),
  };
}

function buildRuntime(workspace, env, cwd) {
  return {
    cwd,
    env,
    platform: process.platform,
    workspace: {
      root: workspace.root,
      viaMarker: workspace.viaMarker,
      source: workspace.source,
    },
  };
}

function buildInspectableLaunchPlan(capability, runtime, env) {
  const launchPlan = resolveCliLaunchPlan(capability, { runtime, env });
  const invocation = prepareCommandInvocation(
    launchPlan.command,
    launchPlan.argsPrefix,
    {
      env,
      platform: runtime?.platform ?? process.platform,
    },
  );

  return {
    ...launchPlan,
    command: invocation.command,
    argsPrefix: invocation.args,
    requestedCommand: invocation.requestedCommand,
    resolvedCommand: invocation.resolvedCommand,
    commandSource: invocation.commandSource,
    launchStrategy: invocation.launchStrategy,
  };
}

function validateInput(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MCPInputError("tool arguments must be an object");
  }

  if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) {
    throw new MCPInputError(
      `operation must be one of ${[...OPERATIONS].join(", ")}`,
    );
  }

  const workspace = optionalString(value.workspace, "workspace");
  const target = validateTarget(value.target);
  const args = validateArgs(value.args);
  const includeDrafts = optionalBoolean(value.includeDrafts, "includeDrafts");
  const allowAnyLifecycle = optionalBoolean(
    value.allowAnyLifecycle,
    "allowAnyLifecycle",
  );

  return {
    operation: value.operation,
    workspace,
    target,
    args,
    includeDrafts,
    allowAnyLifecycle,
  };
}

function validateTarget(value) {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MCPInputError("target must be an object when provided");
  }

  const id = optionalString(value.id, "target.id");
  if (id && value.path !== undefined) {
    throw new MCPInputError("target must provide either id or path, not both");
  }

  if (id) {
    return { id };
  }

  if (!Array.isArray(value.path) || value.path.length === 0) {
    throw new MCPInputError("target.path must be a non-empty array of strings");
  }

  const path = value.path.map((token, index) => {
    if (typeof token !== "string" || token.length === 0) {
      throw new MCPInputError(
        `target.path[${index}] must be a non-empty string`,
      );
    }
    return token;
  });

  return { path };
}

function resolveTargetTokens(target, operation) {
  if (!target) {
    throw new MCPInputError(`${operation} requires target.id or target.path`);
  }
  if (target.id) {
    return [target.id];
  }
  return target.path;
}

function validateArgs(value) {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MCPInputError("args must be an object when provided");
  }
  return { ...value };
}

function optionalString(value, label) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new MCPInputError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(value, label) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new MCPInputError(`${label} must be a boolean when provided`);
  }
  return value;
}

function attachWorkspace(payload, workspaceSummary) {
  return {
    ...payload,
    workspace: workspaceSummary?.workspace ?? null,
    notes: workspaceSummary?.notes ?? [],
  };
}

function summarizeCapability(capability) {
  return {
    id: capability.id,
    scope: capability.scope,
    lifecycleState: capability.lifecycleState,
    adapterType: capability.adapterType,
    provider: capability.provider,
    providerAdapter: capability.providerAdapter ?? null,
    sourceCapabilityId: capability.sourceCapabilityId ?? null,
  };
}

function formatOperationError(error, operation) {
  const code = classifyError(error);
  let message = error?.message ?? String(error);

  if (operation === "run" && code === "UNKNOWN_CAPABILITY") {
    message = `${message}. Use operation 'list' to discover capabilities or 'inspect' to inspect a target before running it.`;
  }

  return { code, message };
}

function classifyError(error) {
  const message = error?.message ?? "";

  if (error instanceof MCPInputError) {
    return error.code;
  }

  if (/unknown capability|unknown mount|mount source capability/.test(message)) {
    return "UNKNOWN_CAPABILITY";
  }
  if (/capability '.*' args:/.test(message)) {
    return "ARG_VALIDATION_ERROR";
  }
  if (error instanceof AxError) {
    return "AXF_ERROR";
  }
  return error?.code ?? "INTERNAL_ERROR";
}