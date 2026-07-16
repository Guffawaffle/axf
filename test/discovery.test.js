import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import {
  buildCapabilityExamples,
  buildWorkflowGuide,
  explainCapability,
  selectCapabilities,
} from "../src/core/discovery.js";
import { createRegistry } from "../src/core/registry.js";
import { summarizeWorkspaceBinding } from "../src/core/runtime-diagnostics.js";
import { performOperation } from "../src/mcp/operations.js";

async function createWorkspace({ recommendations = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "axf-discovery-"));
  const marker = {
    manifestVersion: "axf/v0",
    name: "discovery-fixture",
  };
  if (recommendations) marker.recommendations = recommendations;
  await writeFile(
    path.join(root, "axf.workspace.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  await mkdir(path.join(root, "manifests", "capabilities"), {
    recursive: true,
  });
  await mkdir(path.join(root, "manifests", "families"), {
    recursive: true,
  });
  await mkdir(path.join(root, "manifests", "toolspaces"), {
    recursive: true,
  });
  return root;
}

function capability(id, overrides = {}) {
  return {
    manifestVersion: "axf/v0",
    id,
    summary: `Summary for ${id}`,
    provider: "demo",
    adapterType: "cli",
    executionTarget: { command: "demo" },
    argsSchema: { type: "object", properties: {} },
    outputModes: ["json"],
    sideEffects: "read",
    scope: id.startsWith("workspace.") ? "workspace-local" : "global",
    lifecycleState: "active",
    defaults: {},
    policies: [],
    owner: "fixture",
    ...overrides,
  };
}

async function writeCapability(root, manifest) {
  await writeFile(
    path.join(root, "manifests", "capabilities", `${manifest.id}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function writeFamily(root, name, manifest) {
  await writeFile(
    path.join(root, "manifests", "families", `${name}.family.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
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

test("registry scans AXF-owned manifest directories and ignores domain JSON", async () => {
  const root = await createWorkspace();
  try {
    await writeCapability(root, capability("global.demo.context"));
    await writeFile(
      path.join(root, "manifests", "gameplay_seam_unmanaged_baseline.json"),
      JSON.stringify({ gameplay: true }),
    );
    await writeFile(
      path.join(root, "manifests", "hook_support_tiers.json"),
      JSON.stringify({ hooks: ["startup"] }),
    );

    const registry = await createRegistry({ rootDir: root });
    assert.ok(registry.getCapability("global.demo.context"));
    assert.equal(registry.rejected.length, 0);
    assert.equal(
      registry.loadIssues.some((issue) =>
        /gameplay_seam|hook_support/.test(issue.message),
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compact discovery exposes provenance and applies search, effects, and bounds", async () => {
  const root = await createWorkspace();
  try {
    await writeCapability(
      root,
      capability("global.demo.context", {
        summary: "Read bounded project context",
        sideEffects: "read",
      }),
    );
    await writeCapability(
      root,
      capability("global.demo.deploy", {
        summary: "Deploy demo",
        sideEffects: "write",
      }),
    );
    const registry = await createRegistry({ rootDir: root });
    const selected = selectCapabilities(registry, {
      compact: true,
      search: "bounded context",
      sideEffects: "read",
      limit: 1,
    });

    assert.equal(selected.count, 1);
    assert.equal(selected.total, 1);
    assert.equal(selected.truncated, false);
    assert.deepEqual(selected.capabilities[0], {
      id: "global.demo.context",
      summary: "Read bounded project context",
      scope: "global",
      lifecycleState: "active",
      sideEffects: "read",
      sourceKind: "project-manifest",
      provenance: {
        kind: "project-manifest",
        layer: "project",
        manifestPath:
          "manifests/capabilities/global.demo.context.json",
        owner: "fixture",
        provider: "demo",
        family: null,
        mount: null,
        sourceCapabilityId: null,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explain distinguishes filtered, prefix, family, and missing states", async () => {
  const root = await createWorkspace();
  try {
    await writeCapability(
      root,
      capability("global.demo.context", { lifecycleState: "draft" }),
    );
    await writeFamily(root, "shared", {
      manifestVersion: "axf/v0",
      family: "shared",
      scope: "global",
      provider: "shared",
      adapterType: "cli",
      lifecycleState: "active",
      commands: {
        status: {
          summary: "Shared status",
          executionTarget: { command: "shared", args: ["status"] },
          args: {},
          sideEffects: "read",
        },
      },
    });
    const registry = await createRegistry({ rootDir: root });

    const filtered = explainCapability(registry, ["global.demo.context"]);
    assert.equal(filtered.status, "filtered");
    assert.equal(filtered.reasons[0].code, "lifecycle_filtered");

    const prefix = explainCapability(registry, ["global.demo"]);
    assert.equal(prefix.status, "prefix");
    assert.equal(prefix.suggestions[0].id, "global.demo.context");

    const family = explainCapability(registry, "global.shared.missing");
    assert.equal(family.status, "family-loaded-command-missing");
    assert.equal(family.suggestions[0].id, "global.shared.status");

    const workspaceSummary = summarizeWorkspaceBinding(
      registry,
      { root, source: "explicit", viaMarker: true },
      { executionWorkspace: { root, source: "explicit", viaMarker: true } },
    );
    const missing = explainCapability(registry, "global.absent.thing", {
      workspaceSummary,
    });
    assert.equal(missing.status, "missing");
    assert.equal(missing.reasons[0].code, "not_loaded");
    assert.ok(missing.reasons.some((reason) => reason.code === "workspace_context"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explain reports workspace-binding and policy conditions", async () => {
  const root = await createWorkspace();
  const executionRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-unmarked-execution-"),
  );
  try {
    await writeCapability(
      root,
      capability("workspace.demo.check", {
        scope: "workspace-local",
        policies: ["require_workspace_binding", "forbid_network"],
      }),
    );
    const registry = await createRegistry({ rootDir: root });
    const workspaceSummary = summarizeWorkspaceBinding(
      registry,
      { root, source: "explicit", viaMarker: true },
      {
        executionWorkspace: {
          root: executionRoot,
          source: "explicit",
          viaMarker: false,
        },
      },
    );
    const explanation = explainCapability(
      registry,
      "workspace.demo.check",
      { workspaceSummary },
    );

    assert.equal(explanation.status, "filtered");
    assert.ok(
      explanation.reasons.some(
        (reason) => reason.code === "workspace_binding_required",
      ),
    );
    assert.deepEqual(
      explanation.reasons.find(
        (reason) => reason.code === "policy_requirements",
      ).policies,
      ["require_workspace_binding", "forbid_network"],
    );
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(executionRoot, { recursive: true, force: true }),
    ]);
  }
});

test("guide combines workspace and family recommendations into a bounded result", async () => {
  const root = await createWorkspace({
    recommendations: {
      "session-start": [
        { label: "context", capability: "global.demo.context" },
      ],
      handoff: "global.demo.missing-handoff",
    },
  });
  try {
    await writeCapability(root, capability("global.demo.context"));
    await writeFamily(root, "shared", {
      manifestVersion: "axf/v0",
      family: "shared",
      scope: "global",
      provider: "shared",
      adapterType: "cli",
      lifecycleState: "active",
      commands: {
        check: {
          summary: "Validate the workspace",
          executionTarget: { command: "shared", args: ["check"] },
          args: {},
          sideEffects: "read",
          recommendedFor: ["validation"],
        },
      },
    });
    const registry = await createRegistry({ rootDir: root });
    const guide = await buildWorkflowGuide(registry, {
      projectRoot: root,
      limit: 3,
    });

    assert.deepEqual(
      guide.recommendations.map((item) => [
        item.label,
        item.capabilityId,
        item.status,
      ]),
      [
        ["context", "global.demo.context", "available"],
        ["check", "global.shared.check", "available"],
        ["handoff", "global.demo.missing-handoff", "missing"],
      ],
    );
    assert.equal(guide.recommendations[1].provenance.kind, "imported-family");
    assert.ok(guide.warnings.some((warning) => /missing-handoff/.test(warning)));

    const contextOnly = await buildWorkflowGuide(registry, {
      projectRoot: root,
      intent: "context",
    });
    assert.equal(contextOnly.count, 1);
    assert.equal(contextOnly.recommendations[0].intent, "session-start");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspect examples map public arguments through provider flags", () => {
  const examples = buildCapabilityExamples(
    capability("global.demo.check", {
      argsSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", example: "/repo" },
          strict: { type: "boolean" },
        },
        required: ["projectRoot"],
      },
      argMap: {
        projectRoot: "--project-root",
        strict: "--strict-mode",
      },
      examples: ["axf run global.demo.check --project-root /repo"],
    }),
  );

  assert.equal(
    examples.run.cli,
    "axf run global.demo.check -- --project-root /repo",
  );
  assert.deepEqual(examples.run.mcp.args, { projectRoot: "/repo" });
  assert.deepEqual(examples.argumentMapping[0], {
    publicName: "projectRoot",
    publicFlag: "--project-root",
    providerFlag: "--project-root",
    required: true,
    type: "string",
    exampleValue: "/repo",
  });
  assert.deepEqual(examples.declared, [
    "axf run global.demo.check --project-root /repo",
  ]);
});

test("CLI and MCP expose the same compact list, guide, explain, and inspect examples", async () => {
  const root = await createWorkspace({
    recommendations: {
      context: "global.demo.context",
    },
  });
  try {
    await writeCapability(
      root,
      capability("global.demo.context", {
        argsSchema: {
          type: "object",
          properties: { topic: { type: "string", example: "release" } },
          required: ["topic"],
        },
      }),
    );

    const cliList = JSON.parse(
      await captureStdout(() =>
        main([
          "--project-root",
          root,
          "list",
          "--compact",
          "--search",
          "context",
          "--json",
        ]),
      ),
    );
    const mcpList = await performOperation({
      operation: "list",
      projectRoot: root,
      compact: true,
      search: "context",
    });
    assert.deepEqual(cliList.capabilities, mcpList.capabilities);

    const cliGuide = JSON.parse(
      await captureStdout(() =>
        main(["--project-root", root, "guide", "context", "--json"]),
      ),
    );
    const mcpGuide = await performOperation({
      operation: "guide",
      projectRoot: root,
      intent: "context",
    });
    assert.deepEqual(cliGuide.recommendations, mcpGuide.recommendations);

    const cliExplain = JSON.parse(
      await captureStdout(() =>
        main([
          "--project-root",
          root,
          "explain",
          "global.demo",
          "--json",
        ]),
      ),
    );
    const mcpExplain = await performOperation({
      operation: "explain",
      projectRoot: root,
      query: "global.demo",
    });
    assert.equal(cliExplain.status, mcpExplain.status);
    assert.deepEqual(cliExplain.suggestions, mcpExplain.suggestions);

    const mcpInspect = await performOperation({
      operation: "inspect",
      projectRoot: root,
      target: { id: "global.demo.context" },
    });
    assert.equal(mcpInspect.examples.inspect.cli, "axf inspect global.demo.context");
    assert.equal(mcpInspect.examples.run.mcp.args.topic, "release");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI and MCP share machine-pack discovery while execution uses a separate client root", async () => {
  const projectRoot = await createWorkspace();
  const machineRoot = await createWorkspace();
  const executionRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-client-execution-"),
  );
  try {
    await writeFamily(machineRoot, "shared", {
      manifestVersion: "axf/v0",
      family: "shared",
      scope: "global",
      provider: "shared",
      adapterType: "cli",
      lifecycleState: "active",
      commands: {
        status: {
          summary: "Shared machine status",
          executionTarget: { command: "shared", args: ["status"] },
          args: {},
          sideEffects: "read",
        },
      },
    });
    const env = { ...process.env, AXF_MACHINE_ROOT: machineRoot };
    const cli = JSON.parse(
      await captureStdout(() =>
        main(
          [
            "--project-root",
            projectRoot,
            "--execution-root",
            executionRoot,
            "list",
            "--compact",
            "--json",
          ],
          { cwd: executionRoot, env },
        ),
      ),
    );
    const mcp = await performOperation(
      {
        operation: "list",
        projectRoot,
        executionRoot,
        compact: true,
      },
      { cwd: executionRoot, env },
    );

    assert.deepEqual(cli.capabilities, mcp.capabilities);
    const shared = cli.capabilities.find(
      (item) => item.id === "global.shared.status",
    );
    assert.ok(shared);
    assert.equal(shared.sourceKind, "imported-family");
    assert.equal(shared.provenance.layer, "machine");
    assert.equal(cli.projectRoot.root, projectRoot);
    assert.equal(cli.executionRoot.root, executionRoot);
    assert.equal(mcp.projectRoot.root, projectRoot);
    assert.equal(mcp.executionRoot.root, executionRoot);
    assert.ok(
      cli.notes.some((note) =>
        /no local axf manifests; \d+ active framework\/machine capabilities remain available/.test(
          note,
        ),
      ),
      cli.notes.join("\n"),
    );
  } finally {
    await Promise.all([
      rm(projectRoot, { recursive: true, force: true }),
      rm(machineRoot, { recursive: true, force: true }),
      rm(executionRoot, { recursive: true, force: true }),
    ]);
  }
});
