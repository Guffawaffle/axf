import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/core/registry.js";
import { resolveCapability } from "../src/core/resolver.js";
import { executeResolvedCapability } from "../src/core/executor.js";
import { loadAdapters } from "../src/core/adapter-loader.js";
import { main } from "../src/cli/main.js";
import { prepareCommandInvocation } from "../src/core/command-invocation.js";
import { resolveCliLaunchPlan } from "../src/core/cli-launch-plan.js";

const frameworkRoot = fileURLToPath(new URL("..", import.meta.url));
const LEX_CLI_TARGET = "node_modules/@smartergpt/lex/dist/shared/cli/lex.js";

test("cli adapter resolves a framework-relative target through a declared launcher", async () => {
  const framework = await mkdtemp(path.join(os.tmpdir(), "ax-cli-framework-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ax-cli-workspace-"));
  try {
    await mkdir(path.join(framework, "tools"), { recursive: true });
    await writeFile(
      path.join(framework, "tools", "tool.mjs"),
      `console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n`,
    );

    const launchPlan = resolveCliLaunchPlan(
      {
        id: "global.demo.framework",
        executionTarget: {
          launcher: { command: process.execPath },
          target: {
            path: "tools/tool.mjs",
            relativeTo: "framework",
          },
          args: ["seed"],
        },
      },
      {
        frameworkRoot: framework,
        runtime: {
          workspace: { root: workspace, viaMarker: true, source: "explicit" },
        },
      },
    );

    assert.equal(launchPlan.command, process.execPath);
    assert.deepEqual(launchPlan.argsPrefix, [
      path.join(framework, "tools", "tool.mjs"),
      "seed",
    ]);
    assert.equal(launchPlan.cwd, workspace);
    assert.equal(launchPlan.cwdSource, "workspace");
    assert.equal(
      launchPlan.targetPath,
      path.join(framework, "tools", "tool.mjs"),
    );
    assert.equal(launchPlan.targetSource, "relative:framework");
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cli adapter resolves hoisted framework dependency targets", async () => {
  const framework = await mkdtemp(path.join(os.tmpdir(), "ax-cli-framework-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ax-cli-workspace-"));
  try {
    const launchPlan = resolveCliLaunchPlan(
      {
        id: "global.lex.note",
        executionTarget: {
          launcher: { command: process.execPath },
          target: {
            path: LEX_CLI_TARGET,
            relativeTo: "framework",
          },
          args: ["remember", "--json"],
        },
      },
      {
        frameworkRoot: framework,
        runtime: {
          workspace: { root: workspace, viaMarker: true, source: "explicit" },
        },
      },
    );

    assert.equal(launchPlan.targetSource, "package:@smartergpt/lex");
    assert.equal(launchPlan.argsPrefix[0], launchPlan.targetPath);
    assert.equal(path.basename(launchPlan.targetPath), "lex.js");
    assert.match(
      launchPlan.targetPath,
      /node_modules[/\\]@smartergpt[/\\]lex[/\\]dist[/\\]shared[/\\]cli[/\\]lex\.js$/,
    );
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cli adapter resolves a workspace-relative target through a declared launcher", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
  try {
    await bootstrapWorkspace(root);
    await mkdir(path.join(root, "tools"), { recursive: true });
    await writeFile(
      path.join(root, "tools", "echo.mjs"),
      `console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n`,
    );
    await writeCapability(root, {
      manifestVersion: "axf/v0",
      id: "global.demo.echo",
      summary: "demo",
      provider: "demo",
      adapterType: "cli",
      executionTarget: {
        launcher: { command: process.execPath },
        target: {
          path: "tools/echo.mjs",
          relativeTo: "workspace",
        },
        args: ["seed"],
      },
      argsSchema: {
        type: "object",
        properties: { message: { type: "string" } },
      },
      outputModes: ["json"],
      sideEffects: "none",
      scope: "global",
      lifecycleState: "active",
      defaults: {},
      policies: [],
      owner: "test",
    });

    const registry = await createRegistry({ rootDir: root });
    const adapters = await loadAdapters({ rootDir: frameworkRoot });
    const resolved = resolveCapability(registry, ["demo", "echo"], {
      args: { message: "hello" },
    });
    const result = await executeResolvedCapability(resolved, {
      adapters,
      runtime: { workspace: { root, viaMarker: true, source: "explicit" } },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      argv: ["seed", "--message", "hello"],
      cwd: root,
    });
    assert.equal(result.meta.launchPlan.command, process.execPath);
    assert.equal(result.meta.launchPlan.cwd, root);
    assert.equal(result.meta.launchPlan.cwdSource, "workspace");
    assert.equal(
      result.meta.launchPlan.targetPath,
      path.join(root, "tools", "echo.mjs"),
    );
    assert.equal(result.meta.launchPlan.targetSource, "relative:workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli execution uses bound workspace cwd when invoked elsewhere", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
  const caller = await mkdtemp(path.join(os.tmpdir(), "ax-cli-caller-"));
  try {
    await bootstrapWorkspace(root);
    await mkdir(path.join(root, "tools"), { recursive: true });
    await writeFile(
      path.join(root, "tools", "cwd.mjs"),
      `console.log(JSON.stringify({ cwd: process.cwd(), marker: process.argv.slice(2) }));\n`,
    );
    await writeCapability(root, {
      manifestVersion: "axf/v0",
      id: "global.demo.cwd",
      summary: "cwd reporter",
      provider: "demo",
      adapterType: "cli",
      executionTarget: {
        launcher: { command: process.execPath },
        target: {
          path: "tools/cwd.mjs",
          relativeTo: "workspace",
        },
        args: ["seed"],
      },
      argsSchema: { type: "object", properties: {} },
      outputModes: ["json"],
      sideEffects: "read",
      scope: "global",
      lifecycleState: "active",
      defaults: {},
      policies: [],
      owner: "test",
    });

    const out = await captureStdout(() =>
      main(["--workspace", root, "run", "global.demo.cwd", "--json"], {
        cwd: caller,
        env: process.env,
      }),
    );
    const result = JSON.parse(out);

    assert.equal(result.ok, true);
    assert.equal(result.data.cwd, root);
    assert.deepEqual(result.data.marker, ["seed"]);
    assert.equal(result.meta.cwd, root);
    assert.equal(result.meta.launchPlan.cwd, root);
    assert.equal(result.meta.launchPlan.cwdSource, "workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(caller, { recursive: true, force: true });
  }
});

test("cli executionTarget cwd overrides the workspace default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
  const caller = await mkdtemp(path.join(os.tmpdir(), "ax-cli-caller-"));
  const workDir = path.join(root, "packages", "app");
  try {
    await bootstrapWorkspace(root);
    await mkdir(path.join(root, "tools"), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      path.join(root, "tools", "cwd.mjs"),
      `console.log(JSON.stringify({ cwd: process.cwd() }));\n`,
    );
    await writeCapability(root, {
      manifestVersion: "axf/v0",
      id: "global.demo.cwd-override",
      summary: "cwd override reporter",
      provider: "demo",
      adapterType: "cli",
      executionTarget: {
        launcher: { command: process.execPath },
        target: {
          path: "tools/cwd.mjs",
          relativeTo: "workspace",
        },
        cwd: { path: "packages/app", relativeTo: "workspace" },
      },
      argsSchema: { type: "object", properties: {} },
      outputModes: ["json"],
      sideEffects: "read",
      scope: "global",
      lifecycleState: "active",
      defaults: {},
      policies: [],
      owner: "test",
    });

    const out = await captureStdout(() =>
      main(["--workspace", root, "run", "global.demo.cwd-override", "--json"], {
        cwd: caller,
        env: process.env,
      }),
    );
    const result = JSON.parse(out);

    assert.equal(result.ok, true);
    assert.equal(result.data.cwd, workDir);
    assert.equal(result.meta.launchPlan.cwd, workDir);
    assert.equal(
      result.meta.launchPlan.cwdSource,
      "executionTarget.cwd:workspace",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(caller, { recursive: true, force: true });
  }
});

test("cli adapter resolves an env-bound target root with a workspace-relative fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
  const sibling = path.join(
    path.dirname(root),
    `${path.basename(root)}-managed`,
  );
  const original = process.env.AX_TARGET_ROOT;
  try {
    await bootstrapWorkspace(root);
    await mkdir(path.join(sibling, "tools"), { recursive: true });
    await writeFile(
      path.join(sibling, "tools", "echo.mjs"),
      `console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n`,
    );
    await writeCapability(root, {
      manifestVersion: "axf/v0",
      id: "global.demo.env",
      summary: "demo",
      provider: "demo",
      adapterType: "cli",
      executionTarget: {
        launcher: { command: process.execPath },
        target: {
          path: "tools/echo.mjs",
          fromEnv: "AX_TARGET_ROOT",
          fallbackRoot: `../${path.basename(sibling)}`,
          fallbackRelativeTo: "workspace",
        },
        args: ["probe"],
      },
      argsSchema: {
        type: "object",
        properties: { note: { type: "string" } },
      },
      outputModes: ["json"],
      sideEffects: "none",
      scope: "global",
      lifecycleState: "active",
      defaults: {},
      policies: [],
      owner: "test",
    });

    delete process.env.AX_TARGET_ROOT;

    const registry = await createRegistry({ rootDir: root });
    const adapters = await loadAdapters({ rootDir: frameworkRoot });
    const resolved = resolveCapability(registry, ["demo", "env"], {
      args: { note: "fallback" },
    });
    const result = await executeResolvedCapability(resolved, {
      adapters,
      runtime: { workspace: { root, viaMarker: true, source: "explicit" } },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      argv: ["probe", "--note", "fallback"],
    });
    assert.equal(result.meta.launchPlan.cwd, root);
    assert.equal(
      result.meta.launchPlan.targetSource,
      "fallback:AX_TARGET_ROOT",
    );

    process.env.AX_TARGET_ROOT = sibling;
    const envResult = await executeResolvedCapability(resolved, {
      adapters,
      runtime: { workspace: { root, viaMarker: true, source: "explicit" } },
    });
    assert.equal(envResult.ok, true);
    assert.equal(envResult.meta.launchPlan.targetSource, "env:AX_TARGET_ROOT");
  } finally {
    if (original === undefined) {
      delete process.env.AX_TARGET_ROOT;
    } else {
      process.env.AX_TARGET_ROOT = original;
    }
    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  }
});

test("inspect --json includes the resolved cli launch plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
  try {
    await bootstrapWorkspace(root);
    await writeCapability(root, {
      manifestVersion: "axf/v0",
      id: "global.demo.inspect",
      summary: "demo",
      provider: "demo",
      adapterType: "cli",
      executionTarget: {
        launcher: {
          command: process.execPath,
          args: ["--no-warnings"],
        },
        target: {
          path: "tools/echo.mjs",
          relativeTo: "workspace",
        },
      },
      argsSchema: { type: "object", properties: {} },
      outputModes: ["json"],
      sideEffects: "none",
      scope: "global",
      lifecycleState: "active",
      defaults: {},
      policies: [],
      owner: "test",
    });

    const out = await captureStdout(() =>
      main(["--workspace", root, "inspect", "demo", "inspect", "--json"]),
    );
    const parsed = JSON.parse(out);

    assert.equal(parsed.launchPlan.command, process.execPath);
    assert.equal(parsed.launchPlan.cwd, root);
    assert.equal(parsed.launchPlan.cwdSource, "workspace");
    assert.deepEqual(parsed.launchPlan.argsPrefix, [
      "--no-warnings",
      path.join(root, "tools", "echo.mjs"),
    ]);
    assert.equal(
      parsed.launchPlan.targetPath,
      path.join(root, "tools", "echo.mjs"),
    );
    assert.equal(parsed.launchPlan.targetSource, "relative:workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli invocation wraps Windows npm cmd shims through cmd.exe", () => {
  const env = {
    PATH: ["C:\\Users\\dev\\AppData\\Roaming\\npm"].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };

  const originalExists = globalThis.__AXF_TEST_FILE_EXISTS;
  globalThis.__AXF_TEST_FILE_EXISTS = (candidate) =>
    candidate.endsWith("lex.CMD");
  try {
    const invocation = prepareCommandInvocation("lex", ["recall", "--json"], {
      env,
      platform: "win32",
    });

    assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(invocation.args, [
      "/d",
      "/s",
      "/c",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\lex.CMD",
      "recall",
      "--json",
    ]);
    assert.equal(invocation.requestedCommand, "lex");
    assert.equal(
      invocation.resolvedCommand,
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\lex.CMD",
    );
    assert.equal(invocation.launchStrategy, "windows-cmd-shim");
  } finally {
    globalThis.__AXF_TEST_FILE_EXISTS = originalExists;
  }
});

test("cli invocation prefers Windows npm cmd shim over extensionless shim", () => {
  const env = {
    PATH: ["C:\\Users\\dev\\AppData\\Roaming\\npm"].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };

  const originalExists = globalThis.__AXF_TEST_FILE_EXISTS;
  globalThis.__AXF_TEST_FILE_EXISTS = (candidate) =>
    candidate.endsWith("lex") || candidate.endsWith("lex.CMD");
  try {
    const invocation = prepareCommandInvocation("lex", ["introspect"], {
      env,
      platform: "win32",
    });

    assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(invocation.args, [
      "/d",
      "/s",
      "/c",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\lex.CMD",
      "introspect",
    ]);
    assert.equal(
      invocation.resolvedCommand,
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\lex.CMD",
    );
    assert.equal(invocation.launchStrategy, "windows-cmd-shim");
  } finally {
    globalThis.__AXF_TEST_FILE_EXISTS = originalExists;
  }
});

async function bootstrapWorkspace(root) {
  await writeFile(
    path.join(root, "axf.workspace.json"),
    JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" }),
  );
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
}

async function writeCapability(root, capability) {
  await writeFile(
    path.join(root, "manifests", "capabilities", `${capability.id}.json`),
    JSON.stringify(capability, null, 2) + "\n",
  );
}

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  return Promise.resolve(fn())
    .finally(() => {
      process.stdout.write = original;
    })
    .then(() => chunks.join(""));
}
