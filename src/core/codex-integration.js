import { readFile, writeFile, rename, stat, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform as hostPlatform } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@smartergpt/axf";
const ROOT_ENV_KEYS = [
  "AXF_PROJECT_ROOT",
  "AXF_EXECUTION_ROOT",
  "AXF_MACHINE_ROOT",
  "AXF_WORKSPACE",
  "AXF_REGISTRY_WORKSPACE",
  "AXF_EXECUTION_WORKSPACE",
];

export function resolveCodexConfigPath({ configPath, env = process.env } = {}) {
  if (configPath) return { path: path.resolve(configPath), source: "argument" };
  if (env.CODEX_HOME) {
    return { path: path.join(env.CODEX_HOME, "config.toml"), source: "env:CODEX_HOME" };
  }
  const home = env.USERPROFILE || env.HOME || homedir();
  return { path: path.join(home, ".codex", "config.toml"), source: "home" };
}

function readString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function assignment(body, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*([^\\r\\n#]+)`, "m").exec(body);
  return match ? readString(match[1]) : null;
}

function stringArray(body, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\[[\\s\\S]*?\\])`, "m").exec(body);
  if (!match) return [];
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)].map((item) =>
    item[1] === undefined ? item[2] : JSON.parse(`"${item[1]}"`),
  );
}

function serverSections(source) {
  const headers = [...source.matchAll(/^\s*\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$/gm)];
  return headers.map((header, index) => {
    const start = header.index;
    const bodyStart = start + header[0].length;
    const nextHeader = source.slice(bodyStart).search(/^\s*\[/m);
    const end = nextHeader < 0 ? source.length : bodyStart + nextHeader;
    return {
      id: header[1],
      start,
      end,
      body: source.slice(bodyStart, end),
      order: index,
    };
  });
}

function nestedSectionBody(source, serverId, suffix) {
  const escaped = serverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*\\[mcp_servers\\.${escaped}\\.${suffix}\\]\\s*$`, "m").exec(
    source,
  );
  if (!header) return "";
  const bodyStart = header.index + header[0].length;
  const nextHeader = source.slice(bodyStart).search(/^\s*\[/m);
  const end = nextHeader < 0 ? source.length : bodyStart + nextHeader;
  return source.slice(bodyStart, end);
}

function rootEnvironment(source, section) {
  const nestedEnv = nestedSectionBody(source, section.id, "env");
  const values = {};
  for (const key of ROOT_ENV_KEYS) {
    const fromNested = assignment(nestedEnv, key);
    const inline = new RegExp(`${key}\\s*=\\s*("[^"\\r\\n]*"|'[^'\\r\\n]*')`).exec(
      section.body,
    );
    const value = fromNested ?? (inline ? readString(inline[1]) : null);
    if (value !== null) values[key] = value;
  }
  return values;
}

function packageSpec(args) {
  return args.find((arg) => arg === PACKAGE_NAME || arg.startsWith(`${PACKAGE_NAME}@`)) ?? null;
}

function versionFromSpec(spec) {
  if (!spec || spec === PACKAGE_NAME) return null;
  return spec.slice(`${PACKAGE_NAME}@`.length) || null;
}

function compareVersion(configured, runtime) {
  if (!configured) return "unpinned";
  if (configured === runtime) return "current";
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(configured)) return "floating";
  return "stale";
}

export function inspectCodexConfig(source, runtimeVersion) {
  const sections = serverSections(source);
  const candidates = sections
    .map((section) => {
      const args = stringArray(section.body, "args");
      const command = assignment(section.body, "command");
      const spec = packageSpec(args);
      const score = spec ? 100 : /(?:^|[\\/])axf(?:-mcp)?(?:\.cmd)?$/i.test(command || "") ? 50 : 0;
      return { section, args, command, spec, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.section.order - b.section.order);
  const selected = candidates[0] ?? null;
  if (!selected) return { server: null, status: "missing", sections };

  const configuredVersion = versionFromSpec(selected.spec);
  return {
    server: {
      id: selected.section.id,
      command: selected.command,
      args: selected.args,
      cwd: assignment(selected.section.body, "cwd"),
      rootEnvironment: rootEnvironment(source, selected.section),
      packageSpec: selected.spec,
      configuredVersion,
      section: selected.section,
    },
    status: compareVersion(configuredVersion, runtimeVersion),
    sections,
  };
}

export function updateAxFPackagePin(source, server, runtimeVersion) {
  if (!server?.packageSpec) return { source, changed: false };
  const replacement = `${PACKAGE_NAME}@${runtimeVersion}`;
  if (server.packageSpec === replacement) return { source, changed: false };
  const body = source.slice(server.section.start, server.section.end);
  const updatedBody = body.replace(server.packageSpec, replacement);
  if (updatedBody === body) return { source, changed: false };
  return {
    source:
      source.slice(0, server.section.start) + updatedBody + source.slice(server.section.end),
    changed: true,
  };
}

function parseResponses(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function smokeCodexMcp(server, {
  projectRoot,
  executionRoot,
  env = process.env,
  platform = hostPlatform(),
  runner = spawnSync,
} = {}) {
  if (!server?.command) return { ok: false, error: "AXF MCP command is missing." };
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "axf-integrate", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "axf", arguments: { operation: "doctor", projectRoot, executionRoot } } },
  ];
  const result = runner(server.command, server.args, {
    cwd: server.cwd || executionRoot || projectRoot || process.cwd(),
    env: { ...env, ...server.rootEnvironment },
    input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    encoding: "utf-8",
    timeout: 20_000,
    shell: platform === "win32" && /\.(cmd|bat)$/i.test(server.command),
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || String(result.stderr || `exit ${result.status}`),
    };
  }
  const responses = parseResponses(result.stdout);
  const initialize = responses.find((item) => item.id === 1);
  const tools = responses.find((item) => item.id === 2);
  const doctor = responses.find((item) => item.id === 3);
  const ok = Boolean(
    initialize?.result?.serverInfo?.name === "axf-mcp" &&
      tools?.result?.tools?.some((tool) => tool.name === "axf") &&
      doctor?.result &&
      !doctor.error,
  );
  return {
    ok,
    initialize: initialize?.result?.serverInfo ?? null,
    toolNames: tools?.result?.tools?.map((tool) => tool.name) ?? [],
    doctor: doctor?.result ?? doctor?.error ?? null,
    ...(ok ? {} : { error: "MCP initialize, tools/list, or explicit-root doctor failed." }),
  };
}

async function runtimeVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(path.join(here, "..", "..", "package.json"), "utf-8"));
  return pkg.version;
}

export async function integrateCodex(options = {}) {
  const version = options.runtimeVersion ?? (await runtimeVersion());
  const config = resolveCodexConfigPath(options);
  const exists = existsSync(config.path);
  const source = exists ? await readFile(config.path, "utf-8") : "";
  let inspection = inspectCodexConfig(source, version);
  let changed = false;

  if (options.write && inspection.server) {
    const update = updateAxFPackagePin(source, inspection.server, version);
    if (update.changed) {
      const tempPath = `${config.path}.axf-${process.pid}.tmp`;
      const configStat = await stat(config.path);
      await writeFile(tempPath, update.source, {
        encoding: "utf-8",
        mode: configStat.mode,
      });
      await chmod(tempPath, configStat.mode);
      await rename(tempPath, config.path);
      changed = true;
      inspection = inspectCodexConfig(update.source, version);
    }
  }

  const issues = [];
  if (!exists) issues.push({ severity: "error", code: "CODEX_CONFIG_NOT_FOUND", message: `Codex config not found: ${config.path}` });
  if (!inspection.server) issues.push({ severity: "error", code: "AXF_MCP_NOT_CONFIGURED", message: "No AXF MCP server was found in Codex config." });
  if (inspection.status === "stale") issues.push({ severity: "error", code: "AXF_PACKAGE_PIN_STALE", message: `Configured AXF ${inspection.server.configuredVersion} does not match running AXF ${version}.` });
  if (inspection.status === "unpinned" || inspection.status === "floating") issues.push({ severity: "warning", code: "AXF_PACKAGE_NOT_EXACT", message: "The AXF MCP package is not pinned to the running exact version." });

  const smoke = options.smoke && inspection.server
    ? smokeCodexMcp(inspection.server, {
        projectRoot: options.projectRoot,
        executionRoot: options.executionRoot,
        env: options.env,
        platform: options.platform,
        runner: options.runner,
      })
    : null;
  if (smoke && !smoke.ok) issues.push({ severity: "error", code: "AXF_MCP_SMOKE_FAILED", message: smoke.error });

  const report = {
    schemaVersion: "axf/codex-integration/v1",
    ok: !issues.some((issue) => issue.severity === "error"),
    config: { ...config, exists },
    runtime: { package: PACKAGE_NAME, version },
    configured: inspection.server
      ? {
          id: inspection.server.id,
          command: inspection.server.command,
          args: inspection.server.args,
          cwd: inspection.server.cwd,
          rootEnvironment: inspection.server.rootEnvironment,
          packageSpec: inspection.server.packageSpec,
          version: inspection.server.configuredVersion,
          status: inspection.status,
        }
      : null,
    action: {
      writeRequested: Boolean(options.write),
      changed,
      restartRequired: changed,
      next: changed ? "Restart or reopen Codex before using the updated MCP server." : null,
    },
    smoke,
    issues,
  };
  return report;
}
