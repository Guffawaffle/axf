import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxError } from "./errors.js";

const WORKSPACE_RELATIVE = "workspace";
const FRAMEWORK_RELATIVE = "framework";
const NODE_MODULES_PREFIX = `node_modules${path.sep}`;

export const FRAMEWORK_ROOT = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

export function resolveCliLaunchPlan(
  capability,
  { runtime = null, env = process.env, frameworkRoot = FRAMEWORK_ROOT } = {},
) {
  const executionTarget = capability.executionTarget;
  if (!executionTarget || typeof executionTarget !== "object") {
    throw new AxError(
      `cli capability '${capability.id}' is missing a valid executionTarget`,
      2,
    );
  }

  const workingDirectory = resolveWorkingDirectory(
    executionTarget.cwd,
    capability.id,
    runtime,
  );

  const baseArgs = normalizeStringArray(
    executionTarget.args,
    `cli capability '${capability.id}' executionTarget.args`,
  );

  if (typeof executionTarget.command === "string" && executionTarget.command) {
    if (executionTarget.target || executionTarget.launcher) {
      throw new AxError(
        `cli capability '${capability.id}' cannot mix executionTarget.command with executionTarget.target or executionTarget.launcher`,
        2,
      );
    }

    return {
      command: executionTarget.command,
      argsPrefix: baseArgs,
      cwd: workingDirectory.path,
      cwdSource: workingDirectory.source,
      targetPath: null,
      targetSource: "command",
      executionTarget,
    };
  }

  const target = executionTarget.target;
  if (!target || typeof target !== "object") {
    throw new AxError(
      `cli capability '${capability.id}' requires executionTarget.command or executionTarget.target.path`,
      2,
    );
  }

  if (typeof target.path !== "string" || !target.path) {
    throw new AxError(
      `cli capability '${capability.id}' requires executionTarget.target.path`,
      2,
    );
  }

  const resolvedTarget = resolveTargetPath(
    target,
    capability.id,
    runtime,
    env,
    frameworkRoot,
  );
  const launcher = executionTarget.launcher;

  if (!launcher) {
    return {
      command: resolvedTarget.path,
      argsPrefix: baseArgs,
      cwd: workingDirectory.path,
      cwdSource: workingDirectory.source,
      targetPath: resolvedTarget.path,
      targetSource: resolvedTarget.source,
      executionTarget,
    };
  }

  if (typeof launcher !== "object") {
    throw new AxError(
      `cli capability '${capability.id}' executionTarget.launcher must be an object`,
      2,
    );
  }

  if (typeof launcher.command !== "string" || !launcher.command) {
    throw new AxError(
      `cli capability '${capability.id}' requires executionTarget.launcher.command`,
      2,
    );
  }

  const launcherArgs = normalizeStringArray(
    launcher.args,
    `cli capability '${capability.id}' executionTarget.launcher.args`,
  );

  return {
    command: launcher.command,
    argsPrefix: [...launcherArgs, resolvedTarget.path, ...baseArgs],
    cwd: workingDirectory.path,
    cwdSource: workingDirectory.source,
    targetPath: resolvedTarget.path,
    targetSource: resolvedTarget.source,
    executionTarget,
  };
}

function resolveWorkingDirectory(cwdSpec, capabilityId, runtime) {
  const processCwd = runtime?.cwd ?? process.cwd();
  if (cwdSpec === undefined) {
    const workspaceRoot = getExecutionWorkspaceRoot(runtime);
    if (workspaceRoot) {
      return { path: path.resolve(workspaceRoot), source: "workspace" };
    }
    return { path: path.resolve(processCwd), source: "process" };
  }

  if (typeof cwdSpec === "string") {
    return resolveCwdPath(
      cwdSpec,
      "workspace",
      capabilityId,
      runtime,
      processCwd,
    );
  }

  if (typeof cwdSpec !== "object" || Array.isArray(cwdSpec)) {
    throw new AxError(
      `cli capability '${capabilityId}' executionTarget.cwd must be a string or object`,
      2,
    );
  }

  if (typeof cwdSpec.path !== "string" || !cwdSpec.path) {
    throw new AxError(
      `cli capability '${capabilityId}' executionTarget.cwd.path must be a string`,
      2,
    );
  }

  return resolveCwdPath(
    cwdSpec.path,
    cwdSpec.relativeTo ?? "workspace",
    capabilityId,
    runtime,
    processCwd,
  );
}

function resolveCwdPath(
  cwdPath,
  relativeTo,
  capabilityId,
  runtime,
  processCwd,
) {
  if (path.isAbsolute(cwdPath)) {
    return {
      path: path.resolve(cwdPath),
      source: "executionTarget.cwd:absolute",
    };
  }

  if (relativeTo === "workspace") {
    const workspaceRoot = getExecutionWorkspaceRoot(runtime);
    if (!workspaceRoot) {
      throw new AxError(
        `cli capability '${capabilityId}' requires a bound workspace to resolve executionTarget.cwd relativeTo='workspace'`,
        2,
      );
    }
    return {
      path: path.resolve(workspaceRoot, cwdPath),
      source: "executionTarget.cwd:workspace",
    };
  }

  if (relativeTo === "process") {
    return {
      path: path.resolve(processCwd, cwdPath),
      source: "executionTarget.cwd:process",
    };
  }

  throw new AxError(
    `cli capability '${capabilityId}' has unsupported executionTarget.cwd.relativeTo '${relativeTo}'`,
    2,
  );
}

function resolveTargetPath(target, capabilityId, runtime, env, frameworkRoot) {
  if (path.isAbsolute(target.path)) {
    return { path: target.path, source: "absolute" };
  }

  const envName = typeof target.fromEnv === "string" ? target.fromEnv : null;
  if (envName && env[envName]) {
    return {
      path: path.resolve(env[envName], target.path),
      source: `env:${envName}`,
    };
  }

  if (target.fallbackRoot) {
    const root = resolveRelativeRoot(
      target.fallbackRoot,
      target.fallbackRelativeTo,
      capabilityId,
      runtime,
      frameworkRoot,
      envName ? `fallback for ${envName}` : "fallbackRoot",
    );
    return {
      path: path.resolve(root, target.path),
      source: envName ? `fallback:${envName}` : "fallback",
    };
  }

  if (target.relativeTo) {
    if (target.relativeTo === FRAMEWORK_RELATIVE) {
      return resolveFrameworkTargetPath(target.path, frameworkRoot);
    }

    const root = resolveRelativeRoot(
      ".",
      target.relativeTo,
      capabilityId,
      runtime,
      frameworkRoot,
      "relativeTo",
    );
    return {
      path: path.resolve(root, target.path),
      source: `relative:${target.relativeTo}`,
    };
  }

  if (envName) {
    throw new AxError(
      `cli capability '${capabilityId}' could not resolve executionTarget.target.path because ${envName} is unset and no fallbackRoot is declared`,
      2,
    );
  }

  throw new AxError(
    `cli capability '${capabilityId}' uses a relative executionTarget.target.path and must declare target.relativeTo or target.fromEnv`,
    2,
  );
}

function resolveFrameworkTargetPath(targetPath, frameworkRoot) {
  const directPath = path.resolve(frameworkRoot, targetPath);
  if (existsSync(directPath)) {
    return { path: directPath, source: `relative:${FRAMEWORK_RELATIVE}` };
  }

  const packageTarget = parseNodeModulesPackageTarget(targetPath);
  if (!packageTarget) {
    return { path: directPath, source: `relative:${FRAMEWORK_RELATIVE}` };
  }

  const packageRoot =
    findNodeModulesPackageRoot(packageTarget.packageName, frameworkRoot) ??
    findNodeModulesPackageRoot(packageTarget.packageName, FRAMEWORK_ROOT);
  if (packageRoot) {
    return {
      path: path.resolve(packageRoot, packageTarget.subpath),
      source: `package:${packageTarget.packageName}`,
    };
  }

  return { path: directPath, source: `relative:${FRAMEWORK_RELATIVE}` };
}

function findNodeModulesPackageRoot(packageName, frameworkRoot) {
  const packageParts = packageName.split("/");
  const direct = path.resolve(frameworkRoot, "node_modules", ...packageParts);
  if (hasPackageManifest(direct)) {
    return direct;
  }

  const containingNodeModules = findContainingNodeModulesRoot(frameworkRoot);
  if (containingNodeModules) {
    const sibling = path.join(containingNodeModules, ...packageParts);
    if (hasPackageManifest(sibling)) {
      return sibling;
    }
  }

  let current = path.resolve(frameworkRoot);
  while (true) {
    const candidate = path.join(current, "node_modules", ...packageParts);
    if (hasPackageManifest(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findContainingNodeModulesRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (path.basename(current) === "node_modules") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasPackageManifest(packageRoot) {
  return existsSync(path.join(packageRoot, "package.json"));
}

function parseNodeModulesPackageTarget(targetPath) {
  const normalized = path.normalize(targetPath);
  if (!normalized.startsWith(NODE_MODULES_PREFIX)) {
    return null;
  }

  const parts = normalized.slice(NODE_MODULES_PREFIX.length).split(path.sep);
  if (parts.length < 2) {
    return null;
  }

  const packageName = parts[0].startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  const packagePartCount = packageName.startsWith("@") ? 2 : 1;
  const subpath = parts.slice(packagePartCount).join(path.sep);
  if (!subpath) {
    return null;
  }

  return { packageName, subpath };
}

function resolveRelativeRoot(
  rootPath,
  relativeTo,
  capabilityId,
  runtime,
  frameworkRoot,
  contextLabel,
) {
  if (relativeTo === WORKSPACE_RELATIVE) {
    const workspaceRoot = getRegistryWorkspaceRoot(runtime);
    if (!workspaceRoot) {
      throw new AxError(
        `cli capability '${capabilityId}' requires a bound workspace to resolve ${contextLabel}='${relativeTo}'`,
        2,
      );
    }

    return path.resolve(workspaceRoot, rootPath);
  }

  if (relativeTo === FRAMEWORK_RELATIVE) {
    return path.resolve(frameworkRoot, rootPath);
  }

  throw new AxError(
    `cli capability '${capabilityId}' has unsupported ${contextLabel} '${relativeTo}'`,
    2,
  );
}

function normalizeStringArray(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AxError(`${label} must be an array of strings`, 2);
  }
  return value;
}

function getExecutionWorkspaceRoot(runtime) {
  return (
    runtime?.executionRoot?.root ??
    runtime?.executionWorkspace?.root ??
    runtime?.workspace?.root ??
    null
  );
}

function getRegistryWorkspaceRoot(runtime) {
  return (
    runtime?.projectRoot?.root ??
    runtime?.registryWorkspace?.root ??
    runtime?.workspace?.root ??
    null
  );
}
