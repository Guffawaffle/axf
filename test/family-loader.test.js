import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRegistry } from "../src/core/registry.js";
import {
  deriveFlag,
  computeArgMap,
  synthesizeFamilyCapabilities,
  validateFamilyManifest,
  RESERVED_ARG_NAMES,
} from "../src/core/family-loader.js";
import { main } from "../src/cli/main.js";

async function bootstrap() {
  const root = await mkdtemp(path.join(os.tmpdir(), "axf-fam-"));
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
  await mkdir(path.join(root, "manifests", "toolspaces"), { recursive: true });
  await mkdir(path.join(root, "manifests", "families"), { recursive: true });
  await mkdir(path.join(root, "adapters"), { recursive: true });
  await writeFile(path.join(root, "axf.workspace.json"), "{}\n");
  return root;
}

async function writeFamily(root, name, manifest) {
  const filePath = path.join(
    root,
    "manifests",
    "families",
    `${name}.family.json`,
  );
  await writeFile(filePath, JSON.stringify(manifest, null, 2));
  return filePath;
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

const SAMPLE_GIT_FAMILY = {
  manifestVersion: "axf/v0",
  family: "git",
  scope: "global",
  provider: "git",
  adapterType: "cli",
  executionTarget: { command: "git" },
  providerArgStyle: "double-dash-kebab",
  outputModes: ["text"],
  sideEffects: "read",
  lifecycleState: "active",
  owner: "import",
  commands: {
    status: {
      summary: "Show working tree status",
      executionTarget: { command: "git", args: ["status"] },
      args: {
        porcelain: { type: "boolean" },
        branch: { type: "string", providerFlag: "--branch" },
      },
    },
    log: {
      summary: "Show commit log",
      executionTarget: { command: "git", args: ["log"] },
      args: {
        "max-count": { type: "string" },
      },
    },
  },
};

test("family loader synthesizes capabilities for each command", async () => {
  const root = await bootstrap();
  await writeFamily(root, "git", SAMPLE_GIT_FAMILY);
  const registry = await createRegistry({ rootDir: root });
  const status = registry.getCapability("global.git.status");
  const log = registry.getCapability("global.git.log");
  assert.ok(status);
  assert.ok(log);
  assert.equal(status.origin, "imported");
  assert.equal(status.sourceFamily.family, "git");
  assert.equal(status.sourceFamily.command, "status");
});

test("family lifecycle alias 'stable' is treated as active for imported runs", async () => {
  const root = await bootstrap();
  await mkdir(path.join(root, "adapters", "internal"), { recursive: true });
  await writeFile(
    path.join(root, "adapters", "internal", "adapter.manifest.json"),
    JSON.stringify({
      manifestVersion: "axf/v0",
      kind: "type-adapter",
      type: "internal",
      entry: "index.js",
      lifecycleState: "active",
    }),
  );
  await writeFile(
    path.join(root, "adapters", "internal", "index.js"),
    `export async function execute(resolved) {
            return {
                ok: true,
                data: resolved.args?.message ?? null,
                meta: { capabilityId: resolved.capability.id }
            };
        }`,
  );
  await writeFamily(root, "demo", {
    manifestVersion: "axf/v0",
    family: "demo",
    scope: "global",
    provider: "demo",
    adapterType: "internal",
    executionTarget: { handler: "echo.say" },
    lifecycleState: "stable",
    commands: {
      ping: {
        summary: "ping",
        args: {
          message: { type: "string" },
        },
      },
    },
  });

  const out = await captureStdout(() =>
    main([
      "--workspace",
      root,
      "run",
      "demo",
      "ping",
      "--message",
      "hi",
      "--json",
    ]),
  );
  const result = JSON.parse(out);
  assert.equal(result.ok, true);
  assert.equal(result.data, "hi");
});

test("family loader builds argMap with style + per-arg overrides", () => {
  const map = computeArgMap(
    SAMPLE_GIT_FAMILY.commands.status.args,
    SAMPLE_GIT_FAMILY,
  );
  assert.equal(map.porcelain, "--porcelain");
  assert.equal(map.branch, "--branch");
});

test("powershell-pascal style derives -PascalCase flags", () => {
  assert.equal(
    deriveFlag("force-recreate", "powershell-pascal"),
    "-ForceRecreate",
  );
  assert.equal(deriveFlag("name", "powershell-pascal"), "-Name");
  assert.equal(deriveFlag("max-count", "double-dash-kebab"), "--max-count");
});

test("family rejects reserved arg names", () => {
  const issues = validateFamilyManifest(
    {
      manifestVersion: "axf/v0",
      family: "bad",
      adapterType: "cli",
      commands: {
        run: { args: { json: { type: "boolean" } } },
      },
    },
    "bad.family.json",
  );
  assert.ok(
    issues.some((i) => /reserved/.test(i.message)),
    "must flag reserved arg name",
  );
  assert.ok(RESERVED_ARG_NAMES.has("json"));
});

test("materialized capability overrides imported family entry", async () => {
  const root = await bootstrap();
  await writeFamily(root, "git", SAMPLE_GIT_FAMILY);
  // Materialize global.git.status by hand.
  await writeFile(
    path.join(root, "manifests", "capabilities", "global.git.status.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        id: "global.git.status",
        summary: "Custom status",
        provider: "git",
        adapterType: "cli",
        executionTarget: { command: "git", args: ["status", "--short"] },
        argsSchema: { type: "object", properties: {} },
        outputModes: ["text"],
        sideEffects: "read",
        scope: "global",
        lifecycleState: "active",
        defaults: {},
        policies: [],
        owner: "user",
        argMap: {},
        sourceFamily: {
          family: "git",
          command: "status",
          manifestPath: "manifests/families/git.family.json",
        },
      },
      null,
      2,
    ),
  );
  const registry = await createRegistry({ rootDir: root });
  const status = registry.getCapability("global.git.status");
  assert.equal(
    status.summary,
    "Custom status",
    "materialized file must shadow the family entry",
  );
  assert.equal(status.origin, "materialized");
});

test("synthesizeFamilyCapabilities skips materialized ids", () => {
  const synthesized = synthesizeFamilyCapabilities(SAMPLE_GIT_FAMILY, {
    existingIds: new Set(["global.git.status"]),
  });
  const ids = synthesized.map((c) => c.id);
  assert.deepEqual(ids, ["global.git.log"]);
});

test("init family scaffolds a draft family manifest", async () => {
  const root = await bootstrap();
  await main(["--workspace", root, "init", "family", "myfam"]);
  const file = path.join(root, "manifests", "families", "myfam.family.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  assert.equal(manifest.family, "myfam");
  assert.equal(manifest.lifecycleState, "draft");
  assert.ok(manifest.commands.status);
});

test("init materialize writes a real capability file from a family entry", async () => {
  const root = await bootstrap();
  await writeFamily(root, "git", SAMPLE_GIT_FAMILY);
  await main(["--workspace", root, "init", "materialize", "git", "status"]);
  const file = path.join(
    root,
    "manifests",
    "capabilities",
    "global.git.status.json",
  );
  const manifest = JSON.parse(await readFile(file, "utf8"));
  assert.equal(manifest.id, "global.git.status");
  assert.equal(manifest.lifecycleState, "draft");
  assert.deepEqual(manifest.sourceFamily, {
    family: "git",
    command: "status",
    manifestPath: "manifests/families/git.family.json",
  });
  assert.equal(manifest.argMap.branch, "--branch");
});

test("framework repo ships the standard Lex family pack", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const registry = await createRegistry({ rootDir: root });

  const expected = {
    "global.lex.status": "read",
    "global.lex.introspect": "read",
    "global.lex.recall": "read",
    "global.lex.search": "read",
    "global.lex.policy-check": "read",
    "global.lex.remember": "write",
    "global.lex.log-frame": "write",
    "global.lex.note": "write",
  };

  for (const [id, sideEffects] of Object.entries(expected)) {
    const capability = registry.getCapability(id);
    assert.ok(capability, `${id} should be present`);
    assert.equal(capability.sideEffects, sideEffects);
  }

  const search = registry.getCapability("global.lex.search");
  assert.deepEqual(search.argsSchema.required, ["query"]);
});

test("external workspace can use framework Lex globals without copied manifests", async () => {
  const root = await bootstrap();
  await writeFile(
    path.join(root, "manifests", "capabilities", "workspace.repo.echo.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        id: "workspace.repo.echo",
        summary: "workspace echo",
        provider: "repo",
        adapterType: "internal",
        executionTarget: { handler: "echo.say" },
        argsSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
        outputModes: ["json"],
        sideEffects: "none",
        scope: "workspace-local",
        lifecycleState: "active",
        defaults: {},
        policies: [],
        owner: "test",
      },
      null,
      2,
    ),
  );

  const listed = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "list", "--all", "--json"]),
    ),
  );
  const byId = new Map(listed.capabilities.map((cap) => [cap.id, cap]));
  assert.ok(byId.has("workspace.repo.echo"));
  assert.equal(byId.get("global.lex.recall")?.sideEffects, "read");
  assert.equal(byId.get("global.lex.remember")?.sideEffects, "write");

  const recall = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "inspect", "global.lex.recall", "--json"]),
    ),
  );
  assert.equal(recall.capability.id, "global.lex.recall");
  assert.equal(recall.capability.sideEffects, "read");
  assert.equal(recall.adapter.provenance, "framework");
  assert.equal(recall.launchPlan.cwd, root);
  assert.equal(recall.launchPlan.cwdSource, "workspace");

  const remember = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "inspect", "global.lex.remember", "--json"]),
    ),
  );
  assert.equal(remember.capability.id, "global.lex.remember");
  assert.equal(remember.capability.sideEffects, "write");
  assert.equal(remember.launchPlan.cwd, root);
  assert.equal(remember.launchPlan.cwdSource, "workspace");

  const workspaceRun = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "run",
        "repo",
        "echo",
        "--message",
        "hi",
        "--json",
      ]),
    ),
  );
  assert.equal(workspaceRun.ok, true);
  assert.equal(workspaceRun.data, "hi");
  assert.equal(workspaceRun.meta.capabilityId, "workspace.repo.echo");

  const doctor = JSON.parse(
    await captureStdout(() => main(["--workspace", root, "doctor", "--json"])),
  );
  assert.equal(doctor.familyCount, 1);
  assert.ok(
    doctor.adaptersByType.some(
      (adapter) => adapter.type === "cli" && adapter.provenance === "framework",
    ),
  );

  const scout = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "scout", "--check", "--json"]),
    ),
  );
  assert.equal(scout.ok, true);
  assert.equal(scout.changeCount, 0);
});
