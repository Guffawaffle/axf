import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performOperation } from "../src/mcp/operations.js";

const repoRoot = new URL("..", import.meta.url).pathname;
const LEX_CLI_TARGET = "node_modules/@smartergpt/lex/dist/shared/cli/lex.js";

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
    result.contract.capabilityExamples.includes("global.lex.status"),
    true,
  );
  assert.equal(
    result.contract.capabilityExamples.includes("global.stfc-mod.status"),
    true,
  );
  assert.match(
    result.contract.registryLifecycle.mcpReloadBehavior,
    /per request/,
  );
  assert.equal(
    result.examples.some(
      (example) => example.title === "inspect global.lex.status",
    ),
    true,
  );
  assert.equal(
    result.examples.some(
      (example) => example.title === "run global.lex.status",
    ),
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

test("axf MCP inspect shows package-local framework Lex launch plan", async () => {
  const result = await performOperation({
    operation: "inspect",
    workspace: repoRoot,
    target: { id: "global.lex.note" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.capability.id, "global.lex.note");
  assert.equal(result.launchPlan.requestedCommand, "node");
  assert.notEqual(result.launchPlan.commandSource, "path:missing");
  assert.equal(
    result.launchPlan.targetPath,
    path.join(repoRoot, LEX_CLI_TARGET),
  );
  assert.equal(result.launchPlan.targetSource, "relative:framework");
});

test("axf MCP run executes framework Lex note without bare lex on PATH", async () => {
  const result = await performOperation(
    {
      operation: "run",
      workspace: repoRoot,
      target: { id: "global.lex.note" },
      args: {
        summary: "AXF MCP package-local Lex dry-run note",
        modules: "axf",
        "skip-policy": true,
        "dry-run": true,
      },
    },
    {
      env: {
        ...process.env,
        PATH: path.dirname(process.execPath),
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.code, "FRAME_VALID");
  assert.equal(result.data.data.dryRun, true);
  assert.equal(result.meta.launchPlan.requestedCommand, "node");
  assert.notEqual(result.meta.launchPlan.commandSource, "path:missing");
  assert.equal(
    result.meta.launchPlan.targetPath,
    path.join(repoRoot, LEX_CLI_TARGET),
  );
  assert.equal(result.meta.launchPlan.targetSource, "relative:framework");
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
    target: { id: "global.lex.status" },
  });
});

test("axf run returns structured errors for invalid args", async () => {
  const result = await performOperation({
    operation: "run",
    workspace: repoRoot,
    target: { path: ["lex", "recall"] },
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
