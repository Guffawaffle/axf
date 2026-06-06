import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/core/registry.js";
import { resolveCapability } from "../src/core/resolver.js";
import { executeResolvedCapability } from "../src/core/executor.js";
import { loadAdapters } from "../src/core/adapter-loader.js";
import { UnknownCapabilityError } from "../src/core/errors.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

async function ctx() {
  const registry = await createRegistry({ rootDir });
  const adapters = await loadAdapters({ rootDir });
  return { registry, adapters };
}

async function integerFamilyRegistry() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-resolver-family-"));
  await mkdir(path.join(tmp, "manifests", "families"), { recursive: true });
  await writeFile(
    path.join(tmp, "manifests", "families", "demo.family.json"),
    JSON.stringify({
      manifestVersion: "axf/v0",
      family: "demo",
      scope: "global",
      provider: "demo",
      adapterType: "cli",
      lifecycleState: "active",
      commands: {
        recall: {
          summary: "demo recall",
          executionTarget: { command: "demo", args: ["recall"] },
          args: {
            list: { type: "integer" },
          },
        },
      },
    }),
  );
  return createRegistry({ rootDir: tmp });
}

test("resolves a global capability path to an explicit global id", async () => {
  const { registry } = await ctx();
  const resolved = resolveCapability(registry, ["echo", "say"], {
    args: { message: "hello" },
  });

  assert.equal(resolved.capability.id, "global.echo.say");
  assert.equal(resolved.capability.scope, "global");
  assert.deepEqual(resolved.args, { message: "hello" });
});

test("resolves a mounted capability without flattening it into the global id", async () => {
  const { registry } = await ctx();
  const resolved = resolveCapability(registry, ["toy", "echo", "say"], {
    args: { message: "hello" },
  });

  assert.equal(resolved.capability.id, "toolspace.toy.echo.say");
  assert.equal(resolved.capability.sourceCapabilityId, "global.echo.say");
  assert.equal(resolved.capability.scope, "toolspace-local");
  assert.deepEqual(resolved.args, { prefix: "toy", message: "hello" });
});

test("executes an internal global capability", async () => {
  const { registry, adapters } = await ctx();
  const resolved = resolveCapability(registry, ["echo", "say"], {
    args: { message: "hello" },
  });
  const result = await executeResolvedCapability(resolved, { adapters });

  assert.equal(result.ok, true);
  assert.equal(result.data, "hello");
  assert.equal(result.meta.capabilityId, "global.echo.say");
});

test("executes a mounted capability with injected defaults", async () => {
  const { registry, adapters } = await ctx();
  const resolved = resolveCapability(registry, ["toy", "echo", "say"], {
    args: { message: "hello" },
  });
  const runtime = {
    workspace: { root: "/srv/axf", viaMarker: true, source: "cwd-marker" },
  };
  const result = await executeResolvedCapability(resolved, {
    adapters,
    runtime,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data, "toy: hello");
  assert.equal(result.meta.sourceCapabilityId, "global.echo.say");
});

test("blocks non-active capabilities unless --allow-draft", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-resolver-"));
  await mkdir(path.join(tmp, "manifests", "capabilities"), { recursive: true });
  await writeFile(
    path.join(tmp, "manifests", "capabilities", "global.echo.draft.json"),
    JSON.stringify({
      manifestVersion: "axf/v0",
      id: "global.echo.draft",
      summary: "Draft fixture for the lifecycle gate.",
      provider: "draft",
      adapterType: "internal",
      executionTarget: { handler: "echo.say" },
      argsSchema: { type: "object", properties: {} },
      outputModes: ["json"],
      sideEffects: "none",
      scope: "global",
      lifecycleState: "draft",
      defaults: {},
      policies: [],
      owner: "test",
    }),
  );
  const registry = await createRegistry({ rootDir: tmp });
  assert.throws(
    () => resolveCapability(registry, ["echo", "draft"], { args: {} }),
    /draft/,
  );
});

test("schema validation rejects wrong types", async () => {
  const registry = await integerFamilyRegistry();
  assert.throws(
    () =>
      resolveCapability(registry, ["demo", "recall"], {
        args: { list: "not-a-number" },
        allowDraft: true,
      }),
    /expected integer/,
  );
});

test("schema coerces string-numerics from the CLI into integers", async () => {
  const registry = await integerFamilyRegistry();
  const resolved = resolveCapability(registry, ["demo", "recall"], {
    args: { list: "5" },
    allowDraft: true,
  });
  assert.equal(resolved.args.list, 5);
});

test("unknown fully qualified capability prefixes suggest runnable capabilities", async () => {
  const { registry } = await ctx();

  assert.throws(
    () => registry.resolveInspectable(["global.echo"]),
    (error) => {
      assert.equal(error instanceof UnknownCapabilityError, true);
      assert.equal(error.code, "UNKNOWN_CAPABILITY");
      assert.equal(error.details.reason, "capability_prefix");
      assert.equal(error.details.prefix, "global.echo");
      assert.ok(
        error.details.suggestions.some(
          (suggestion) => suggestion.id === "global.echo.say",
        ),
      );
      assert.match(error.message, /not a runnable capability/);
      return true;
    },
  );
});

test("framework flags are stripped from validated args", async () => {
  const { registry } = await ctx();
  const resolved = resolveCapability(registry, ["echo", "say"], {
    args: { message: "x", json: true, "allow-draft": true },
  });
  assert.deepEqual(resolved.args, { message: "x" });
});
