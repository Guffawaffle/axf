import test from "node:test";
import assert from "node:assert/strict";
import { performOperation } from "../src/mcp/operations.js";

const repoRoot = new URL("..", import.meta.url).pathname;

test("axf list returns discovered capabilities", async () => {
  const result = await performOperation({
    operation: "list",
    workspace: repoRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "list");
  assert.ok(result.capabilities.some((capability) => capability.id === "global.echo.say"));
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