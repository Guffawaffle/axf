import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectCodexConfig,
  integrateCodex,
  smokeCodexMcp,
  updateAxFPackagePin,
} from "../src/core/codex-integration.js";

const staleConfig = `# personal settings stay byte-for-byte stable
model = "gpt-test"

[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"

[mcp_servers.axf]
command = "npx"
args = ["-y", "@smartergpt/axf@0.2.1", "mcp"]
cwd = "D:\\\\dev\\\\axf-global"
env = { AXF_PROJECT_ROOT = "D:\\\\dev\\\\axf-global", AXF_EXECUTION_ROOT = "D:\\\\dev\\\\axf-global" }

[history]
persistence = "save-all"
`;

test("Codex integration inspection reports package, launch, cwd, and roots", () => {
  const result = inspectCodexConfig(staleConfig, "1.2.0");

  assert.equal(result.status, "stale");
  assert.equal(result.server.id, "axf");
  assert.equal(result.server.command, "npx");
  assert.deepEqual(result.server.args, ["-y", "@smartergpt/axf@0.2.1", "mcp"]);
  assert.equal(result.server.configuredVersion, "0.2.1");
  assert.equal(result.server.rootEnvironment.AXF_PROJECT_ROOT, "D:\\dev\\axf-global");
});

test("package pin update preserves every unrelated config byte", () => {
  const inspected = inspectCodexConfig(staleConfig, "1.2.0");
  const update = updateAxFPackagePin(staleConfig, inspected.server, "1.2.0");

  assert.equal(update.changed, true);
  assert.equal(
    update.source,
    staleConfig.replace("@smartergpt/axf@0.2.1", "@smartergpt/axf@1.2.0"),
  );
});

test("integrate codex --write updates only the selected config file and requests restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "axf-codex-integration-"));
  const configPath = path.join(root, "config.toml");
  try {
    await writeFile(configPath, staleConfig, "utf8");
    const report = await integrateCodex({ configPath, runtimeVersion: "1.2.0", write: true });
    const written = await readFile(configPath, "utf8");

    assert.equal(report.ok, true);
    assert.equal(report.action.changed, true);
    assert.equal(report.action.restartRequired, true);
    assert.equal(report.configured.status, "current");
    assert.equal(
      written,
      staleConfig.replace("@smartergpt/axf@0.2.1", "@smartergpt/axf@1.2.0"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP smoke verifies initialize, tools/list, and explicit-root doctor", () => {
  let invocation;
  const result = smokeCodexMcp(
    {
      command: "axf",
      args: ["mcp"],
      cwd: "/repo",
      rootEnvironment: {},
    },
    {
      projectRoot: "/repo",
      executionRoot: "/repo",
      runner(command, args, options) {
        invocation = { command, args, options };
        return {
          status: 0,
          stdout: [
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "axf-mcp", version: "1.2.0" } } }),
            JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "axf" }] } }),
            JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } }),
          ].join("\n"),
          stderr: "",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(invocation.command, "axf");
  assert.match(invocation.options.input, /"operation":"doctor"/);
  assert.match(invocation.options.input, /"projectRoot":"\/repo"/);
  assert.match(invocation.options.input, /"executionRoot":"\/repo"/);
});
