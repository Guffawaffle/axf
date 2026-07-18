import test from "node:test";
import assert from "node:assert/strict";
import { performOperation } from "../src/mcp/operations.js";
import { projectMcpResponse } from "../src/mcp/response.js";

const repoRoot = new URL("..", import.meta.url).pathname;

const root = {
  root: repoRoot,
  source: "explicit",
  viaMarker: true,
  markerPresent: true,
};

const workspaceMetadata = {
  projectRoot: root,
  executionRoot: root,
  workspace: root,
  executionWorkspace: root,
  workspaces: {
    projectRoot: root,
    executionRoot: root,
    registryWorkspace: root,
    executionWorkspace: root,
  },
  notes: [],
};

const operationPayloads = [
  {
    ok: true,
    operation: "help",
    tool: { name: "axf", description: "router" },
    contract: {
      summary: "single router",
      discoveryFlow: ["guide", "inspect", "run"],
      runRules: ["inspect first"],
      boundary: { diagnostic: true },
    },
    operations: [{ name: "run", purpose: "execute", readOnly: false }],
  },
  {
    ok: true,
    operation: "list",
    capabilities: [
      {
        id: "global.echo.say",
        summary: "echo",
        scope: "global",
        lifecycleState: "active",
        sideEffects: "none",
        provider: "echo",
        manifestPath: "/private/full/manifest.json",
      },
    ],
    total: 1,
    count: 1,
    truncated: false,
    filters: { compact: false },
  },
  {
    ok: true,
    operation: "guide",
    intent: "validation",
    recommendations: [
      {
        intent: "validation",
        label: "check",
        capabilityId: "global.repo.check",
        status: "available",
        lifecycleState: "active",
        sideEffects: "read",
        summary: "check repo",
        provenance: { manifestPath: "/private/manifest.json" },
        inspect: { cli: "axf inspect global.repo.check" },
      },
    ],
    count: 1,
    truncated: false,
    limit: 12,
    warnings: [],
  },
  {
    ok: true,
    operation: "explain",
    query: "global.echo.say",
    status: "available",
    capability: {
      id: "global.echo.say",
      summary: "echo",
      scope: "global",
      lifecycleState: "active",
      sideEffects: "none",
      sourceKind: "project-manifest",
      provenance: { manifestPath: "/private/manifest.json" },
    },
    reasons: [{ code: "loaded", message: "available" }],
    examples: { run: { cli: "axf run echo say" } },
    suggestions: [],
  },
  {
    ok: true,
    operation: "inspect",
    input: { scope: "global" },
    capability: {
      id: "global.echo.say",
      summary: "echo",
      scope: "global",
      lifecycleState: "active",
      sideEffects: "none",
      argsSchema: { type: "object" },
      defaults: {},
      policies: [],
      outputModes: ["json"],
      warnings: ["Inspect before execution"],
      details: { report: "generated-report.json" },
      manifestPath: "/private/manifest.json",
    },
    injectedDefaults: {},
    examples: { run: { cli: "axf run echo say" } },
    launchPlan: { command: "node", cwd: repoRoot },
    adapter: { type: "internal" },
  },
  {
    ok: true,
    operation: "doctor",
    status: "ok",
    capabilityCount: 2,
    toolspaceCount: 1,
    manifestCount: 2,
    rejectedCount: 0,
    adapterCount: 2,
    familyCount: 0,
    issues: [],
    runtime: { commands: { axf: "/srv/axf/bin/axf.js" } },
  },
  {
    ok: true,
    operation: "scout_check",
    status: "ok",
    imports: [],
    changeCount: 0,
    changes: [],
    issues: [],
    readOnly: true,
  },
].map((payload) => ({ ...payload, ...workspaceMetadata }));

for (const payload of operationPayloads) {
  test(`${payload.operation} supports standard, compact, and diagnostic response detail`, () => {
    const diagnostic = projectMcpResponse(payload, "diagnostic");
    const standard = projectMcpResponse(payload, "standard");
    const compact = projectMcpResponse(payload, "compact");

    assert.notEqual(diagnostic, payload);
    assert.deepEqual(diagnostic, payload);
    assert.equal(standard.ok, payload.ok);
    assert.equal(standard.operation, payload.operation);
    assert.equal("workspace" in standard, false);
    assert.equal("executionWorkspace" in standard, false);
    assert.equal("workspaces" in standard, false);
    assert.equal(compact.ok, payload.ok);
    assert.equal(compact.operation, payload.operation);
    assert.ok(JSON.stringify(compact).length <= JSON.stringify(standard).length);
    if (payload.operation === "inspect") {
      assert.deepEqual(compact.capability.warnings, payload.capability.warnings);
      assert.deepEqual(compact.capability.details, payload.capability.details);
    }
  });
}

test("run profiles preserve data while removing successful execution traces", () => {
  const data = { answer: [1, 2, 3] };
  const payload = {
    ok: true,
    operation: "run",
    capability: {
      id: "global.demo.run",
      scope: "global",
      lifecycleState: "active",
      adapterType: "cli",
      provider: "demo",
      providerAdapter: null,
      sourceCapabilityId: null,
    },
    input: { path: ["demo", "run"] },
    args: { limit: 20 },
    data,
    error: null,
    meta: {
      capabilityId: "global.demo.run",
      adapterType: "cli",
      command: "demo",
      args: ["run", "--limit", "20"],
      cwd: repoRoot,
      launchPlan: { command: "demo", cwd: repoRoot },
      hints: ["Inspect the generated report"],
      policyWarnings: ["read-only workspace"],
    },
    ...workspaceMetadata,
  };

  const standard = projectMcpResponse(payload, "standard");
  const compact = projectMcpResponse(payload, "compact");

  assert.equal(standard.data, data);
  assert.equal(compact.data, data);
  assert.deepEqual(standard.meta, {
    hints: ["Inspect the generated report"],
    policyWarnings: ["read-only workspace"],
  });
  assert.deepEqual(compact.meta, standard.meta);
  assert.equal("input" in standard, false);
  assert.equal("error" in standard, false);
  assert.equal("args" in compact, false);
});

test("compact failures retain actionable errors without invocation traces", () => {
  const payload = {
    ok: false,
    operation: "run",
    capability: { id: "global.demo.run", lifecycleState: "active" },
    input: { path: ["demo", "run"] },
    args: {},
    data: null,
    error: { code: "EXECUTION_FAILED", message: "demo exited 2" },
    meta: { command: "demo", status: 2, cwd: repoRoot },
    ...workspaceMetadata,
  };

  const compact = projectMcpResponse(payload, "compact");
  const standard = projectMcpResponse(payload, "standard");

  assert.deepEqual(compact.error, payload.error);
  assert.deepEqual(compact.meta, { status: 2 });
  assert.equal("args" in compact, false);
  assert.equal("args" in standard, false);
});

test("compact is the agent-first default and materially reduces a run result", async () => {
  const input = {
    operation: "run",
    workspace: repoRoot,
    target: { id: "global.echo.say" },
    args: { message: "context budget" },
  };
  const compact = await performOperation(input);
  const diagnostic = await performOperation({
    ...input,
    responseDetail: "diagnostic",
  });

  assert.equal(compact.data, diagnostic.data);
  assert.equal("workspace" in compact, false);
  assert.ok(
    JSON.stringify(compact).length < JSON.stringify(diagnostic).length * 0.5,
  );
});

test("all profiles redact framework metadata without transforming capability data", () => {
  const secret = "swordfish-credential";
  const data = { password: secret, result: "provider-owned" };
  const payload = {
    ok: false,
    operation: "run",
    capability: { id: "global.demo.run", lifecycleState: "active" },
    input: { path: ["demo", "run"] },
    args: { password: secret, accessToken: secret },
    data,
    error: {
      code: "EXECUTION_FAILED",
      message: `provider rejected password ${secret}`,
    },
    meta: {
      command: "demo",
      args: ["--password", secret],
      authorization: `Bearer ${secret}`,
      connection: `postgres://worker:${secret}@localhost/axf`,
      providerEnvelope: { data: { password: secret } },
      status: 2,
    },
    ...workspaceMetadata,
  };

  for (const detail of ["compact", "standard", "diagnostic"]) {
    const projected = projectMcpResponse(payload, detail);
    const { data: projectedData, ...frameworkEnvelope } = projected;
    assert.equal(JSON.stringify(frameworkEnvelope).includes(secret), false);
    if (detail === "diagnostic") {
      assert.equal(projectedData, data);
      assert.equal(projected.args.password, "[REDACTED]");
      assert.equal(projected.meta.authorization, "[REDACTED]");
      assert.match(projected.meta.connection, /\[REDACTED\]/);
      assert.equal(
        projected.meta.providerEnvelope.data.password,
        "[REDACTED]",
      );
    }
  }

  assert.equal(data.password, secret);
});

test("redaction preserves sensitive argument schema declarations", () => {
  const payload = {
    ok: true,
    operation: "inspect",
    capability: {
      id: "global.demo.run",
      argsSchema: {
        type: "object",
        properties: {
          accessToken: {
            type: "string",
            description: "Provider token",
            example: "swordfish-credential",
          },
        },
      },
      defaults: { accessToken: "swordfish-credential" },
    },
  };

  const diagnostic = projectMcpResponse(payload, "diagnostic");

  assert.equal(
    diagnostic.capability.argsSchema.properties.accessToken.type,
    "string",
  );
  assert.equal(
    diagnostic.capability.argsSchema.properties.accessToken.description,
    "Provider token",
  );
  assert.equal(
    diagnostic.capability.argsSchema.properties.accessToken.example,
    "[REDACTED]",
  );
  assert.equal(diagnostic.capability.defaults.accessToken, "[REDACTED]");
});

test("invalid response detail fails closed with a schema-guided error", async () => {
  const result = await performOperation({
    operation: "list",
    workspace: repoRoot,
    responseDetail: "tiny",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_PARAMS");
  assert.match(result.error.message, /compact, standard, diagnostic/);
});
