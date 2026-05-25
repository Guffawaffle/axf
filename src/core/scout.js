import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { AxError } from "./errors.js";
import {
  RESERVED_ARG_NAMES,
  computeArgMap,
  copyDescriptiveMetadata,
} from "./family-loader.js";
import { prepareCommandInvocation } from "./command-invocation.js";

const SUPPORTED_IMPORT_KINDS = new Set(["ax-inventory"]);
const DEFAULT_AX_LAUNCHER = {
  command: "pwsh",
  args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"],
};

export async function scoutWorkspace({
  rootDir,
  check = false,
  write = false,
  env = process.env,
} = {}) {
  const workspace = await readWorkspaceConfig(rootDir);
  const imports = normalizeImports(
    workspace.imports ?? workspace.scout?.imports ?? [],
  );
  const results = [];
  const changes = [];
  const issues = [];

  for (const importSource of imports) {
    if (importSource.enabled === false) continue;
    if (!SUPPORTED_IMPORT_KINDS.has(importSource.kind)) {
      issues.push({
        severity: "error",
        message: `unsupported scout import kind '${importSource.kind}'`,
      });
      continue;
    }
    const result = await scoutAxInventory(rootDir, importSource, { env });
    results.push(result);
    changes.push(...result.changes);
    issues.push(...result.issues);
  }

  if (write) {
    for (const change of changes) {
      await mkdir(path.dirname(change.path), { recursive: true });
      await writeFile(change.path, change.expectedJson);
    }
  }

  if (check && changes.length > 0) {
    throw new AxError(
      `scout detected manifest drift:\n${changes.map((c) => `- ${path.relative(rootDir, c.path)}`).join("\n")}`,
      1,
    );
  }

  return {
    ok:
      issues.every((issue) => issue.severity !== "error") &&
      !(check && changes.length > 0),
    imports: results,
    changeCount: changes.length,
    changes: changes.map((change) => ({
      kind: change.kind,
      family: change.family,
      command: change.command,
      path: path.relative(rootDir, change.path),
      action: change.action,
    })),
    issues,
  };
}

async function readWorkspaceConfig(rootDir) {
  const filePath = path.join(rootDir, "axf.workspace.json");
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AxError(
        "scout requires axf.workspace.json with declared imports",
        2,
      );
    }
    throw new AxError(`failed to read axf.workspace.json: ${error.message}`, 2);
  }
}

function normalizeImports(imports) {
  if (!Array.isArray(imports)) {
    throw new AxError("axf.workspace.json imports must be an array", 2);
  }
  return imports;
}

async function scoutAxInventory(rootDir, importSource, { env }) {
  const familyName = importSource.family;
  if (!familyName || !/^[a-z][a-z0-9-]*$/.test(familyName)) {
    throw new AxError("ax-inventory import requires a kebab-case family", 2);
  }
  const axPath = importSource.path;
  if (!axPath) {
    throw new AxError(`ax-inventory import '${familyName}' requires a path`, 2);
  }

  const inventory = await readAxInventory(rootDir, importSource, { env });
  const existingFamily = await readJsonIfExists(
    familyManifestPath(rootDir, familyName),
  );
  const familyManifest = buildFamilyManifest({
    rootDir,
    importSource,
    inventory,
    existingFamily,
  });
  const familyPath = familyManifestPath(rootDir, familyName);
  const changes = [];
  const issues = [];

  const generatedCommands = familyManifest.commands;
  const standaloneCapabilities = [];
  for (const [commandName, command] of Object.entries(generatedCommands)) {
    const reservedArgs = Object.keys(command.args ?? {}).filter((arg) =>
      RESERVED_ARG_NAMES.has(arg),
    );
    if (reservedArgs.length === 0) continue;
    delete generatedCommands[commandName];
    standaloneCapabilities.push({ commandName, command, reservedArgs });
    issues.push({
      severity: "warning",
      message: `${familyName}.${commandName} materialized because it exposes reserved arg(s): ${reservedArgs.join(", ")}`,
    });
  }

  await collectJsonChange(changes, {
    rootDir,
    path: familyPath,
    kind: "family",
    family: familyName,
    manifest: familyManifest,
  });

  for (const standalone of standaloneCapabilities) {
    const capabilityPath = capabilityManifestPath(
      rootDir,
      familyManifest,
      standalone.commandName,
    );
    const existingCapability = await readJsonIfExists(capabilityPath);
    const capability = buildStandaloneCapability({
      familyManifest,
      commandName: standalone.commandName,
      command: standalone.command,
      existingCapability,
    });
    await collectJsonChange(changes, {
      rootDir,
      path: capabilityPath,
      kind: "capability",
      family: familyName,
      command: standalone.commandName,
      manifest: capability,
    });
  }

  return {
    kind: importSource.kind,
    family: familyName,
    commandCount: inventory.commands?.length ?? 0,
    materializedCount: standaloneCapabilities.length,
    changes,
    issues,
  };
}

async function readAxInventory(rootDir, importSource, { env }) {
  const cwd = resolveImportCwd(rootDir, importSource);
  const launcher = importSource.launcher ?? DEFAULT_AX_LAUNCHER;
  const targetPath = path.resolve(rootDir, importSource.path);
  const args = [
    ...(launcher.args ?? []),
    targetPath,
    ...(importSource.inventoryArgs ?? ["list", "-Json"]),
  ];
  const result = await spawnCapture(launcher.command, args, { cwd, env });
  if (result.code !== 0) {
    throw new AxError(
      `ax inventory scout failed for '${importSource.family}' with exit code ${result.code}: ${result.stderr || result.stdout}`,
      1,
    );
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed.commands)) {
      throw new Error("missing commands array");
    }
    return parsed;
  } catch (error) {
    throw new AxError(
      `ax inventory scout for '${importSource.family}' did not return valid JSON: ${error.message}`,
      1,
    );
  }
}

function resolveImportCwd(rootDir, importSource) {
  if (!importSource.cwd) return rootDir;
  return path.resolve(rootDir, importSource.cwd);
}

function spawnCapture(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const invocation = prepareCommandInvocation(command, args, {
      env,
      platform: process.platform,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function buildFamilyManifest({ importSource, inventory, existingFamily }) {
  const familyName = importSource.family;
  const executionTarget = importSource.executionTarget ??
    existingFamily?.executionTarget ?? {
      launcher: importSource.executionLauncher ?? DEFAULT_AX_LAUNCHER,
      target: { path: importSource.path, relativeTo: "workspace" },
    };
  const family = {
    manifestVersion: existingFamily?.manifestVersion ?? "axf/v0",
    family: familyName,
    scope: importSource.scope ?? existingFamily?.scope ?? "global",
    provider: importSource.provider ?? existingFamily?.provider ?? familyName,
    adapterType:
      importSource.adapterType ?? existingFamily?.adapterType ?? "cli",
    providerArgStyle:
      importSource.providerArgStyle ??
      existingFamily?.providerArgStyle ??
      "powershell-pascal",
    lifecycleState: normalizeLifecycleState(
      importSource.lifecycleState ?? existingFamily?.lifecycleState ?? "active",
    ),
    owner:
      importSource.owner ?? existingFamily?.owner ?? `module:${familyName}`,
    outputModes: importSource.outputModes ??
      existingFamily?.outputModes ?? ["json"],
    policies: importSource.policies ??
      existingFamily?.policies ?? ["require_workspace_binding"],
    executionTarget,
    commands: {},
  };

  for (const axCommand of inventory.commands) {
    const providerCommandName = axCommand.name;
    if (
      !providerCommandName ||
      providerCommandName === "help" ||
      providerCommandName === "list"
    ) {
      continue;
    }
    const commandName = toKebab(providerCommandName);
    const existingCommand = existingFamily?.commands?.[commandName] ?? {};
    const args = buildArgs(axCommand, existingCommand);
    const familyCommand = {
      summary:
        existingCommand.summary ??
        axCommand.description ??
        `${familyName} ${commandName}`,
      executionTarget: existingCommand.executionTarget ?? {
        ...executionTarget,
        args: [providerCommandName],
      },
      argsSchema: buildArgsSchema(axCommand, args, existingCommand.argsSchema),
      sideEffects:
        axCommand.sideEffects ?? existingCommand.sideEffects ?? "unknown",
      args,
    };
    copyScoutDescriptiveMetadata(familyCommand, existingCommand, axCommand);
    family.commands[commandName] = familyCommand;
    for (const key of [
      "outputModes",
      "defaults",
      "lifecycleState",
      "policies",
      "owner",
    ]) {
      if (existingCommand[key] !== undefined) {
        family.commands[commandName][key] = existingCommand[key];
      }
    }
  }

  return family;
}

function buildArgs(axCommand, existingCommand) {
  const existingArgs = existingCommand.args ?? {};
  const args = {};
  for (const parameter of axCommand.parameters ?? []) {
    const publicName = resolvePublicArgName(parameter.name, existingArgs);
    args[publicName] = existingArgs[publicName] ?? {};
  }
  return args;
}

function resolvePublicArgName(parameterName, existingArgs) {
  const normalized = toKebab(parameterName);
  for (const [publicName, spec] of Object.entries(existingArgs ?? {})) {
    if (
      spec?.providerFlag?.replace(/^-+/, "").toLowerCase() ===
      parameterName.toLowerCase()
    ) {
      return publicName;
    }
  }
  return normalized;
}

function buildArgsSchema(axCommand, args, existingArgsSchema) {
  const existingProperties = existingArgsSchema?.properties ?? {};
  const properties = {};
  for (const parameter of axCommand.parameters ?? []) {
    const publicName = resolvePublicArgName(parameter.name, args);
    properties[publicName] = {
      type: jsonSchemaType(parameter),
      ...(existingProperties[publicName] ?? {}),
    };
  }
  const schema = { type: "object", properties };
  const required = (existingArgsSchema?.required ?? []).filter(
    (name) => properties[name],
  );
  if (required.length > 0) {
    schema.required = required;
  }
  const oneOf = (existingArgsSchema?.oneOf ?? []).filter((clause) =>
    (clause.required ?? []).every((name) => properties[name]),
  );
  if (oneOf.length > 0) {
    schema.oneOf = oneOf;
  }
  schema.additionalProperties = false;
  return schema;
}

function jsonSchemaType(parameter) {
  if (parameter.switch) return "boolean";
  if (
    /^(SByte|Byte|Int16|UInt16|Int32|UInt32|Int64|UInt64)$/.test(
      parameter.type ?? "",
    )
  ) {
    return "integer";
  }
  if (/^(Single|Double|Decimal)$/.test(parameter.type ?? "")) {
    return "number";
  }
  if (/^Boolean$/.test(parameter.type ?? "")) {
    return "boolean";
  }
  return "string";
}

function buildStandaloneCapability({
  familyManifest,
  commandName,
  command,
  existingCapability,
}) {
  const scope = familyManifest.scope ?? "global";
  const idPrefix = scope === "workspace-local" ? "workspace" : "global";
  const id = `${idPrefix}.${familyManifest.family}.${commandName}`;
  const manifest = {
    manifestVersion: familyManifest.manifestVersion,
    id,
    summary: existingCapability?.summary ?? command.summary,
    provider: existingCapability?.provider ?? familyManifest.provider,
    adapterType: existingCapability?.adapterType ?? familyManifest.adapterType,
    executionTarget: command.executionTarget,
    argsSchema: mergeArgsSchema(
      command.argsSchema,
      existingCapability?.argsSchema,
    ),
    outputModes: existingCapability?.outputModes ??
      command.outputModes ??
      familyManifest.outputModes ?? ["json"],
    sideEffects: command.sideEffects,
    scope,
    lifecycleState: normalizeLifecycleState(
      existingCapability?.lifecycleState ??
        command.lifecycleState ??
        familyManifest.lifecycleState ??
        "active",
    ),
    defaults: existingCapability?.defaults ?? command.defaults ?? {},
    policies:
      existingCapability?.policies ??
      command.policies ??
      familyManifest.policies ??
      [],
    owner: existingCapability?.owner ?? command.owner ?? familyManifest.owner,
    argMap:
      existingCapability?.argMap ??
      computeArgMap(command.args ?? {}, familyManifest),
  };
  copyScoutDescriptiveMetadata(manifest, existingCapability, command);
  if (existingCapability?.sourceFamily) {
    manifest.sourceFamily = existingCapability.sourceFamily;
  }
  return manifest;
}

function copyScoutDescriptiveMetadata(target, ...sources) {
  const candidates = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    candidates.push(source);
    if (
      source.metadata &&
      typeof source.metadata === "object" &&
      !Array.isArray(source.metadata)
    ) {
      candidates.push(source.metadata);
    }
  }

  return copyDescriptiveMetadata(target, ...candidates);
}

function mergeArgsSchema(generated, existing) {
  if (!existing) return generated;
  const properties = {};
  for (const [name, property] of Object.entries(generated.properties ?? {})) {
    properties[name] = {
      ...property,
      ...(existing.properties?.[name] ?? {}),
    };
  }
  const schema = { type: generated.type ?? "object", properties };
  const required = (existing.required ?? []).filter((name) => properties[name]);
  if (required.length > 0) {
    schema.required = required;
  }
  const oneOf = (existing.oneOf ?? []).filter((clause) =>
    (clause.required ?? []).every((name) => properties[name]),
  );
  if (oneOf.length > 0) {
    schema.oneOf = oneOf;
  }
  schema.additionalProperties = generated.additionalProperties ?? false;
  return schema;
}

async function collectJsonChange(
  changes,
  { path: filePath, kind, family, command = null, manifest },
) {
  const expectedJson = stableJson(manifest);
  const current = await readTextIfExists(filePath);
  if (current === expectedJson) return;
  changes.push({
    kind,
    family,
    command,
    path: filePath,
    action: current === null ? "create" : "update",
    expectedJson,
  });
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function familyManifestPath(rootDir, familyName) {
  return path.join(
    rootDir,
    "manifests",
    "families",
    `${familyName}.family.json`,
  );
}

function capabilityManifestPath(rootDir, familyManifest, commandName) {
  const scope = familyManifest.scope ?? "global";
  const idPrefix = scope === "workspace-local" ? "workspace" : "global";
  return path.join(
    rootDir,
    "manifests",
    "capabilities",
    `${idPrefix}.${familyManifest.family}.${commandName}.json`,
  );
}

function normalizeLifecycleState(value) {
  if (value === "stable") return "active";
  return value;
}

function toKebab(name) {
  return name
    .replace(/[:]+/g, "-")
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
