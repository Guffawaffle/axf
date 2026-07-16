// Coverage gaps from round 1 review: end-to-end CLI flag behavior,
// inspect on workspace-local capabilities, promote JSON output,
// resolveInspectable ambiguity (global vs workspace-local), mounted
// capability promote refusal.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { createRegistry } from "../src/core/registry.js";
import { resolveCapability } from "../src/core/resolver.js";

async function bootstrap({ withInternal = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-flag-"));
  await writeFile(
    path.join(root, "axf.workspace.json"),
    JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" }),
  );
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
  if (withInternal) {
    const adapterDir = path.join(root, "adapters", "internal");
    await mkdir(adapterDir, { recursive: true });
    await writeFile(
      path.join(adapterDir, "adapter.manifest.json"),
      JSON.stringify({
        manifestVersion: "axf/v0",
        kind: "type-adapter",
        type: "internal",
        entry: "index.js",
        lifecycleState: "active",
      }),
    );
    await writeFile(
      path.join(adapterDir, "index.js"),
      `export async function execute(resolved) {
                return {
                    ok: true,
                    data: Object.prototype.hasOwnProperty.call(resolved.args ?? {}, "message")
                        ? resolved.args.message
                        : resolved.args,
                    meta: { capabilityId: resolved.capability.id, adapterType: "internal" }
                };
            }`,
    );
  }
  return root;
}

function basicCap(overrides = {}) {
  return {
    manifestVersion: "axf/v0",
    id: "global.demo.thing",
    summary: "demo",
    provider: "demo",
    adapterType: "internal",
    executionTarget: { handler: "echo.say" },
    argsSchema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
    outputModes: ["json"],
    sideEffects: "none",
    scope: "global",
    lifecycleState: "draft",
    defaults: {},
    policies: [],
    owner: "test",
    ...overrides,
  };
}

async function writeCap(root, cap) {
  const file = path.join(root, "manifests", "capabilities", `${cap.id}.json`);
  await writeFile(file, JSON.stringify(cap, null, 2) + "\n");
  return file;
}

// Capture stdout from main() for JSON-output tests.
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

test("run --any-lifecycle executes a draft capability", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "draft" }));
  // Without the flag this should throw.
  await assert.rejects(
    () =>
      main(["--workspace", root, "run", "demo", "thing", "--message", "hi"]),
    /draft/,
  );
  // With the flag it runs.
  const out = await captureStdout(() =>
    main([
      "--workspace",
      root,
      "run",
      "demo",
      "thing",
      "--message",
      "hi",
      "--any-lifecycle",
      "--json",
    ]),
  );
  const result = JSON.parse(out);
  assert.equal(result.ok, true);
  assert.equal(result.data, "hi");
});

test("run --allow-draft (deprecated) still works as alias", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "draft" }));
  const out = await captureStdout(() =>
    main([
      "--workspace",
      root,
      "run",
      "demo",
      "thing",
      "--message",
      "hi",
      "--allow-draft",
      "--json",
    ]),
  );
  const result = JSON.parse(out);
  assert.equal(result.ok, true);
});

test("run boundary keeps declared json and limit capability-owned", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      lifecycleState: "active",
      argsSchema: {
        type: "object",
        properties: {
          json: { type: "boolean" },
          limit: { type: "integer" },
        },
        additionalProperties: false,
      },
    }),
  );

  const output = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "run",
        "demo",
        "thing",
        "--axf-json",
        "--",
        "--json",
        "--limit",
        "12",
      ]),
    ),
  );

  assert.deepEqual(output.data, { json: true, limit: 12 });
  assert.deepEqual(output.meta, {
    capabilityId: "global.demo.thing",
    adapterType: "internal",
  });
});

test("declared legacy run names stay downstream without a boundary", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      lifecycleState: "active",
      argsSchema: {
        type: "object",
        properties: { json: { type: "boolean" } },
        additionalProperties: false,
      },
    }),
  );

  const plain = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "run", "demo", "thing", "--json"]),
    ),
  );
  assert.deepEqual(plain, { json: true });
  assert.equal(plain.ok, undefined);

  const envelope = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "run",
        "demo",
        "thing",
        "--json",
        "--axf-json",
      ]),
    ),
  );
  assert.deepEqual(envelope.data, { json: true });
});

test("boundary lets legacy lifecycle spelling control AXF and reach the capability", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      lifecycleState: "draft",
      argsSchema: {
        type: "object",
        properties: { "any-lifecycle": { type: "boolean" } },
        additionalProperties: false,
      },
    }),
  );

  const output = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "run",
        "demo",
        "thing",
        "--any-lifecycle",
        "--json",
        "--",
        "--any-lifecycle",
      ]),
    ),
  );
  assert.deepEqual(output.data, { "any-lifecycle": true });
});

test("boundary requires capability options to appear after it", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "active" }));

  await assert.rejects(
    () =>
      main([
        "--workspace",
        root,
        "run",
        "demo",
        "thing",
        "--message",
        "hi",
        "--",
      ]),
    /must appear after the '--' boundary/,
  );
});

test("root-like names after the command belong to the capability", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      lifecycleState: "active",
      argsSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          "project-root": { type: "string" },
          "execution-root": { type: "string" },
        },
        additionalProperties: false,
      },
    }),
  );

  const output = JSON.parse(
    await captureStdout(() =>
      main([
        "run",
        "demo",
        "thing",
        "--axf-workspace",
        root,
        "--axf-json",
        "--",
        "--workspace",
        "child-workspace",
        "--project-root",
        "child-project",
        "--execution-root",
        "child-execution",
      ]),
    ),
  );

  assert.deepEqual(output.data, {
    workspace: "child-workspace",
    "project-root": "child-project",
    "execution-root": "child-execution",
  });
  assert.equal(output.workspaces.projectRoot.root, root);
  assert.equal(output.workspaces.executionRoot.root, root);

  const positionalOwnership = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "run",
        "demo",
        "thing",
        "--workspace",
        "after-command",
        "--axf-json",
      ]),
    ),
  );
  assert.deepEqual(positionalOwnership.data, { workspace: "after-command" });
  assert.equal(positionalOwnership.workspaces.projectRoot.root, root);
});

test("help documents canonical project and execution root flags", async () => {
  const out = await captureStdout(() => main(["help"]));
  assert.match(out, /--project-root <path>/);
  assert.match(out, /--execution-root <path>/);
  assert.match(out, /--axf-project-root <path>/);
  assert.match(out, /--axf-json/);
  assert.match(out, /schema-validated/);
  assert.match(
    out,
    /--registry-workspace <path>\s+Legacy alias for --project-root/,
  );
  assert.match(
    out,
    /--execution-workspace <path>\s+Legacy alias for --execution-root/,
  );
});

test("list --any-lifecycle includes drafts", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "draft" }));

  const without = await captureStdout(() =>
    main(["--workspace", root, "list"]),
  );
  assert.ok(
    !without.includes("global.demo.thing"),
    "draft should be hidden by default",
  );

  const withFlag = await captureStdout(() =>
    main(["--workspace", root, "list", "--any-lifecycle"]),
  );
  assert.ok(
    withFlag.includes("global.demo.thing"),
    "draft should appear with --any-lifecycle",
  );
});

test("non-run commands retain trailing legacy root flags", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "active" }));

  const output = JSON.parse(
    await captureStdout(() => main(["list", "--project-root", root, "--json"])),
  );
  assert.equal(output.projectRoot.root, root);
  assert.ok(
    output.capabilities.some(
      (capability) => capability.id === "global.demo.thing",
    ),
  );
});

test("inspect resolves a workspace-local capability via shorthand", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      id: "workspace.repo.status",
      scope: "workspace-local",
      lifecycleState: "active",
    }),
  );
  const out = await captureStdout(() =>
    main(["--workspace", root, "inspect", "repo", "status", "--json"]),
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.capability.id, "workspace.repo.status");
});

test("project-root and execution-root aliases drive split root behavior", async () => {
  const registryRoot = await bootstrap();
  const executionRoot = await mkdtemp(
    path.join(os.tmpdir(), "ax-cli-execution-"),
  );
  await mkdir(path.join(registryRoot, "tools"), { recursive: true });
  await writeFile(
    path.join(registryRoot, "tools", "cwd.mjs"),
    `console.log(JSON.stringify({ cwd: process.cwd() }));\n`,
  );
  await writeCap(
    registryRoot,
    basicCap({
      id: "global.demo.cwd",
      adapterType: "cli",
      lifecycleState: "active",
      executionTarget: {
        launcher: { command: process.execPath },
        target: {
          path: "tools/cwd.mjs",
          relativeTo: "workspace",
        },
      },
    }),
  );

  const out = await captureStdout(() =>
    main([
      "--project-root",
      registryRoot,
      "--execution-root",
      executionRoot,
      "inspect",
      "demo",
      "cwd",
      "--json",
    ]),
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.projectRoot.root, registryRoot);
  assert.equal(parsed.executionRoot.root, executionRoot);
  assert.equal(parsed.workspaces.projectRoot.root, registryRoot);
  assert.equal(parsed.workspaces.executionRoot.root, executionRoot);
  assert.equal(parsed.launchPlan.cwd, executionRoot);
  assert.equal(
    parsed.launchPlan.targetPath,
    path.join(registryRoot, "tools", "cwd.mjs"),
  );
});

test("promote --json emits a structured response", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "draft" }));
  const out = await captureStdout(() =>
    main([
      "--workspace",
      root,
      "promote",
      "global.demo.thing",
      "--to",
      "active",
      "--json",
    ]),
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lifecycleState, "active");
  assert.equal(parsed.previousLifecycleState, "draft");
  assert.equal(parsed.id, "global.demo.thing");
  assert.match(parsed.manifestPath, /global\.demo\.thing\.json$/);
});

test("promote --json no-op response includes unchanged:true", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "active" }));
  const out = await captureStdout(() =>
    main([
      "--workspace",
      root,
      "promote",
      "global.demo.thing",
      "--to",
      "active",
      "--json",
    ]),
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.unchanged, true);
});

test("promote refuses mounted capability ids", async () => {
  const root = await bootstrap();
  await writeCap(root, basicCap({ lifecycleState: "active" }));
  await mkdir(path.join(root, "manifests", "toolspaces"), { recursive: true });
  await writeFile(
    path.join(root, "manifests", "toolspaces", "tly.mount.json"),
    JSON.stringify({
      manifestVersion: "axf/v0",
      toolspace: "tly",
      lifecycleState: "active",
      moduleMounts: {
        demo: { source: "global.demo", capabilities: ["thing"] },
      },
    }),
  );
  await assert.rejects(
    () =>
      main([
        "--workspace",
        root,
        "promote",
        "toolspace.tly.demo.thing",
        "--to",
        "draft",
      ]),
    /unknown capability 'toolspace\.tly\.demo\.thing'/,
  );
});

test("doctor --json includes workspace block with viaMarker flag", async () => {
  const root = await bootstrap();
  const out = await captureStdout(() =>
    main(["--workspace", root, "doctor", "--json"]),
  );
  const parsed = JSON.parse(out);
  assert.ok(parsed.projectRoot, "doctor JSON should include projectRoot block");
  assert.equal(parsed.projectRoot.root, root);
  assert.ok(parsed.workspace, "doctor JSON should include workspace block");
  assert.equal(parsed.workspace.root, root);
  assert.equal(parsed.workspace.viaMarker, true);
  assert.equal(parsed.workspace.source, "explicit");
});

test("list reports project-root notes when an explicit root is empty and unmarked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-empty-"));

  const out = await captureStdout(() => main(["--workspace", root, "list"]));

  assert.match(
    out,
    /explicit project root '.*' does not contain axf\.workspace\.json/,
  );
  assert.match(out, /has no local axf manifests yet/);
  assert.match(out, /has zero capabilities/);
  assert.match(out, /no capabilities found/);
});

test("doctor --json surfaces WSL path contamination diagnostics", async () => {
  const root = await bootstrap();
  const originalExists = globalThis.__AXF_TEST_FILE_EXISTS;
  globalThis.__AXF_TEST_FILE_EXISTS = (candidate) =>
    candidate.startsWith("/mnt/c/");
  try {
    const out = await captureStdout(() =>
      main(["--workspace", root, "doctor", "--json"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: "/mnt/c/Users/dev/AppData/Roaming/npm:/mnt/c/Program Files/nodejs:/usr/bin",
          WSL_INTEROP: "/run/WSL/1",
        },
      }),
    );
    const parsed = JSON.parse(out);

    assert.equal(parsed.runtime.wsl, true);
    assert.equal(
      parsed.runtime.commands.axf.resolvedCommand,
      "/mnt/c/Users/dev/AppData/Roaming/npm/axf",
    );
    assert.ok(
      parsed.issues.some((issue) =>
        /WSL PATH includes Windows npm shim directory/.test(issue.message),
      ),
      "doctor should warn about Windows npm shims on WSL",
    );
    assert.ok(
      parsed.issues.some((issue) =>
        /WSL PATH appears contaminated by Windows shims/.test(issue.message),
      ),
      "doctor should warn about cross-OS PATH contamination",
    );
  } finally {
    globalThis.__AXF_TEST_FILE_EXISTS = originalExists;
  }
});

test("global wins over workspace-local when both define the same shorthand", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      id: "global.dup.thing",
      scope: "global",
      lifecycleState: "active",
    }),
  );
  await writeCap(
    root,
    basicCap({
      id: "workspace.dup.thing",
      scope: "workspace-local",
      lifecycleState: "active",
    }),
  );
  const registry = await createRegistry({ rootDir: root });
  const resolved = resolveCapability(registry, ["dup", "thing"], {
    args: { message: "x" },
  });
  assert.equal(resolved.capability.id, "global.dup.thing");
});

test("mounted capability inherits source policies plus mount policies", async () => {
  const root = await bootstrap();
  await writeCap(
    root,
    basicCap({
      id: "global.demo.thing",
      lifecycleState: "active",
      policies: ["require_workspace_binding"],
    }),
  );
  await mkdir(path.join(root, "manifests", "toolspaces"), { recursive: true });
  await writeFile(
    path.join(root, "manifests", "toolspaces", "tly.mount.json"),
    JSON.stringify({
      manifestVersion: "axf/v0",
      toolspace: "tly",
      lifecycleState: "active",
      moduleMounts: {
        demo: {
          source: "global.demo",
          capabilities: ["thing"],
          policies: ["require_workspace_binding"],
        },
      },
    }),
  );
  const registry = await createRegistry({ rootDir: root });
  const mounted = registry
    .listMountedCapabilities()
    .find((c) => c.id === "toolspace.tly.demo.thing");
  assert.ok(mounted);
  // Source policy + mount policy both present (will be deduped at evaluation time).
  assert.equal(
    mounted.policies.filter((p) => p === "require_workspace_binding").length,
    2,
  );
});
