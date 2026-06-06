import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createRegistry } from "../core/registry.js";
import { resolveCapability } from "../core/resolver.js";
import { executeResolvedCapability } from "../core/executor.js";
import { inspectRegistry } from "../core/doctor.js";
import { loadAdapters } from "../core/adapter-loader.js";
import { findWorkspacePair } from "../core/workspace.js";
import { parseOptionTokens, splitCommandTokens } from "./options.js";
import { AxError } from "../core/errors.js";
import { resolveCliLaunchPlan } from "../core/cli-launch-plan.js";
import { prepareCommandInvocation } from "../core/command-invocation.js";
import { scoutWorkspace } from "../core/scout.js";
import { startStdioServer } from "../mcp/server.js";
import {
  collectRuntimeDiagnostics,
  summarizeWorkspaceBinding,
} from "../core/runtime-diagnostics.js";

const COMMANDS = new Set([
  "list",
  "inspect",
  "run",
  "init",
  "doctor",
  "promote",
  "demote",
  "scout",
  "mcp",
  "help",
]);

export async function main(argv, env = {}) {
  const cwd = env.cwd ?? process.cwd();
  const processEnv = env.env ?? process.env;

  // Pull --workspace out of argv before command dispatch so every
  // subcommand gets workspace resolution for free.
  const {
    argv: rest1,
    workspace,
    registryWorkspace,
    executionWorkspace,
    projectRoot,
    executionRoot,
  } = extractWorkspaceFlags(argv);
  const workspaces = findWorkspacePair({
    cwd,
    env: processEnv,
    explicit: workspace,
    registryExplicit: projectRoot ?? registryWorkspace,
    executionExplicit: executionRoot ?? executionWorkspace,
  });
  const rootDir = workspaces.registryWorkspace.root;

  const [command = "help", ...rest] = rest1;

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (!COMMANDS.has(command)) {
    throw new AxError(`unknown command '${command}'. Run 'axf help'.`, 2);
  }

  if (command === "init") {
    await initCommand(rootDir, rest);
    return;
  }
  if (command === "scout") {
    await scoutCommand(rootDir, rest, processEnv);
    return;
  }
  if (command === "mcp") {
    const serverEnv = { ...processEnv };
    if (workspace) {
      serverEnv.AXF_PROJECT_ROOT = workspaces.registryWorkspace.root;
      serverEnv.AXF_EXECUTION_ROOT = workspaces.executionWorkspace.root;
      serverEnv.AXF_WORKSPACE = workspaces.registryWorkspace.root;
      serverEnv.AXF_REGISTRY_WORKSPACE = workspaces.registryWorkspace.root;
      serverEnv.AXF_EXECUTION_WORKSPACE = workspaces.executionWorkspace.root;
    }
    if (registryWorkspace) {
      serverEnv.AXF_PROJECT_ROOT = workspaces.registryWorkspace.root;
      serverEnv.AXF_REGISTRY_WORKSPACE = workspaces.registryWorkspace.root;
    }
    if (projectRoot) {
      serverEnv.AXF_PROJECT_ROOT = workspaces.registryWorkspace.root;
      serverEnv.AXF_REGISTRY_WORKSPACE = workspaces.registryWorkspace.root;
    }
    if (executionWorkspace) {
      serverEnv.AXF_EXECUTION_ROOT = workspaces.executionWorkspace.root;
      serverEnv.AXF_EXECUTION_WORKSPACE = workspaces.executionWorkspace.root;
    }
    if (executionRoot) {
      serverEnv.AXF_EXECUTION_ROOT = workspaces.executionWorkspace.root;
      serverEnv.AXF_EXECUTION_WORKSPACE = workspaces.executionWorkspace.root;
    }
    startStdioServer({ cwd, env: serverEnv });
    return;
  }

  const registry = await createRegistry({
    rootDir,
    enableFrameworkGlobals: workspaces.registryWorkspace.viaMarker,
  });

  if (command === "list") {
    await listCommand(registry, rest, workspaces, { cwd });
    return;
  }
  if (command === "inspect") {
    const adapters = await loadAdapters({ rootDir });
    await inspectCommand(registry, adapters, rest, workspaces, processEnv, cwd);
    return;
  }
  if (command === "run") {
    const adapters = await loadAdapters({ rootDir });
    await runCommand(registry, adapters, rest, workspaces, processEnv, cwd);
    return;
  }
  if (command === "promote") {
    await promoteCommand(registry, rest);
    return;
  }
  if (command === "demote") {
    await demoteCommand(registry, rest);
    return;
  }
  if (command === "doctor") {
    const adapters = await loadAdapters({ rootDir });
    await doctorCommand(registry, adapters, rest, workspaces, processEnv, cwd);
  }
}

// Extract `--workspace <path>` or `--workspace=<path>` from argv before
// command dispatch. Other flags pass through untouched.
function extractWorkspaceFlags(argv) {
  const out = [];
  let workspace = null;
  let registryWorkspace = null;
  let executionWorkspace = null;
  let projectRoot = null;
  let executionRoot = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--workspace") {
      workspace = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--workspace=")) {
      workspace = token.slice("--workspace=".length);
      continue;
    }
    if (token === "--registry-workspace") {
      registryWorkspace = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--registry-workspace=")) {
      registryWorkspace = token.slice("--registry-workspace=".length);
      continue;
    }
    if (token === "--execution-workspace") {
      executionWorkspace = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--execution-workspace=")) {
      executionWorkspace = token.slice("--execution-workspace=".length);
      continue;
    }
    if (token === "--project-root") {
      projectRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--project-root=")) {
      projectRoot = token.slice("--project-root=".length);
      continue;
    }
    if (token === "--execution-root") {
      executionRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--execution-root=")) {
      executionRoot = token.slice("--execution-root=".length);
      continue;
    }
    out.push(token);
  }
  return {
    argv: out,
    workspace,
    registryWorkspace,
    executionWorkspace,
    projectRoot,
    executionRoot,
  };
}

async function listCommand(
  registry,
  tokens,
  workspaces = null,
  { cwd = process.cwd() } = {},
) {
  const parsed = parseOptionTokens(tokens);
  warnIfDeprecatedAllowDraft(parsed.options);
  const includeDrafts = Boolean(
    parsed.options.all ??
    parsed.options["any-lifecycle"] ??
    parsed.options["include-drafts"] ??
    parsed.options["allow-draft"],
  );
  const capabilities = registry.listCapabilities({ includeDrafts });
  const workspaceSummary = summarizeWorkspaceBinding(
    registry,
    workspaces?.registryWorkspace ?? null,
    {
      cwd,
      executionWorkspace: workspaces?.executionWorkspace ?? null,
    },
  );

  if (parsed.options.json) {
    printJson({
      capabilities,
      projectRoot: workspaceSummary.projectRoot,
      executionRoot: workspaceSummary.executionRoot,
      workspace: workspaceSummary.workspace,
      executionWorkspace: workspaceSummary.executionWorkspace,
      workspaces: workspaceSummary.workspaces,
      notes: workspaceSummary.notes,
    });
    return;
  }

  for (const note of workspaceSummary.notes) {
    console.log(`note: ${note}`);
  }

  if (capabilities.length === 0) {
    console.log("no capabilities found");
    return;
  }

  for (const capability of capabilities) {
    const source = capability.sourceCapabilityId
      ? ` -> ${capability.sourceCapabilityId}`
      : "";
    console.log(`${capability.id} [${capability.lifecycleState}]${source}`);
  }
}

async function inspectCommand(
  registry,
  adapters,
  tokens,
  workspaces = null,
  env = process.env,
  cwd = process.cwd(),
) {
  const { pathTokens, options } = splitCommandTokens(tokens);
  if (pathTokens.length === 0) {
    throw new AxError("inspect requires a capability id or CLI path", 2);
  }

  const resolved = registry.resolveInspectable(pathTokens);
  const cap = resolved.capability;
  const runtime = buildRuntime(workspaces, env, cwd);
  const launchPlan =
    cap.adapterType === "cli"
      ? buildInspectableLaunchPlan(cap, runtime, env)
      : null;
  const typeAdapter =
    adapters?.get(cap.adapterType, { toolspace: cap.toolspace }) ?? null;
  const providerAdapter = cap.providerAdapter
    ? (adapters?.getProvider(cap.providerAdapter, {
        toolspace: cap.toolspace,
      }) ?? null)
    : null;
  const adapterProvenance = typeAdapter
    ? {
        type: cap.adapterType,
        provenance: typeAdapter.provenance,
        manifestPath: typeAdapter.manifestPath,
        provider: providerAdapter
          ? {
              name: cap.providerAdapter,
              provenance: providerAdapter.provenance,
              manifestPath: providerAdapter.manifestPath,
            }
          : null,
      }
    : null;

  if (options.json) {
    const summarizedWorkspaces = summarizeWorkspaces(workspaces);
    const payload = {
      ...resolved,
      projectRoot: summarizedWorkspaces?.projectRoot ?? null,
      executionRoot: summarizedWorkspaces?.executionRoot ?? null,
      workspaces: summarizedWorkspaces,
    };
    if (launchPlan) payload.launchPlan = launchPlan;
    if (adapterProvenance) payload.adapter = adapterProvenance;
    printJson(payload);
    return;
  }

  console.log(`${cap.id}`);
  const summarizedWorkspaces = summarizeWorkspaces(workspaces);
  if (summarizedWorkspaces?.projectRoot) {
    console.log(
      `projectRoot: ${summarizedWorkspaces.projectRoot.root} (${summarizedWorkspaces.projectRoot.source})`,
    );
  }
  if (summarizedWorkspaces?.executionRoot) {
    console.log(
      `executionRoot: ${summarizedWorkspaces.executionRoot.root} (${summarizedWorkspaces.executionRoot.source})`,
    );
  }
  console.log(`summary: ${cap.summary}`);
  console.log(`scope: ${cap.scope}`);
  console.log(`lifecycle: ${cap.lifecycleState}`);
  console.log(`adapter: ${cap.adapterType}`);
  if (adapterProvenance) {
    console.log(`adapter.provenance: ${adapterProvenance.provenance}`);
  }
  if (cap.providerAdapter) {
    console.log(`provider: ${cap.providerAdapter}`);
    if (adapterProvenance?.provider) {
      console.log(
        `provider.provenance: ${adapterProvenance.provider.provenance}`,
      );
    }
  }
  if (cap.sourceCapabilityId) {
    console.log(`source: ${cap.sourceCapabilityId}`);
  }
  if (cap.policies?.length > 0) {
    console.log(`policies: ${cap.policies.join(", ")}`);
  }
  printMetadataField("warnings", cap.warnings);
  printMetadataField("details", cap.details);
  if (
    resolved.injectedDefaults &&
    Object.keys(resolved.injectedDefaults).length > 0
  ) {
    console.log(`defaults: ${JSON.stringify(resolved.injectedDefaults)}`);
  }
  if (cap.origin) {
    console.log(`origin: ${cap.origin}`);
  }
  if (cap.sourceFamily) {
    console.log(
      `family: ${cap.sourceFamily.family}.${cap.sourceFamily.command} (${cap.sourceFamily.manifestPath})`,
    );
  }
  if (cap.argMap && Object.keys(cap.argMap).length > 0) {
    console.log(`argMap:`);
    for (const [k, v] of Object.entries(cap.argMap)) {
      console.log(`  ${k} -> ${v}`);
    }
  }
  if (launchPlan) {
    console.log(`launch.command: ${launchPlan.command}`);
    if (launchPlan.requestedCommand !== launchPlan.command) {
      console.log(`launch.requested: ${launchPlan.requestedCommand}`);
    }
    if (launchPlan.launchStrategy) {
      console.log(`launch.strategy: ${launchPlan.launchStrategy}`);
    }
    if (launchPlan.targetPath) {
      console.log(
        `launch.target: ${launchPlan.targetPath} (${launchPlan.targetSource})`,
      );
    }
    if (launchPlan.cwd) {
      console.log(`launch.cwd: ${launchPlan.cwd} (${launchPlan.cwdSource})`);
    }
  }
}

async function runCommand(
  registry,
  adapters,
  tokens,
  workspaces = null,
  env = process.env,
  cwd = process.cwd(),
) {
  const { pathTokens, options } = splitCommandTokens(tokens);
  if (pathTokens.length === 0) {
    throw new AxError("run requires a capability id or CLI path", 2);
  }
  warnIfDeprecatedAllowDraft(options);

  const resolved = resolveCapability(registry, pathTokens, {
    args: options,
    allowDraft: Boolean(options["any-lifecycle"] ?? options["allow-draft"]),
  });
  const runtime = buildRuntime(workspaces, env, cwd);
  const result = await executeResolvedCapability(resolved, {
    adapters,
    runtime,
  });

  if (options.json) {
    printJson({
      ...result,
      workspaces: summarizeWorkspaces(workspaces),
    });
    return;
  }

  if (result.ok) {
    if (typeof result.data === "string") {
      console.log(result.data);
    } else {
      console.log(JSON.stringify(result.data, null, 2));
    }
    return;
  }

  throw new AxError(result.error?.message ?? "capability execution failed", 1);
}

async function initCommand(rootDir, tokens) {
  const [kind, ...args] = tokens;
  if (!kind || args.length === 0) {
    throw new AxError(
      "init requires 'toolspace <name>', 'capability <id>', 'adapter <type|name>', 'family <name>', or 'materialize <family> <command>'",
      2,
    );
  }

  if (kind === "toolspace") {
    await initToolspace(rootDir, args[0]);
    return;
  }
  if (kind === "capability") {
    await initCapability(rootDir, args[0]);
    return;
  }
  if (kind === "adapter") {
    await initAdapter(rootDir, args);
    return;
  }
  if (kind === "family") {
    await initFamily(rootDir, args[0]);
    return;
  }
  if (kind === "materialize") {
    await initMaterialize(rootDir, args);
    return;
  }

  throw new AxError(`unknown init kind '${kind}'`, 2);
}

async function initFamily(rootDir, name) {
  if (!name) throw new AxError("init family requires a name", 2);
  assertSafeName(name, "family");
  const filePath = path.join(
    rootDir,
    "manifests",
    "families",
    `${name}.family.json`,
  );
  const manifest = {
    manifestVersion: "axf/v0",
    family: name,
    scope: "global",
    provider: name,
    adapterType: "cli",
    executionTarget: { command: name },
    providerArgStyle: "double-dash-kebab",
    outputModes: ["text"],
    sideEffects: "unknown",
    lifecycleState: "draft",
    owner: "draft",
    commands: {
      status: {
        summary: `Show ${name} status`,
        executionTarget: { command: name, args: ["status"] },
        args: {},
        outputModes: ["text"],
        sideEffects: "read",
      },
    },
  };
  await writeJsonFile(filePath, manifest);
  console.log(`created draft family: ${path.relative(rootDir, filePath)}`);
}

async function initMaterialize(rootDir, args) {
  const [familyName, commandKey] = args;
  if (!familyName || !commandKey) {
    throw new AxError("init materialize requires <family> <command>", 2);
  }
  assertSafeName(familyName, "family");
  if (!/^[a-z][a-z0-9-]*$/.test(commandKey)) {
    throw new AxError(`materialize command key must be kebab-case`, 2);
  }
  const familyPath = path.join(
    rootDir,
    "manifests",
    "families",
    `${familyName}.family.json`,
  );
  let family;
  try {
    family = JSON.parse(await readFile(familyPath, "utf8"));
  } catch (error) {
    throw new AxError(
      `cannot read family manifest at ${path.relative(rootDir, familyPath)}: ${error.message}`,
      2,
    );
  }
  const cmd = family.commands?.[commandKey];
  if (!cmd) {
    throw new AxError(
      `family '${familyName}' has no command '${commandKey}'`,
      2,
    );
  }
  const { computeArgMap, copyDescriptiveMetadata } =
    await import("../core/family-loader.js");
  const argMap = computeArgMap(cmd.args ?? {}, family);
  const scope = family.scope ?? "global";
  const idPrefix = scope === "workspace-local" ? "workspace" : "global";
  const id = `${idPrefix}.${family.family}.${commandKey}`;
  const filePath = path.join(
    rootDir,
    "manifests",
    "capabilities",
    `${id}.json`,
  );
  const properties = {};
  const required = [];
  for (const [name, spec] of Object.entries(cmd.args ?? {})) {
    properties[name] = { type: spec.type ?? "string" };
    if (spec.description) properties[name].description = spec.description;
    if (spec.required) required.push(name);
  }
  const argsSchema = { type: "object", properties };
  if (required.length > 0) argsSchema.required = required;
  const manifest = {
    manifestVersion: "axf/v0",
    id,
    summary: cmd.summary ?? `${family.family} ${commandKey}`,
    provider: family.provider ?? family.family,
    adapterType: family.adapterType,
    executionTarget: cmd.executionTarget ?? family.executionTarget ?? {},
    argsSchema,
    outputModes: cmd.outputModes ?? family.outputModes ?? ["text"],
    sideEffects: cmd.sideEffects ?? family.sideEffects ?? "unknown",
    scope,
    lifecycleState: cmd.lifecycleState ?? "draft",
    defaults: cmd.defaults ?? {},
    policies: cmd.policies ?? family.policies ?? [],
    owner: cmd.owner ?? family.owner ?? "materialized",
    argMap,
    sourceFamily: {
      family: family.family,
      command: commandKey,
      manifestPath: path.relative(rootDir, familyPath),
    },
  };
  if (cmd.providerAdapter ?? family.providerAdapter) {
    manifest.providerAdapter = cmd.providerAdapter ?? family.providerAdapter;
  }
  copyDescriptiveMetadata(manifest, cmd);
  await writeJsonFile(filePath, manifest);
  console.log(
    `materialized ${familyName}.${commandKey} -> ${path.relative(rootDir, filePath)}`,
  );
}

function printMetadataField(label, value) {
  if (value === undefined) return;

  if (typeof value === "string") {
    console.log(`${label}: ${value}`);
    return;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    if (value.length === 0) {
      console.log(`${label}: []`);
      return;
    }
    console.log(`${label}:`);
    for (const item of value) {
      console.log(`  - ${item}`);
    }
    return;
  }

  const rendered = JSON.stringify(value, null, 2);
  if (!rendered?.includes("\n")) {
    console.log(`${label}: ${rendered}`);
    return;
  }

  console.log(`${label}:`);
  for (const line of rendered.split("\n")) {
    console.log(`  ${line}`);
  }
}

async function initToolspace(rootDir, name) {
  assertSafeName(name, "toolspace");
  const filePath = path.join(
    rootDir,
    "manifests",
    "toolspaces",
    `${name}.mount.json`,
  );
  const manifest = {
    manifestVersion: "axf/v0",
    toolspace: name,
    lifecycleState: "draft",
    moduleMounts: {},
  };
  await writeJsonFile(filePath, manifest);
  console.log(
    `created draft toolspace mount: ${path.relative(rootDir, filePath)}`,
  );
}

async function initCapability(rootDir, id) {
  assertCapabilityId(id);
  const filePath = path.join(
    rootDir,
    "manifests",
    "capabilities",
    `${id}.json`,
  );
  const prefix = id.split(".")[0];
  const scope =
    prefix === "global"
      ? "global"
      : prefix === "workspace"
        ? "workspace-local"
        : "toolspace-local";
  const manifest = {
    manifestVersion: "axf/v0",
    id,
    summary: "Draft axf capability",
    provider: "draft",
    adapterType: "internal",
    executionTarget: { handler: "draft.todo" },
    argsSchema: { type: "object", properties: {} },
    outputModes: ["json"],
    sideEffects: "unknown",
    scope,
    lifecycleState: "draft",
    defaults: {},
    policies: [],
    owner: "draft",
  };
  await writeJsonFile(filePath, manifest);
  console.log(`created draft capability: ${path.relative(rootDir, filePath)}`);
}

// init adapter <type>                                  -> draft global type-adapter under adapters/<type>/
// init adapter --kind provider <name>                  -> draft global provider adapter under adapters/<name>/
// init adapter --toolspace <ts> [--kind provider] <n>  -> draft toolspace-private adapter under toolspaces/<ts>/adapters/<n>/
async function initAdapter(rootDir, args) {
  const parsed = parseOptionTokens(args);
  const kind = parsed.options.kind ?? "type-adapter";
  const toolspace = parsed.options.toolspace ?? null;
  const name = parsed.positionals[0];
  if (!name) {
    throw new AxError("init adapter requires a name", 2);
  }
  assertSafeName(name, "adapter");
  if (toolspace) assertSafeName(toolspace, "toolspace");

  if (kind === "type-adapter") {
    await scaffoldTypeAdapter(rootDir, name, { toolspace });
    return;
  }
  if (kind === "provider") {
    const composes = parsed.options.composes ?? "cli";
    await scaffoldProviderAdapter(rootDir, name, composes, { toolspace });
    return;
  }
  throw new AxError(`unknown adapter kind '${kind}'`, 2);
}

function adapterRoot(rootDir, { toolspace }) {
  return toolspace
    ? path.join(rootDir, "toolspaces", toolspace, "adapters")
    : path.join(rootDir, "adapters");
}

async function scaffoldTypeAdapter(rootDir, type, { toolspace = null } = {}) {
  const dir = path.join(adapterRoot(rootDir, { toolspace }), type);
  const manifest = {
    manifestVersion: "axf/v0",
    kind: "type-adapter",
    type,
    summary: `Draft axf type adapter for ${type} execution`,
    entry: "index.js",
    supportedExecutionTargets: [],
    lifecycleState: "draft",
    owner: "draft",
  };
  const indexJs = `// Draft axf type adapter for '${type}'.
// Implement execute(resolved) to run a resolved capability and return
// a normalized result: { ok, data | error, meta }.
// See docs/04-adapter-contract.md and docs/08-adapter-folder-shape.md.

import { AxError } from "../../src/core/errors.js";

export async function execute(resolved) {
  throw new AxError(
    \`draft type-adapter '${type}' has no implementation for capability '\${resolved.capability.id}'\`,
    1
  );
}
`;
  await writeJsonFile(path.join(dir, "adapter.manifest.json"), manifest);
  await mkdir(path.join(dir, "test"), { recursive: true });
  await writeFile(path.join(dir, "index.js"), indexJs, { flag: "wx" });
  const tsTag = toolspace ? `  (toolspace-private: ${toolspace})` : "";
  console.log(
    `created draft type-adapter: ${path.relative(rootDir, dir)}/${tsTag}`,
  );
}

async function scaffoldProviderAdapter(
  rootDir,
  name,
  composes,
  { toolspace = null } = {},
) {
  const dir = path.join(adapterRoot(rootDir, { toolspace }), name);
  const manifest = {
    manifestVersion: "axf/v0",
    kind: "provider",
    name,
    composes,
    summary: `Draft axf provider adapter for ${name} (composes ${composes})`,
    entry: "index.js",
    lifecycleState: "draft",
    owner: "draft",
  };
  const indexJs = `// Draft axf provider adapter '${name}'.
// Provider adapters wrap a type adapter and normalize a provider's
// quirks (e.g. envelope shape, error conventions). The framework calls
// execute(resolved, ctx) when a capability declares
// "providerAdapter": "${name}".
//
// ctx.types       -> AdapterRegistry (full registry, advanced use)
// ctx.typeAdapter -> the resolved type adapter (composes target)
//
// The simplest provider just delegates and post-processes:
//
//   const result = await ctx.typeAdapter.execute(resolved);
//   // ...inspect/transform result.data here...
//   return result;
//
// See docs/04-adapter-contract.md.

export async function execute(resolved, ctx) {
  const result = await ctx.typeAdapter.execute(resolved);
  return result;
}
`;
  await writeJsonFile(path.join(dir, "adapter.manifest.json"), manifest);
  await mkdir(path.join(dir, "test"), { recursive: true });
  await writeFile(path.join(dir, "index.js"), indexJs, { flag: "wx" });
  const tsTag = toolspace ? `  (toolspace-private: ${toolspace})` : "";
  console.log(
    `created draft provider adapter: ${path.relative(rootDir, dir)}/  (composes ${composes})${tsTag}`,
  );
}

async function doctorCommand(
  registry,
  adapters,
  tokens,
  workspaces = null,
  env = process.env,
  cwd = process.cwd(),
) {
  const parsed = parseOptionTokens(tokens);
  const report = inspectRegistry(registry, { adapters });
  const workspaceSummary = summarizeWorkspaceBinding(
    registry,
    workspaces?.registryWorkspace ?? null,
    {
      cwd,
      executionWorkspace: workspaces?.executionWorkspace ?? null,
    },
  );
  if (workspaceSummary.projectRoot) report.projectRoot = workspaceSummary.projectRoot;
  if (workspaceSummary.executionRoot) {
    report.executionRoot = workspaceSummary.executionRoot;
  }
  if (workspaceSummary.workspace) report.workspace = workspaceSummary.workspace;
  if (workspaceSummary.executionWorkspace) {
    report.executionWorkspace = workspaceSummary.executionWorkspace;
  }
  report.workspaces = workspaceSummary.workspaces;
  report.notes = workspaceSummary.notes;
  const runtimeDiagnostics = collectRuntimeDiagnostics(registry, {
    workspace: workspaces?.registryWorkspace ?? null,
    executionWorkspace: workspaces?.executionWorkspace ?? null,
    env,
    cwd,
    platform: process.platform,
  });
  report.runtime = runtimeDiagnostics.runtime;
  report.issues.push(...runtimeDiagnostics.issues);

  if (parsed.options.json) {
    printJson(report);
    return;
  }

  if (report.projectRoot) {
    const markerNote = report.projectRoot.viaMarker ? "" : ", no marker";
    console.log(
      `projectRoot: ${report.projectRoot.root} (${report.projectRoot.source}${markerNote})`,
    );
    if (report.executionRoot) {
      const executionMarkerNote = report.executionRoot.viaMarker
        ? ""
        : ", no marker";
      console.log(
        `executionRoot: ${report.executionRoot.root} (${report.executionRoot.source}${executionMarkerNote})`,
      );
    }
  } else {
    console.log(`projectRoot: ${registry.rootDir}`);
  }
  if (report.runtime) {
    console.log(
      `runtime: ${report.runtime.wsl ? "linux (WSL)" : report.runtime.platform}`,
    );
    for (const [name, resolution] of Object.entries(
      report.runtime.commands ?? {},
    )) {
      console.log(
        `  - ${name}: ${resolution.resolvedCommand ?? "<not found>"}`,
      );
    }
  }
  console.log(`capabilities: ${report.capabilityCount}`);
  console.log(`toolspaces: ${report.toolspaceCount}`);
  console.log(`adapters: ${report.adapterCount}`);
  if (report.adaptersByType?.length > 0) {
    for (const a of report.adaptersByType) {
      const id =
        a.kind === "provider" ? `provider:${a.name}` : `type:${a.type}`;
      console.log(`  - ${id} (${a.provenance})`);
    }
  }
  if (report.rejectedCount > 0) {
    console.log(`rejected manifests (strict mode): ${report.rejectedCount}`);
  }

  if (report.notes?.length > 0) {
    console.log("notes:");
    for (const note of report.notes) {
      console.log(`- ${note}`);
    }
  }

  if (report.issues.length === 0) {
    console.log("issues: none");
    return;
  }

  console.log("issues:");
  for (const issue of report.issues) {
    console.log(`- ${issue.severity}: ${issue.message}`);
  }

  const hasError = report.issues.some((i) => i.severity === "error");
  if (hasError) {
    throw new AxError("doctor found errors", 1);
  }
}

function buildRuntime(
  workspaces = null,
  env = process.env,
  cwd = process.cwd(),
) {
  const runtime = {
    cwd,
    env,
    platform: process.platform,
  };
  if (workspaces?.registryWorkspace) {
    runtime.projectRoot = {
      root: workspaces.registryWorkspace.root,
      viaMarker: workspaces.registryWorkspace.viaMarker,
      source: workspaces.registryWorkspace.source,
    };
    runtime.registryWorkspace = {
      root: workspaces.registryWorkspace.root,
      viaMarker: workspaces.registryWorkspace.viaMarker,
      source: workspaces.registryWorkspace.source,
    };
  }
  if (workspaces?.executionWorkspace) {
    runtime.executionRoot = {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
    };
    runtime.executionWorkspace = {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
    };
    runtime.workspace = {
      root: workspaces.executionWorkspace.root,
      viaMarker: workspaces.executionWorkspace.viaMarker,
      source: workspaces.executionWorkspace.source,
    };
  }
  return runtime;
}

function summarizeWorkspaces(workspaces) {
  if (!workspaces) {
    return null;
  }
  return {
    projectRoot: workspaces.registryWorkspace
      ? {
          root: workspaces.registryWorkspace.root,
          viaMarker: workspaces.registryWorkspace.viaMarker,
          source: workspaces.registryWorkspace.source,
        }
      : null,
    executionRoot: workspaces.executionWorkspace
      ? {
          root: workspaces.executionWorkspace.root,
          viaMarker: workspaces.executionWorkspace.viaMarker,
          source: workspaces.executionWorkspace.source,
        }
      : null,
    registryWorkspace: workspaces.registryWorkspace
      ? {
          root: workspaces.registryWorkspace.root,
          viaMarker: workspaces.registryWorkspace.viaMarker,
          source: workspaces.registryWorkspace.source,
        }
      : null,
    executionWorkspace: workspaces.executionWorkspace
      ? {
          root: workspaces.executionWorkspace.root,
          viaMarker: workspaces.executionWorkspace.viaMarker,
          source: workspaces.executionWorkspace.source,
        }
      : null,
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

async function scoutCommand(rootDir, tokens, env = process.env) {
  const parsed = parseOptionTokens(tokens);
  if (parsed.options.help || parsed.options.h) {
    printScoutHelp();
    return;
  }

  const check = Boolean(parsed.options.check);
  const write = Boolean(parsed.options.write);
  if (check && write) {
    throw new AxError("scout accepts either --check or --write, not both", 2);
  }

  const report = await scoutWorkspace({ rootDir, check, write, env });
  if (parsed.options.json) {
    printJson(report);
    return;
  }

  console.log(`imports: ${report.imports.length}`);
  console.log(`changes: ${report.changeCount}`);
  for (const issue of report.issues) {
    console.log(`${issue.severity}: ${issue.message}`);
  }
  for (const change of report.changes) {
    const suffix = change.command
      ? ` (${change.family}.${change.command})`
      : ` (${change.family})`;
    console.log(`${change.action}: ${change.path}${suffix}`);
  }
  if (write && report.changeCount > 0) {
    console.log("scout wrote manifest updates");
  }
  if (!write && report.changeCount > 0) {
    console.log("run 'axf scout --write' to materialize these changes");
  }
  if (report.changeCount === 0) {
    console.log("scout: manifests are in sync");
  }
}

function printHelp() {
  console.log(`axf framework prototype

Global flags:
  --project-root <path>         Canonical project root for manifest/adaptor discovery.
  --execution-root <path>       Canonical execution root for runtime cwd and caller execution.
  --workspace <path>            Legacy alias: set both project and execution roots.
  --registry-workspace <path>   Legacy alias for --project-root.
  --execution-workspace <path>  Legacy alias for --execution-root.

Usage:
    axf list [--all|--any-lifecycle] [--json]
    axf inspect <id-or-path> [--json]
    axf run <id-or-path> [--key value] [--json] [--any-lifecycle]
    axf init toolspace <name>
    axf init capability <fully-qualified-id>      (global.* | workspace.* | toolspace.*)
    axf init adapter <type>
    axf init adapter --kind provider <name> [--composes <type>]
    axf init adapter --toolspace <ts> <type>
    axf init adapter --toolspace <ts> --kind provider <name> [--composes <type>]
    axf promote <id> --to <draft|reviewed|active> [--json]
    axf demote <id> --to <draft|reviewed> [--json]
    axf scout [--check|--write] [--json]
    axf doctor [--json]
    axf mcp

Lifecycle flag:
  --any-lifecycle        Allow non-active capabilities to run/list (canonical).
  --allow-draft          Deprecated alias for --any-lifecycle (warns to stderr).

Examples:
    axf list
    axf inspect echo say
    axf run echo say --message hello
    axf run toy echo say --message hello
    axf init toolspace demo
    axf init capability global.acme.status
    axf init adapter --kind provider acme --composes cli
    axf promote global.acme.status --to active
    axf scout --check
    axf mcp
`);
}

function printScoutHelp() {
  console.log(`axf scout

  Usage:
    axf scout [--check|--write] [--json]

  Options:
    --check     Exit non-zero when imported manifests are out of sync.
    --write     Materialize the generated family/capability manifests.
    --json      Emit the scout report as JSON.

  Notes:
    Scout reads imports from axf.workspace.json and currently supports
    the 'ax-inventory' import kind.
  `);
}

function assertSafeName(name, label) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new AxError(`${label} name must match /^[a-z][a-z0-9-]*$/`, 2);
  }
}

function assertCapabilityId(id) {
  if (
    !/^(global|toolspace|workspace)\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(
      id,
    )
  ) {
    throw new AxError(
      "capability id must be fully qualified, e.g. global.echo.say or workspace.repo.status",
      2,
    );
  }
}

// `axf promote <id> --to <state>` rewrites the capability manifest's
// lifecycleState in place. The whole manifest is re-validated after the
// edit; any validation error blocks the write.
async function promoteCommand(registry, tokens) {
  const parsed = parseOptionTokens(tokens);
  const [id] = parsed.positionals;
  const target = parsed.options.to;
  if (!id || !target) {
    throw new AxError(
      "promote requires '<id> --to <state>' (state in draft|reviewed|active)",
      2,
    );
  }
  if (!["draft", "reviewed", "active"].includes(target)) {
    throw new AxError(
      `unknown lifecycleState '${target}' (expected draft|reviewed|active)`,
      2,
    );
  }
  const capability = registry.getCapability(id);
  if (!capability) {
    throw new AxError(
      `unknown capability '${id}' (mounted capabilities cannot be promoted; promote the source instead)`,
      2,
    );
  }
  if (!capability.manifestPath) {
    throw new AxError(
      `capability '${id}' has no manifestPath; cannot promote`,
      1,
    );
  }
  const filePath = path.join(registry.rootDir, capability.manifestPath);
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const previous = raw.lifecycleState;
  if (previous === target) {
    if (parsed.options.json) {
      printJson({
        ok: true,
        id,
        lifecycleState: target,
        unchanged: true,
        manifestPath: capability.manifestPath,
      });
    } else {
      console.log(`${id}: already ${target}`);
    }
    return;
  }
  raw.lifecycleState = target;

  // Re-validate the edited manifest before writing.
  const { validateCapabilityManifest } =
    await import("../core/manifest-validator.js");
  const issues = validateCapabilityManifest(raw, capability.manifestPath);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new AxError(
      `promote refused: post-edit manifest invalid: ${errors.map((e) => e.message).join("; ")}`,
      2,
    );
  }

  await writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`);
  if (parsed.options.json) {
    printJson({
      ok: true,
      id,
      lifecycleState: target,
      previousLifecycleState: previous,
      manifestPath: capability.manifestPath,
    });
  } else {
    console.log(
      `${id}: ${previous} -> ${target}  (${capability.manifestPath})`,
    );
  }
}

// `axf demote <id> --to <state>` is the symmetric inverse of promote.
// It enforces that the target state is *earlier* in the lifecycle than
// the current state, so an agent that means to walk a capability back
// can do so without holding a regression-shaped promote in its head.
const LIFECYCLE_ORDER = { draft: 0, reviewed: 1, active: 2 };

async function demoteCommand(registry, tokens) {
  const parsed = parseOptionTokens(tokens);
  const [id] = parsed.positionals;
  const target = parsed.options.to;
  if (!id || !target) {
    throw new AxError(
      "demote requires '<id> --to <state>' (state in draft|reviewed)",
      2,
    );
  }
  if (!(target in LIFECYCLE_ORDER)) {
    throw new AxError(
      `unknown lifecycleState '${target}' (expected draft|reviewed|active)`,
      2,
    );
  }
  const capability = registry.getCapability(id);
  if (!capability) {
    throw new AxError(
      `unknown capability '${id}' (mounted capabilities cannot be demoted; demote the source instead)`,
      2,
    );
  }
  if (LIFECYCLE_ORDER[target] >= LIFECYCLE_ORDER[capability.lifecycleState]) {
    throw new AxError(
      `demote refused: '${id}' is '${capability.lifecycleState}' and target '${target}' is not earlier in the lifecycle (use 'axf promote' to advance)`,
      2,
    );
  }
  // Demote shares the same edit + revalidate path as promote.
  await rewriteLifecycleState(
    registry,
    capability,
    id,
    target,
    parsed.options.json,
  );
}

async function rewriteLifecycleState(registry, capability, id, target, asJson) {
  if (!capability.manifestPath) {
    throw new AxError(
      `capability '${id}' has no manifestPath; cannot rewrite lifecycle`,
      1,
    );
  }
  const filePath = path.join(registry.rootDir, capability.manifestPath);
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const previous = raw.lifecycleState;
  raw.lifecycleState = target;

  const { validateCapabilityManifest } =
    await import("../core/manifest-validator.js");
  const issues = validateCapabilityManifest(raw, capability.manifestPath);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new AxError(
      `lifecycle rewrite refused: post-edit manifest invalid: ${errors.map((e) => e.message).join("; ")}`,
      2,
    );
  }

  await writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`);
  if (asJson) {
    printJson({
      ok: true,
      id,
      lifecycleState: target,
      previousLifecycleState: previous,
      manifestPath: capability.manifestPath,
    });
  } else {
    console.log(
      `${id}: ${previous} -> ${target}  (${capability.manifestPath})`,
    );
  }
}

// Emit a one-line stderr deprecation warning when --allow-draft is
// used. The flag still works (it remains an alias for --any-lifecycle)
// but agents are nudged toward the canonical name.
let _warnedAllowDraft = false;
function warnIfDeprecatedAllowDraft(options) {
  if (_warnedAllowDraft) return;
  if (options && Object.prototype.hasOwnProperty.call(options, "allow-draft")) {
    process.stderr.write(
      "axf: warning: --allow-draft is deprecated; use --any-lifecycle (will be removed in v0.1)\n",
    );
    _warnedAllowDraft = true;
  }
}

async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    flag: "wx",
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
