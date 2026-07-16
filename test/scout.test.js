import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { createRegistry } from "../src/core/registry.js";
import { evaluatePolicies } from "../src/core/policy.js";

async function bootstrap() {
  const root = await mkdtemp(path.join(os.tmpdir(), "axf-scout-"));
  await mkdir(path.join(root, ".ax"), { recursive: true });
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
  await mkdir(path.join(root, "manifests", "families"), { recursive: true });
  await writeFile(
    path.join(root, "axf.workspace.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        name: "demo",
        imports: [
          {
            kind: "ax-inventory",
            family: "demo",
            path: ".ax/fake-ax.js",
            launcher: { command: process.execPath, args: [] },
            executionLauncher: { command: "node", args: [] },
            providerArgStyle: "powershell-pascal",
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, ".ax", "fake-ax.js"),
    `
const inventory = {
  ok: true,
  commands: [
    {
      name: "status",
      description: "Show demo status",
      script: "Get-Status.ps1",
      sideEffects: "read",
      metadata: {
        warnings: ["Provider inventory detected partial log coverage"],
        details: {
          inventorySource: "provider",
          logFile: "demo.log"
        }
      },
      parameters: [
        { name: "Summary", type: "SwitchParameter", switch: true }
      ]
    },
    {
      name: "log-query",
      description: "Query demo logs",
      script: "Search-Log.ps1",
      sideEffects: "read",
      metadata: {
        warnings: ["Large log scans may be slow"],
        details: {
          inventorySource: "provider",
          queryMode: "full"
        }
      },
      parameters: [
        { name: "Profile", type: "String", switch: false },
        { name: "All", type: "SwitchParameter", switch: true },
        { name: "Last", type: "Int32", switch: false }
      ]
    },
    {
      name: "dist:win",
      description: "Build Windows artifacts",
      script: "Dist-Win.ps1",
      sideEffects: "write",
      parameters: []
    }
  ]
};
console.log(JSON.stringify(inventory));
`,
  );
  await writeFile(
    path.join(root, "manifests", "families", "demo.family.json"),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        family: "demo",
        adapterType: "cli",
        commands: {
          "log-query": {
            args: {
              profile: {},
              all: {},
              last: {},
            },
            argsSchema: {
              type: "object",
              properties: {
                profile: {
                  type: "string",
                  enum: ["dirty", "errors"],
                },
              },
              additionalProperties: false,
            },
            policies: ["nonexistent"],
          },
        },
      },
      null,
      2,
    ),
  );
  return root;
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

test("scout --write preserves nested provider metadata in written files and reloads it", async () => {
  const root = await bootstrap();

  await assert.rejects(
    () => main(["--workspace", root, "scout", "--check"]),
    /scout detected manifest drift/,
  );

  await captureStdout(() => main(["--workspace", root, "scout", "--write"]));

  const family = JSON.parse(
    await readFile(
      path.join(root, "manifests", "families", "demo.family.json"),
      "utf8",
    ),
  );
  assert.deepEqual(family.commands.status.warnings, [
    "Provider inventory detected partial log coverage",
  ]);
  assert.deepEqual(family.commands.status.details, {
    inventorySource: "provider",
    logFile: "demo.log",
  });
  assert.deepEqual(family.commands["log-query"].warnings, [
    "Large log scans may be slow",
  ]);
  assert.deepEqual(family.commands["log-query"].details, {
    inventorySource: "provider",
    queryMode: "full",
  });
  assert.deepEqual(
    family.commands["log-query"].argsSchema.properties.profile.enum,
    ["dirty", "errors"],
  );

  const registry = await createRegistry({ rootDir: root });
  const status = registry.getCapability("global.demo.status");
  const logQueryCapability = registry.getCapability("global.demo.log-query");
  assert.deepEqual(status.warnings, [
    "Provider inventory detected partial log coverage",
  ]);
  assert.deepEqual(logQueryCapability.details, {
    inventorySource: "provider",
    queryMode: "full",
  });

  const inspectStatus = JSON.parse(
    await captureStdout(() =>
      main(["--workspace", root, "inspect", "demo", "status", "--json"]),
    ),
  );
  assert.deepEqual(inspectStatus.capability.warnings, [
    "Provider inventory detected partial log coverage",
  ]);
  assert.deepEqual(inspectStatus.capability.details, {
    inventorySource: "provider",
    logFile: "demo.log",
  });

  const inspectLogQuery = JSON.parse(
    await captureStdout(() =>
      main([
        "--workspace",
        root,
        "inspect",
        "global.demo.log-query",
        "--json",
      ]),
    ),
  );
  assert.deepEqual(inspectLogQuery.capability.warnings, [
    "Large log scans may be slow",
  ]);
  assert.deepEqual(inspectLogQuery.capability.details, {
    inventorySource: "provider",
    queryMode: "full",
  });

  const policyResult = evaluatePolicies(logQueryCapability, {
    workspace: { root, viaMarker: true, source: "explicit" },
  });
  assert.equal(policyResult.ok, false);
  assert.match(policyResult.errors[0], /unknown policy 'nonexistent'/);
});

test("scout checks and writes ax inventory imports", async () => {
  const root = await bootstrap();

  await assert.rejects(
    () => main(["--workspace", root, "scout", "--check"]),
    /scout detected manifest drift/,
  );

  await captureStdout(() => main(["--workspace", root, "scout", "--write"]));
  await captureStdout(() => main(["--workspace", root, "scout", "--check"]));

  const family = JSON.parse(
    await readFile(
      path.join(root, "manifests", "families", "demo.family.json"),
      "utf8",
    ),
  );
  assert.ok(family.commands.status);
  assert.ok(family.commands["dist-win"]);
  assert.deepEqual(family.commands["dist-win"].executionTarget.args, [
    "dist:win",
  ]);
  assert.equal(family.commands.status.args.summary.providerFlag, undefined);
  assert.equal(
    family.commands.status.argsSchema.properties.summary.type,
    "boolean",
  );
  assert.deepEqual(family.commands.status.warnings, [
    "Provider inventory detected partial log coverage",
  ]);
  assert.deepEqual(family.commands.status.details, {
    inventorySource: "provider",
    logFile: "demo.log",
  });
  const logQuery = family.commands["log-query"];
  assert.ok(logQuery, "common --all arg should remain in the family manifest");
  assert.deepEqual(logQuery.argsSchema.properties.profile.enum, [
    "dirty",
    "errors",
  ]);
  assert.deepEqual(logQuery.warnings, ["Large log scans may be slow"]);
  assert.deepEqual(logQuery.details, {
    inventorySource: "provider",
    queryMode: "full",
  });

  const registry = await createRegistry({ rootDir: root });
  const status = registry.getCapability("global.demo.status");
  const logQueryCapability = registry.getCapability("global.demo.log-query");
  assert.ok(status);
  assert.ok(logQueryCapability);
  assert.equal(logQueryCapability.origin, "imported");
  assert.equal(logQueryCapability.argMap.all, "-All");
  assert.equal(logQueryCapability.argMap.last, "-Last");
  assert.deepEqual(status.warnings, [
    "Provider inventory detected partial log coverage",
  ]);
  assert.deepEqual(logQueryCapability.details, {
    inventorySource: "provider",
    queryMode: "full",
  });
});

test("scout warns when an old reserved-arg workaround will shadow an import", async () => {
  const root = await bootstrap();
  await writeFile(
    path.join(
      root,
      "manifests",
      "capabilities",
      "global.demo.log-query.json",
    ),
    JSON.stringify(
      {
        manifestVersion: "axf/v0",
        id: "global.demo.log-query",
        summary: "Legacy standalone query",
        provider: "demo",
        adapterType: "cli",
        executionTarget: { command: process.execPath },
        argsSchema: {
          type: "object",
          properties: { all: { type: "boolean" } },
          additionalProperties: false,
        },
        outputModes: ["json"],
        sideEffects: "read",
        scope: "global",
        lifecycleState: "active",
        defaults: {},
        policies: [],
        owner: "module:demo",
        argMap: { all: "-All" },
      },
      null,
      2,
    ),
  );

  const output = await captureStdout(() =>
    main(["--workspace", root, "scout"]),
  );
  assert.match(output, /may be an older reserved-arg workaround/);
  assert.match(output, /will shadow it/);
});

test("scout rejects check and write together", async () => {
  const root = await bootstrap();
  await assert.rejects(
    () => main(["--workspace", root, "scout", "--check", "--write"]),
    /either --check or --write/,
  );
});

test("scout --help prints scout usage", async () => {
  const out = await captureStdout(() => main(["scout", "--help"]));
  assert.match(out, /axf scout/);
  assert.match(out, /--check/);
  assert.match(out, /ax-inventory/);
});
