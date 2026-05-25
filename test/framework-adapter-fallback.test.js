import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAdapters,
  FRAMEWORK_ADAPTERS_ROOT,
} from "../src/core/adapter-loader.js";

const FRAMEWORK_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function makeTmpWorkspace({ adapters = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "axf-fb-"));
  if (adapters) {
    await mkdir(path.join(dir, "adapters"), { recursive: true });
  }
  await mkdir(path.join(dir, "manifests", "capabilities"), { recursive: true });
  await mkdir(path.join(dir, "manifests", "toolspaces"), { recursive: true });
  return dir;
}

async function makeTmpWorkspaceWithoutAdapters() {
  return makeTmpWorkspace({ adapters: false });
}

test("framework fallback loads cli + internal type adapters in an empty workspace", async () => {
  const ws = await makeTmpWorkspace();
  const adapters = await loadAdapters({ rootDir: ws });

  const cli = adapters.get("cli");
  const internal = adapters.get("internal");
  assert.ok(cli, "cli type adapter should fall back to framework");
  assert.ok(internal, "internal type adapter should fall back to framework");
  assert.equal(cli.provenance, "framework");
  assert.equal(internal.provenance, "framework");
});

test("framework fallback tolerates a missing local adapters dir", async () => {
  const ws = await makeTmpWorkspaceWithoutAdapters();
  const adapters = await loadAdapters({ rootDir: ws });

  assert.ok(adapters.get("cli"));
  assert.ok(adapters.get("internal"));
  assert.ok(
    adapters.loadIssues.every(
      (issue) => !/adapters root 'adapters' is missing/.test(issue.message),
    ),
    "missing local adapters dir should not be reported when framework fallback is enabled",
  );
});

test("framework fallback does not require a workspace adapters directory", async () => {
  const ws = await makeTmpWorkspace({ adapters: false });
  const adapters = await loadAdapters({ rootDir: ws });

  assert.ok(adapters.get("cli"));
  assert.ok(adapters.get("internal"));
  assert.deepEqual(adapters.loadIssues, []);
});

test("framework fallback does NOT load provider adapters (e.g. majel)", async () => {
  const ws = await makeTmpWorkspace();
  const adapters = await loadAdapters({ rootDir: ws });

  assert.equal(
    adapters.getProvider("majel"),
    undefined,
    "provider adapters must stay explicit and not be injected by fallback",
  );
});

test("workspace-global cli adapter overrides framework fallback", async () => {
  const ws = await makeTmpWorkspace();
  const adapterDir = path.join(ws, "adapters", "cli");
  await mkdir(adapterDir, { recursive: true });
  await writeFile(
    path.join(adapterDir, "adapter.manifest.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        kind: "type-adapter",
        type: "cli",
        entry: "index.js",
        supportedExecutionTargets: ["command"],
        lifecycleState: "active",
        owner: "test",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(adapterDir, "index.js"),
    "export async function execute() { return { ok: true, data: 'workspace-cli' }; }\n",
  );

  const adapters = await loadAdapters({ rootDir: ws });
  const cli = adapters.get("cli");
  assert.equal(
    cli.provenance,
    "workspace",
    "workspace-global adapter must win over framework fallback",
  );
});

test("toolspace-private cli adapter overrides framework fallback for that toolspace", async () => {
  const ws = await makeTmpWorkspace();
  const adapterDir = path.join(ws, "toolspaces", "demo", "adapters", "cli");
  await mkdir(adapterDir, { recursive: true });
  await writeFile(
    path.join(adapterDir, "adapter.manifest.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        kind: "type-adapter",
        type: "cli",
        entry: "index.js",
        supportedExecutionTargets: ["command"],
        lifecycleState: "active",
        owner: "test",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(adapterDir, "index.js"),
    "export async function execute() { return { ok: true, data: 'ts-cli' }; }\n",
  );

  const adapters = await loadAdapters({ rootDir: ws });
  const tsCli = adapters.get("cli", { toolspace: "demo" });
  const globalCli = adapters.get("cli");
  assert.equal(tsCli.provenance, "toolspace:demo");
  assert.equal(
    globalCli.provenance,
    "framework",
    "global cli still resolves via framework fallback",
  );
});

test("framework fallback can be disabled", async () => {
  const ws = await makeTmpWorkspace();
  const adapters = await loadAdapters({
    rootDir: ws,
    enableFrameworkFallback: false,
  });
  assert.equal(adapters.get("cli"), undefined);
  assert.equal(adapters.get("internal"), undefined);
});

test("framework checkout itself does not double-load its own adapters", async () => {
  const adapters = await loadAdapters({ rootDir: FRAMEWORK_ROOT });
  const cli = adapters.get("cli");
  assert.equal(
    cli.provenance,
    "workspace",
    "when the workspace IS the framework, adapters load as workspace, not framework fallback",
  );
});

test("FRAMEWORK_ADAPTERS_ROOT points at the bundled adapters directory", () => {
  assert.equal(
    path.basename(path.normalize(FRAMEWORK_ADAPTERS_ROOT)),
    "adapters",
  );
});
