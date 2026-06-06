import { loadAdapters } from "../core/adapter-loader.js";
import { resolveCliLaunchPlan } from "../core/cli-launch-plan.js";
import { prepareCommandInvocation } from "../core/command-invocation.js";
import { inspectRegistry } from "../core/doctor.js";
import { AxError } from "../core/errors.js";
import { executeResolvedCapability } from "../core/executor.js";
import { createRegistry, MACHINE_ROOT_ENV } from "../core/registry.js";
import { resolveCapability } from "../core/resolver.js";
import {
  collectRuntimeDiagnostics,
  summarizeWorkspaceBinding,
} from "../core/runtime-diagnostics.js";
import { scoutWorkspace } from "../core/scout.js";
import { findWorkspacePair } from "../core/workspace.js";
import {
  AXF_MCP_CAPABILITY_EXAMPLES,
  AXF_MCP_EXAMPLES,
  AXF_MCP_NOT_EXPOSED_COMMANDS,
  AXF_MCP_OPERATIONS,
  AXF_TOOL_DESCRIPTION,
  AXF_TOOL_NAME,
} from "./contract.js";

const OPERATIONS = new Set(AXF_MCP_OPERATIONS);

export class MCPInputError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "MCPInputError";
    this.code = "INVALID_PARAMS";
    this.details = details;
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
      case "help":
        return performHelp(context);
      case "list":
        return performList(context);
      case "inspect":
        return await performInspect(context);
      case "run":
        return await performRun(context);
      case "doctor":
        return await performDoctor(context);
      case "scout_check":
        return await performScoutCheck(context);
      default:
        throw new MCPInputError(
          buildOperationErrorMessage(),
          buildOperationSelectionErrorDetails(),
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

function performHelp(context) {
  return attachWorkspace(
    {
      ok: true,
      operation: "help",
      tool: {
        name: AXF_TOOL_NAME,
        description: AXF_TOOL_DESCRIPTION,
        contract: "single-tool-capability-router",
      },
      contract: {
        summary:
          "AXF MCP exposes one tool named axf as an agent-safe router over the current AXF registry.",
        capabilitiesAreSeparateTools: false,
        routingNote:
          "Capabilities such as global.echo.say are discovered through the single axf MCP tool, not exposed as separate MCP tools.",
        capabilityExamples: AXF_MCP_CAPABILITY_EXAMPLES,
        discoveryFlow: ["list", "inspect", "run"],
        runRules: [
          "Use operation=list to discover capabilities.",
          "Use operation=inspect before operation=run.",
          "Use operation=run only with args matching inspect output.",
          "Respect lifecycle, sideEffects, policies, and workspace binding.",
        ],
        registryLifecycle: {
          cliControlPlane:
            "Registry and manifest changes still happen through normal AXF CLI and filesystem/control-plane flows.",
          mcpReloadBehavior:
            "MCP reloads registry state per request, so external AXF updates become visible without restarting the MCP server.",
          mutationToolsExposed: false,
        },
        boundary: {
          cliRemainsAuthoritative: true,
          notExposedViaMcp: AXF_MCP_NOT_EXPOSED_COMMANDS,
          futureParity:
            "Full CLI parity may be considered later behind explicit policy and approval gates.",
        },
        scoutCheck: {
          semantics:
            "scout_check is read-only structured scout diagnostics, not a literal axf scout --check wrapper.",
        },
      },
      operations: [
        {
          name: "help",
          purpose:
            "Explain the single-tool AXF MCP contract and safe routing flow.",
          requiresTarget: false,
          readOnly: true,
        },
        {
          name: "list",
          purpose: "Discover capabilities in the current AXF registry.",
          requiresTarget: false,
          readOnly: true,
        },
        {
          name: "inspect",
          purpose:
            "Inspect capability metadata, lifecycle, side effects, policies, and launch details before execution.",
          requiresTarget: true,
          readOnly: true,
        },
        {
          name: "run",
          purpose:
            "Run a capability through AXF's normal resolver, policy, adapter, and executor path.",
          requiresTarget: true,
          readOnly: false,
        },
        {
          name: "doctor",
          purpose: "Return read-only AXF registry and runtime diagnostics.",
          requiresTarget: false,
          readOnly: true,
        },
        {
          name: "scout_check",
          purpose:
            "Return read-only structured scout diagnostics for workspace and registry state.",
          requiresTarget: false,
          readOnly: true,
        },
      ],
      examples: AXF_MCP_EXAMPLES,
    },
    context.workspaceSummary,
  );
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
  const adapters = await loadAdapters({
    rootDir: context.registryWorkspace.root,
  });
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
  const adapters = await loadAdapters({
    rootDir: context.registryWorkspace.root,
  });
  const report = inspectRegistry(context.registry, { adapters });
  const runtimeDiagnostics = collectRuntimeDiagnostics(context.registry, {
    workspace: context.registryWorkspace,
    executionWorkspace: context.executionWorkspace,
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
    families: report.families,
    shadowedFamilies: report.shadowedFamilies,
    familyConflicts: report.familyConflicts,
    drift: report.drift,
    issues,
    runtime: runtimeDiagnostics.runtime,
    projectRoot: context.workspaceSummary.projectRoot,
    executionRoot: context.workspaceSummary.executionRoot,
    workspace: context.workspaceSummary.workspace,
    executionWorkspace: context.workspaceSummary.executionWorkspace,
    workspaces: context.workspaceSummary.workspaces,
    notes: context.workspaceSummary.notes,
  };
}

async function performScoutCheck(context) {
  const report = await scoutWorkspace({
    rootDir: context.registryWorkspace.root,
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
  const adapters = await loadAdapters({
    rootDir: context.registryWorkspace.root,
  });
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
            message: execution.error?.message ?? "capability execution failed",
          },
      meta: execution.meta ?? null,
    },
    context.workspaceSummary,
  );
}

async function createContext(input, options) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const workspaces = findWorkspacePair({
    cwd,
    env,
    explicit: input.workspace ?? undefined,
    registryExplicit: input.projectRoot ?? input.registryWorkspace ?? undefined,
    executionExplicit:
      input.executionRoot ?? input.executionWorkspace ?? undefined,
  });
  const registry = await createRegistry({
    rootDir: workspaces.registryWorkspace.root,
    enableFrameworkGlobals: workspaces.registryWorkspace.viaMarker,
    machineRoot: env[MACHINE_ROOT_ENV],
  });
  const workspaceSummary = summarizeWorkspaceBinding(
    registry,
    workspaces.registryWorkspace,
    {
      cwd,
      executionWorkspace: workspaces.executionWorkspace,
    },
  );

  return {
    input,
    cwd,
    env,
    workspace: workspaces.registryWorkspace,
    registryWorkspace: workspaces.registryWorkspace,
    executionWorkspace: workspaces.executionWorkspace,
    workspaces,
    workspaceSummary,
    registry,
    runtime: buildRuntime(workspaces, env, cwd),
  };
}

function buildRuntime(workspaces, env, cwd) {
  return {
    cwd,
    env,
    platform: process.platform,
    projectRoot: {
      root: workspaces.registryWorkspace.root,
      viaMarker: workspaces.registryWorkspace.viaMarker,
      source: workspaces.registryWorkspace.source,
    },
    registryWorkspace: {
      root: workspaces.registryWorkspace.root,
      viaMarker: workspaces.registryWorkspace.viaMarker,
      source: workspaces.registryWorkspace.source,
    },
    executionRoot: {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
    },
    executionWorkspace: {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
    },
    workspace: {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
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
    throw new MCPInputError(
      "tool arguments must be an object",
      buildOperationSelectionErrorDetails(),
    );
  }

  if (value.operation === undefined) {
    throw new MCPInputError(
      `${buildOperationErrorMessage()} Operation is required.`,
      buildOperationSelectionErrorDetails(),
    );
  }

  if (typeof value.operation !== "string" || value.operation.length === 0) {
    throw new MCPInputError(
      `${buildOperationErrorMessage()} Operation must be a non-empty string.`,
      buildOperationSelectionErrorDetails(),
    );
  }

  if (!OPERATIONS.has(value.operation)) {
    throw new MCPInputError(
      `Unknown operation '${value.operation}'. ${buildOperationErrorMessage()}`,
      buildOperationSelectionErrorDetails(),
    );
  }

  const workspace = optionalString(value.workspace, "workspace");
  const projectRoot = optionalString(value.projectRoot, "projectRoot");
  const registryWorkspace = optionalString(
    value.registryWorkspace,
    "registryWorkspace",
  );
  const executionRoot = optionalString(value.executionRoot, "executionRoot");
  const executionWorkspace = optionalString(
    value.executionWorkspace,
    "executionWorkspace",
  );
  const target = validateTarget(value.target, value.operation);
  const args = validateArgs(value.args);
  const includeDrafts = optionalBoolean(value.includeDrafts, "includeDrafts");
  const allowAnyLifecycle = optionalBoolean(
    value.allowAnyLifecycle,
    "allowAnyLifecycle",
  );

  return {
    operation: value.operation,
    workspace,
    projectRoot,
    registryWorkspace,
    executionRoot,
    executionWorkspace,
    target,
    args,
    includeDrafts,
    allowAnyLifecycle,
  };
}

function validateTarget(value, operation) {
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

  if (value.path === undefined) {
    throw missingTargetError(operation);
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
    throw missingTargetError(operation);
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
    projectRoot: workspaceSummary?.projectRoot ?? null,
    executionRoot: workspaceSummary?.executionRoot ?? null,
    workspace: workspaceSummary?.workspace ?? null,
    executionWorkspace: workspaceSummary?.executionWorkspace ?? null,
    workspaces: workspaceSummary?.workspaces ?? null,
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
  let details = error?.details ?? null;

  if (operation === "run" && code === "UNKNOWN_CAPABILITY") {
    message = `${message}. Use operation 'list' to discover capabilities or 'inspect' to inspect a target before running it.`;
    details = {
      ...details,
      inspectExample: createInspectExample(),
      nextSteps: buildRunDiscoveryNextSteps(),
    };
  }

  return {
    code,
    message,
    ...(details ?? {}),
  };
}

function classifyError(error) {
  const message = error?.message ?? "";

  if (error instanceof MCPInputError) {
    return error.code;
  }

  if (
    /unknown capability|unknown mount|mount source capability/.test(message)
  ) {
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

function buildOperationErrorMessage() {
  return `operation must be one of ${AXF_MCP_OPERATIONS.join(", ")}.`;
}

function buildOperationSelectionErrorDetails() {
  return {
    availableOperations: AXF_MCP_OPERATIONS,
    nextSteps: [
      createNextStep(
        "call_help",
        "Call operation=help to learn the single-tool AXF MCP contract.",
        { operation: "help" },
      ),
      createNextStep(
        "call_list",
        "Call operation=list to discover capability ids in the bound AXF registry.",
        { operation: "list" },
      ),
      createNextStep(
        "inspect_before_run",
        "Call operation=inspect with a capability id before operation=run.",
        createInspectExample(),
      ),
    ],
  };
}

function missingTargetError(operation) {
  const isRun = operation === "run";
  const details = isRun
    ? {
        nextStep: createNextStep(
          "inspect_before_run",
          "Inspect the capability you plan to run before calling operation=run.",
          createInspectExample(),
        ),
        inspectExample: createInspectExample(),
        nextSteps: buildRunDiscoveryNextSteps(),
      }
    : null;

  return new MCPInputError(
    `${operation} requires target.id or target.path. Prefer target.id from operation=list when possible.`,
    details,
  );
}

function buildRunDiscoveryNextSteps() {
  return [
    createNextStep(
      "call_list",
      "Call operation=list to discover capability ids.",
      { operation: "list" },
    ),
    createNextStep(
      "inspect_before_run",
      "Inspect the capability you want to run before invoking operation=run.",
      createInspectExample(),
    ),
  ];
}

function createInspectExample(id = "global.echo.say") {
  return {
    operation: "inspect",
    target: { id },
  };
}

function createNextStep(action, description, argumentsValue) {
  return {
    action,
    description,
    arguments: argumentsValue,
  };
}
