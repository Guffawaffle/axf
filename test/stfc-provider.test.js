import test from "node:test";
import assert from "node:assert/strict";
import { execute as stfcExecute } from "../adapters/stfc/index.js";

function synthTypeAdapter(upstream) {
  return { execute: async () => upstream };
}

const resolved = {
  capability: { id: "global.stfc.status" },
};

test("unwraps a successful STFC envelope into axf result", async () => {
  const ctx = {
    typeAdapter: synthTypeAdapter({
      ok: true,
      data: {
        command: "status",
        ok: true,
        timestamp: "2026-04-27T00:00:00.000Z",
        durationMs: 12,
        data: { repoRoot: "/tmp/stfc-fixture" },
      },
      meta: { capabilityId: "global.stfc.status", adapterType: "cli" },
    }),
  };
  const result = await stfcExecute(resolved, ctx);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { repoRoot: "/tmp/stfc-fixture" });
  assert.equal(result.meta.stfc.command, "status");
});

test("maps STFC envelope ok=false to axf failure", async () => {
  const ctx = {
    typeAdapter: synthTypeAdapter({
      ok: true,
      data: {
        command: "build",
        ok: false,
        timestamp: "2026-04-27T00:00:00.000Z",
        durationMs: 2,
        error: {
          message: "Full Linux mod build parity is not implemented yet.",
        },
        hints: ["Use pure-tests instead."],
        data: { unsupported: true },
      },
      meta: { capabilityId: "global.stfc.build", adapterType: "cli" },
    }),
  };
  const result = await stfcExecute(resolved, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /not implemented/);
  assert.deepEqual(result.meta.hints, ["Use pure-tests instead."]);
  assert.deepEqual(result.meta.data, { unsupported: true });
});

test("flags non-STFC-shaped output as a structured error", async () => {
  const ctx = {
    typeAdapter: synthTypeAdapter({
      ok: true,
      data: { not: "an envelope" },
      meta: { capabilityId: "global.stfc.status", adapterType: "cli" },
    }),
  };
  const result = await stfcExecute(resolved, ctx);
  assert.equal(result.ok, false);
  assert.match(
    result.error.message,
    /did not return a recognizable STFC envelope/,
  );
});
