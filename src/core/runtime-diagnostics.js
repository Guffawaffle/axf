import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  prepareCommandInvocation,
  resolveCommandBinary,
} from "./command-invocation.js";
import { resolveCliLaunchPlan } from "./cli-launch-plan.js";

const OBSERVED_COMMANDS = ["axf", "lex", "node", "npm"];
export const DOCUMENTED_NATIVE_AXF_PATH = "/srv/axf/bin/axf.js";

export function summarizeWorkspaceBinding(registry, workspace, options = {}) {
  const { cwd = process.cwd(), executionWorkspace = null } = options;
  if (!workspace) {
    return {
      projectRoot: null,
      executionRoot: executionWorkspace
        ? summarizeWorkspace(executionWorkspace)
        : null,
      workspace: null,
      executionWorkspace: executionWorkspace
        ? summarizeWorkspace(executionWorkspace)
        : null,
      workspaces: {
        projectRoot: null,
        executionRoot: executionWorkspace
          ? summarizeWorkspace(executionWorkspace)
          : null,
        registryWorkspace: null,
        executionWorkspace: executionWorkspace
          ? summarizeWorkspace(executionWorkspace)
          : null,
      },
      notes: [],
    };
  }

  const workspaceSummary = summarizeWorkspace(workspace);
  const executionWorkspaceSummary = executionWorkspace
    ? summarizeWorkspace(executionWorkspace)
    : null;

  const notes = [];
  if (workspace.source === "script-marker") {
    notes.push(
      `current directory '${cwd}' is not bound to an axf project root; using '${workspace.root}' from the installed axf location instead`,
    );
  }
  if (workspace.source === "cwd-fallback") {
    notes.push(
      `no axf.workspace.json was found from '${cwd}'; axf is treating '${workspace.root}' as a best-effort project root`,
    );
    notes.push(
      `project root marker missing at '${workspace.root}'; scout-style binding checks cannot anchor to this repo until axf.workspace.json exists`,
    );
  }
  if (workspace.source === "explicit" && !workspaceSummary.markerPresent) {
    notes.push(
      `explicit project root '${workspace.root}' does not contain axf.workspace.json`,
    );
    notes.push(
      `project root marker missing at '${workspace.root}'; scout-style binding checks cannot anchor to this repo until axf.workspace.json exists`,
    );
  }
  if (registry.files.length === 0) {
    notes.push(`project root '${workspace.root}' has no axf manifests yet`);
  }

  if (
    executionWorkspaceSummary &&
    executionWorkspaceSummary.root !== workspaceSummary.root
  ) {
    notes.push(
      `project root '${workspaceSummary.root}' differs from execution root '${executionWorkspaceSummary.root}'`,
    );
  }

  const allCapabilities = registry.listCapabilities({ includeDrafts: true });
  const activeCapabilities = registry.listCapabilities({
    includeDrafts: false,
  });
  if (allCapabilities.length === 0) {
    notes.push(`project root '${workspace.root}' has zero capabilities`);
  } else if (activeCapabilities.length === 0) {
    notes.push(
      `project root '${workspace.root}' has no active capabilities; pass --any-lifecycle to include drafts`,
    );
  }

  return {
    projectRoot: workspaceSummary,
    executionRoot: executionWorkspaceSummary,
    workspace: workspaceSummary,
    executionWorkspace: executionWorkspaceSummary,
    workspaces: {
      projectRoot: workspaceSummary,
      executionRoot: executionWorkspaceSummary,
      registryWorkspace: workspaceSummary,
      executionWorkspace: executionWorkspaceSummary,
    },
    notes,
  };
}

export function collectRuntimeDiagnostics(registry, options = {}) {
  const {
    workspace = null,
    executionWorkspace = null,
    env = process.env,
    platform = process.platform,
    osRelease = os.release(),
    cwd = process.cwd(),
  } = options;

  const wsl = isWslEnvironment({ env, platform, osRelease });
  const commands = Object.fromEntries(
    OBSERVED_COMMANDS.map((command) => [
      command,
      resolveCommandBinary(command, { env, platform }),
    ]),
  );

  const runtime = {
    platform,
    wsl,
    osRelease,
    commands,
    documentedNativeAxfPath: {
      path: DOCUMENTED_NATIVE_AXF_PATH,
      exists: existsSync(DOCUMENTED_NATIVE_AXF_PATH),
    },
  };

  const issues = [];
  if (wsl) {
    for (const [command, resolution] of Object.entries(commands)) {
      if (!isWindowsMountedPath(resolution.resolvedCommand)) {
        continue;
      }
      issues.push({
        severity: "warning",
        message: `WSL runtime resolves '${command}' to Windows path '${resolution.resolvedCommand}'`,
      });
    }

    const windowsPathEntries = splitPathEntries(
      env.PATH ?? "",
      platform,
    ).filter(isWindowsMountedPath);
    const windowsNpmEntries = windowsPathEntries.filter(isWindowsNpmBinPath);
    for (const entry of windowsNpmEntries) {
      issues.push({
        severity: "warning",
        message: `WSL PATH includes Windows npm shim directory '${entry}'`,
      });
    }

    if (
      windowsNpmEntries.length > 0 ||
      Object.values(commands).some((r) =>
        isWindowsMountedPath(r.resolvedCommand),
      )
    ) {
      issues.push({
        severity: "warning",
        message:
          "WSL PATH appears contaminated by Windows shims; prefer Linux-native node, npm, axf, and lex earlier on PATH",
      });
    }

    if (!runtime.documentedNativeAxfPath.exists) {
      issues.push({
        severity: "warning",
        message: `WSL detected but documented native axf entry '${DOCUMENTED_NATIVE_AXF_PATH}' is missing`,
      });
    }
  }

  const runtimeContext = workspace
    ? {
        cwd,
        projectRoot: {
          root: workspace.root,
          viaMarker: workspace.viaMarker,
          source: workspace.source,
        },
        registryWorkspace: {
          root: workspace.root,
          viaMarker: workspace.viaMarker,
          source: workspace.source,
        },
        executionRoot: executionWorkspace
          ? {
              root: executionWorkspace.root,
              viaMarker: executionWorkspace.viaMarker,
              source: executionWorkspace.source,
            }
          : {
              root: workspace.root,
              viaMarker: workspace.viaMarker,
              source: workspace.source,
            },
        executionWorkspace: executionWorkspace
          ? {
              root: executionWorkspace.root,
              viaMarker: executionWorkspace.viaMarker,
              source: executionWorkspace.source,
            }
          : {
              root: workspace.root,
              viaMarker: workspace.viaMarker,
              source: workspace.source,
            },
        workspace: executionWorkspace
          ? {
              root: executionWorkspace.root,
              viaMarker: executionWorkspace.viaMarker,
              source: executionWorkspace.source,
            }
          : {
              root: workspace.root,
              viaMarker: workspace.viaMarker,
              source: workspace.source,
            },
      }
    : { cwd };
  const seen = new Set();
  for (const capability of registry.listCapabilities({ includeDrafts: true })) {
    if (capability.adapterType !== "cli") {
      continue;
    }

    let launchPlan;
    try {
      launchPlan = resolveCliLaunchPlan(capability, {
        runtime: runtimeContext,
        env,
      });
    } catch {
      continue;
    }

    const invocation = prepareCommandInvocation(
      launchPlan.command,
      launchPlan.argsPrefix,
      {
        env,
        platform,
      },
    );
    if (isCrossOsPath(invocation.resolvedCommand, { platform, wsl })) {
      const message = `cli capability '${capability.id}' resolves command '${invocation.requestedCommand}' to cross-OS path '${invocation.resolvedCommand}'`;
      if (!seen.has(message)) {
        seen.add(message);
        issues.push({ severity: "warning", message });
      }
    }
    if (isCrossOsPath(launchPlan.targetPath, { platform, wsl })) {
      const message = `cli capability '${capability.id}' targets cross-OS path '${launchPlan.targetPath}'`;
      if (!seen.has(message)) {
        seen.add(message);
        issues.push({ severity: "warning", message });
      }
    }
  }

  return { runtime, issues };
}

function summarizeWorkspace(workspace) {
  return {
    root: workspace.root,
    source: workspace.source,
    viaMarker: workspace.viaMarker,
    markerPath: path.join(workspace.root, "axf.workspace.json"),
    markerPresent:
      workspace.viaMarker ||
      existsSync(path.join(workspace.root, "axf.workspace.json")),
  };
}

function isWslEnvironment({ env, platform, osRelease }) {
  if (platform !== "linux") {
    return false;
  }
  return Boolean(
    env.WSL_INTEROP || env.WSL_DISTRO_NAME || /microsoft/i.test(osRelease),
  );
}

function splitPathEntries(pathValue, platform) {
  return pathValue
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isWindowsMountedPath(filePath) {
  return typeof filePath === "string" && /^\/mnt\/[a-z](\/|$)/i.test(filePath);
}

function isWindowsDrivePath(filePath) {
  return typeof filePath === "string" && /^[a-z]:[\\/]/i.test(filePath);
}

function isCrossOsPath(filePath, { platform, wsl }) {
  if (!filePath) {
    return false;
  }
  if (platform === "win32") {
    return typeof filePath === "string" && filePath.startsWith("/");
  }
  if (wsl) {
    return isWindowsMountedPath(filePath) || isWindowsDrivePath(filePath);
  }
  return false;
}

function isWindowsNpmBinPath(entry) {
  return (
    /\/AppData\/Roaming\/npm(\/|$)/i.test(entry) ||
    /\\AppData\\Roaming\\npm(\\|$)/i.test(entry)
  );
}
