import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performOperation } from "../src/mcp/operations.js";

const repoRoot = new URL("..", import.meta.url).pathname;

async function tempAxfRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(
    path.join(root, "axf.workspace.json"),
    JSON.stringify({ manifestVersion: "axf/v0", name: prefix }) + "\n",
  );
  await mkdir(path.join(root, "manifests", "families"), { recursive: true });
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
  return root;
}

async function writeFamily(root, name, manifest) {
  await writeFile(
    path.join(root, "manifests", "families", `${name}.family.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

test("axf help explains the single-tool router contract", async () => {
  const result = await performOperation({
    operation: "help",
    workspace: repoRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "help");
  assert.equal(result.tool.name, "axf");
  assert.equal(result.contract.capabilitiesAreSeparateTools, false);
  assert.equal(
    result.contract.capabilityExamples.includes("global.echo.say"),
    true,
  );
  assert.match(
    result.contract.registryLifecycle.mcpReloadBehavior,
    /per request/,
  );
  assert.equal(
    result.examples.some(
      (example) => example.title === "inspect global.echo.say",
    ),
    true,
  );
  assert.equal(
    result.examples.some((example) => example.title === "run global.echo.say"),
    true,
  );
});

test("axf list returns discovered capabilities", async () => {
  const result = await performOperation({
    operation: "list",
    workspace: repoRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "list");
  assert.ok(
    result.capabilities.some(
      (capability) => capability.id === "global.echo.say",
    ),
  );
  assert.equal(
    result.capabilities.some(
      (capability) =>
        capability.id.startsWith("global.stfc.") ||
        capability.id.startsWith("global.local-pack."),
    ),
    false,
  );
});

test("axf inspect returns capability metadata", async () => {
  const result = await performOperation({
    operation: "inspect",
    workspace: repoRoot,
    target: { id: "global.echo.say" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "inspect");
  assert.equal(result.capability.id, "global.echo.say");
  assert.equal(result.capability.adapterType, "internal");
  assert.equal(result.capability.provider, "echo");
});

test("axf inspect preserves synthesized warnings/details in MCP responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "axf-mcp-meta-"));
  await mkdir(path.join(root, "manifests", "families"), { recursive: true });
  await writeFile(path.join(root, "axf.workspace.json"), "{}\n");
  await writeFile(
    path.join(root, "manifests", "families", "demo.family.json"),
    `${JSON.stringify(
      {
        manifestVersion: "axf/v0",
        family: "demo",
        scope: "global",
        provider: "demo",
        adapterType: "cli",
        executionTarget: { command: "demo" },
        lifecycleState: "active",
        owner: "test",
        outputModes: ["json"],
        sideEffects: "read",
        commands: {
          status: {
            summary: "Show demo status",
            executionTarget: { command: "demo", args: ["status"] },
            warnings: ["Inspect before reading native logs"],
            details: { logPath: "logs/demo.log" },
            args: {},
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await performOperation({
    operation: "inspect",
    workspace: root,
    target: { id: "global.demo.status" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.capability.id, "global.demo.status");
  assert.deepEqual(result.capability.warnings, [
    "Inspect before reading native logs",
  ]);
  assert.deepEqual(result.capability.details, { logPath: "logs/demo.log" });
});

test("axf MCP inspect shows optional machine family provenance", async () => {
  const projectRoot = await tempAxfRoot("axf-mcp-project-");
  const machineRoot = await tempAxfRoot("axf-mcp-machine-");
  await writeFamily(machineRoot, "shared", {
    manifestVersion: "axf/v0",
    family: "shared",
    scope: "global",
    provider: "shared",
    adapterType: "cli",
    lifecycleState: "active",
    commands: {
      status: {
        summary: "machine shared status",
        executionTarget: { command: "shared", args: ["status"] },
        args: {},
        sideEffects: "read",
      },
    },
  });

  const result = await performOperation(
    {
      operation: "inspect",
      workspace: projectRoot,
      target: { id: "global.shared.status" },
    },
    {
      env: { ...process.env, AXF_MACHINE_ROOT: machineRoot },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.capability.id, "global.shared.status");
  assert.equal(result.capability.layer, "machine");
  assert.equal(result.capability.sourceFamily.layer, "machine");
  assert.equal(result.launchPlan.requestedCommand, "shared");
});

test("axf MCP inspect surfaces split registry and execution workspaces", async () => {
  const registryRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-mcp-registry-"),
  );
  const executionRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-mcp-execution-"),
  );
  try {
    await writeFile(
      path.join(registryRoot, "axf.workspace.json"),
      JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" }) + "\n",
    );
    await mkdir(path.join(registryRoot, "manifests", "capabilities"), {
      recursive: true,
    });
    await mkdir(path.join(registryRoot, "tools"), { recursive: true });
    await writeFile(
      path.join(registryRoot, "tools", "echo.mjs"),
      `console.log(JSON.stringify({ cwd: process.cwd() }));\n`,
    );
    await writeFile(
      path.join(
        registryRoot,
        "manifests",
        "capabilities",
        "global.demo.inspect-split.json",
      ),
      JSON.stringify(
        {
          manifestVersion: "axf/v0",
          id: "global.demo.inspect-split",
          summary: "demo",
          provider: "demo",
          adapterType: "cli",
          executionTarget: {
            launcher: { command: process.execPath },
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
        },
        null,
        2,
      ) + "\n",
    );

    const result = await performOperation({
      operation: "inspect",
      registryWorkspace: registryRoot,
      executionWorkspace: executionRoot,
      target: { id: "global.demo.inspect-split" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.projectRoot.root, registryRoot);
    assert.equal(result.executionRoot.root, executionRoot);
    assert.equal(result.workspaces.projectRoot.root, registryRoot);
    assert.equal(result.workspaces.executionRoot.root, executionRoot);
    assert.equal(result.executionWorkspace.root, executionRoot);
    assert.equal(result.launchPlan.cwd, executionRoot);
    assert.equal(
      result.launchPlan.targetPath,
      path.join(registryRoot, "tools", "echo.mjs"),
    );
  } finally {
    await import("node:fs/promises").then(({ rm }) =>
      Promise.all([
        rm(registryRoot, { recursive: true, force: true }),
        rm(executionRoot, { recursive: true, force: true }),
      ]),
    );
  }
});

test("axf MCP inspect accepts projectRoot and executionRoot aliases", async () => {
  const registryRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-mcp-project-root-"),
  );
  const executionRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-mcp-execution-root-"),
  );
  try {
    await writeFile(
      path.join(registryRoot, "axf.workspace.json"),
      JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" }) + "\n",
    );
    await mkdir(path.join(registryRoot, "manifests", "capabilities"), {
      recursive: true,
    });
    await mkdir(path.join(registryRoot, "tools"), { recursive: true });
    await writeFile(
      path.join(registryRoot, "tools", "echo.mjs"),
      `console.log(JSON.stringify({ cwd: process.cwd() }));\n`,
    );
    await writeFile(
      path.join(
        registryRoot,
        "manifests",
        "capabilities",
        "global.demo.inspect-alias.json",
      ),
      JSON.stringify(
        {
          manifestVersion: "axf/v0",
          id: "global.demo.inspect-alias",
          summary: "demo",
          provider: "demo",
          adapterType: "cli",
          executionTarget: {
            launcher: { command: process.execPath },
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
        },
        null,
        2,
      ) + "\n",
    );

    const result = await performOperation({
      operation: "inspect",
      projectRoot: registryRoot,
      executionRoot,
      target: { id: "global.demo.inspect-alias" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.projectRoot.root, registryRoot);
    assert.equal(result.executionRoot.root, executionRoot);
    assert.equal(result.workspaces.projectRoot.root, registryRoot);
    assert.equal(result.workspaces.executionRoot.root, executionRoot);
    assert.equal(result.executionWorkspace.root, executionRoot);
    assert.equal(result.launchPlan.cwd, executionRoot);
    assert.equal(
      result.launchPlan.targetPath,
      path.join(registryRoot, "tools", "echo.mjs"),
    );
  } finally {
    await import("node:fs/promises").then(({ rm }) =>
      Promise.all([
        rm(registryRoot, { recursive: true, force: true }),
        rm(executionRoot, { recursive: true, force: true }),
      ]),
    );
  }
});

test("axf MCP run executes an optional machine family through AXF", async () => {
  const projectRoot = await tempAxfRoot("axf-mcp-project-run-");
  const machineRoot = await tempAxfRoot("axf-mcp-machine-run-");
  await writeFamily(machineRoot, "shared", {
    manifestVersion: "axf/v0",
    family: "shared",
    scope: "global",
    provider: "shared",
    adapterType: "internal",
    lifecycleState: "active",
    commands: {
      note: {
        summary: "machine shared note",
        executionTarget: { handler: "echo.say" },
        args: { message: { type: "string", required: true } },
        sideEffects: "none",
      },
    },
  });

  const result = await performOperation(
    {
      operation: "run",
      workspace: projectRoot,
      target: { id: "global.shared.note" },
      args: { message: "machine hello" },
    },
    {
      env: { ...process.env, AXF_MACHINE_ROOT: machineRoot },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.capability.id, "global.shared.note");
  assert.equal(result.data, "machine hello");
});

test("axf run succeeds for a harmless known AXF capability", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
    target: { id: "global.echo.say" },
    args: { message: "hello via mcp" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "run");
  assert.equal(result.capability.id, "global.echo.say");
  assert.equal(result.data, "hello via mcp");
});

test("axf reports actionable guidance when operation is missing", async () => {
  const result = await performOperation({
    workspace: repoRoot,
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "unknown");
  assert.equal(result.error.code, "INVALID_PARAMS");
  assert.deepEqual(result.error.availableOperations, [
    "help",
    "list",
    "guide",
    "explain",
    "inspect",
    "run",
    "doctor",
    "scout_check",
  ]);
  assert.deepEqual(
    result.error.nextSteps.map((step) => step.arguments.operation),
    ["help", "list", "inspect"],
  );
});

test("axf reports actionable guidance when operation is invalid", async () => {
  const result = await performOperation({
    operation: "deploy",
    workspace: repoRoot,
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "deploy");
  assert.equal(result.error.code, "INVALID_PARAMS");
  assert.match(result.error.message, /Unknown operation 'deploy'/);
  assert.deepEqual(
    result.error.nextSteps.map((step) => step.arguments.operation),
    ["help", "list", "inspect"],
  );
});

test("axf run rejects unknown capability", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
    target: { id: "global.echo.missing" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "run");
  assert.equal(result.error.code, "UNKNOWN_CAPABILITY");
  assert.match(result.error.message, /list/);
  assert.match(result.error.message, /inspect/);
});

test("axf inspect suggests runnable capabilities for capability prefixes", async () => {
  const result = await performOperation({
    operation: "inspect",
    workspace: repoRoot,
    target: { id: "global.echo" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "inspect");
  assert.equal(result.error.code, "UNKNOWN_CAPABILITY");
  assert.equal(result.error.reason, "capability_prefix");
  assert.equal(result.error.prefix, "global.echo");
  assert.ok(
    result.error.suggestions.some(
      (suggestion) => suggestion.id === "global.echo.say",
    ),
  );
  assert.match(result.error.message, /not a runnable capability/);
});

test("axf run suggests runnable capabilities for capability prefixes", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
    target: { id: "global.echo" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "run");
  assert.equal(result.error.code, "UNKNOWN_CAPABILITY");
  assert.equal(result.error.reason, "capability_prefix");
  assert.ok(
    result.error.suggestions.some(
      (suggestion) => suggestion.id === "global.echo.say",
    ),
  );
  assert.equal(result.error.inspectExample.operation, "inspect");
});

test("axf run missing target returns inspect guidance", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "run");
  assert.equal(result.error.code, "INVALID_PARAMS");
  assert.match(result.error.message, /run requires target.id or target.path/);
  assert.equal(result.error.nextStep.arguments.operation, "inspect");
  assert.deepEqual(result.error.inspectExample, {
    operation: "inspect",
    target: { id: "global.echo.say" },
  });
});

test("axf run returns structured errors for invalid args", async () => {
  const projectRoot = await tempAxfRoot("axf-mcp-arg-project-");
  await writeFamily(projectRoot, "demo", {
    manifestVersion: "axf/v0",
    family: "demo",
    scope: "global",
    provider: "demo",
    adapterType: "internal",
    lifecycleState: "active",
    commands: {
      recall: {
        summary: "demo recall",
        executionTarget: { handler: "echo.say" },
        args: { list: { type: "integer" } },
      },
    },
  });

  const result = await performOperation({
    operation: "run",
    workspace: projectRoot,
    target: { path: ["demo", "recall"] },
    args: { list: "not-a-number" },
    allowAnyLifecycle: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.operation, "run");
  assert.equal(result.error.code, "ARG_VALIDATION_ERROR");
  assert.match(result.error.message, /expected integer/);
});

test("axf run uses AXF's existing execution path, not raw shell fallback", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
    target: { path: ["echo", "say"] },
    args: { message: "path check" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.meta, {
    capabilityId: "global.echo.say",
    sourceCapabilityId: null,
    adapterType: "internal",
  });
});

test("axf doctor returns structured diagnostics", async () => {
  const result = await performOperation({
    operation: "doctor",
    workspace: repoRoot,
  });

  assert.equal(result.operation, "doctor");
  assert.equal(Array.isArray(result.issues), true);
  assert.ok(result.runtime);
  assert.ok(result.workspace);
});

test("axf scout_check stays read only", async () => {
  const result = await performOperation({
    operation: "scout_check",
    workspace: repoRoot,
  });

  assert.equal(result.operation, "scout_check");
  assert.equal(result.readOnly, true);
  assert.equal(Array.isArray(result.changes), true);
});
