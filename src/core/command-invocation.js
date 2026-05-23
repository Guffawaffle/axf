import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_WINDOWS_PATH_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

export function prepareCommandInvocation(command, args = [], options = {}) {
  const { env = process.env, platform = process.platform } = options;
  const resolution = resolveCommandBinary(command, options);
  const resolvedCommand = resolution.resolvedCommand ?? command;

  if (platform === "win32" && isWindowsCommandShim(resolvedCommand)) {
    return {
      command: env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", resolvedCommand, ...args],
      requestedCommand: command,
      resolvedCommand,
      commandSource: resolution.source,
      launchStrategy: "windows-cmd-shim",
    };
  }

  return {
    command: resolvedCommand,
    args,
    requestedCommand: command,
    resolvedCommand,
    commandSource: resolution.source,
    launchStrategy:
      resolution.resolvedCommand && resolution.resolvedCommand !== command
        ? "resolved-path"
        : "direct",
  };
}

export function resolveCommandBinary(command, options = {}) {
  const { env = process.env, platform = process.platform } = options;
  const pathApi = platform === "win32" ? path.win32 : path.posix;

  if (!shouldSearchPath(command, platform)) {
    return {
      requestedCommand: command,
      resolvedCommand: command,
      source: pathApi.isAbsolute(command) ? "absolute" : "literal",
    };
  }

  for (const candidate of buildPathCandidates(command, { env, platform })) {
    if (!isRunnableFile(candidate, platform)) {
      continue;
    }
    return {
      requestedCommand: command,
      resolvedCommand: candidate,
      source: `path:${path.dirname(candidate)}`,
    };
  }

  return {
    requestedCommand: command,
    resolvedCommand: null,
    source: "path:missing",
  };
}

export function isWindowsCommandShim(filePath) {
  return /\.(cmd|bat)$/i.test(filePath);
}

function buildPathCandidates(command, { env, platform }) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const entries = splitPathEntries(env.PATH ?? "", platform);
  const suffixes = buildExecutableSuffixes(command, { env, platform });
  const candidates = [];
  for (const entry of entries) {
    for (const suffix of suffixes) {
      candidates.push(pathApi.join(entry, suffix));
    }
  }
  return candidates;
}

function buildExecutableSuffixes(command, { env, platform }) {
  if (platform !== "win32") {
    return [command];
  }

  if (path.extname(command)) {
    return [command];
  }

  const pathext = (env.PATHEXT ?? DEFAULT_WINDOWS_PATH_EXTENSIONS.join(";"))
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);

  return [command, ...pathext.map((ext) => `${command}${ext}`)];
}

function splitPathEntries(pathValue, platform) {
  return pathValue
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldSearchPath(command, platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return (
    Boolean(command) &&
    !pathApi.isAbsolute(command) &&
    !command.includes("/") &&
    !command.includes("\\")
  );
}

function isRunnableFile(filePath, platform) {
  try {
    if (typeof globalThis.__AXF_TEST_FILE_EXISTS === "function") {
      return Boolean(globalThis.__AXF_TEST_FILE_EXISTS(filePath, platform));
    }
    if (platform === "win32") {
      return existsSync(filePath);
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
