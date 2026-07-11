import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AXFMCPServer } from "../src/mcp/server.js";

const repoRoot = new URL("..", import.meta.url).pathname;

test("tools/list advertises exactly one tool named axf", async () => {
  const server = new AXFMCPServer({ cwd: repoRoot, env: process.env });
  const response = await server.handleRequest({ method: "tools/list" });

  assert.equal(Array.isArray(response.tools), true);
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].name, "axf");
  assert.equal(
    response.tools[0].description,
    "AXF capability router. Use this single MCP tool to guide, list, explain, inspect, and run AXF capabilities. Capabilities such as global.echo.say are not separate MCP tools. Prefer guide for bounded workflow entrypoints or list with compact/search for discovery. Always inspect before run, and use projectRoot/executionRoot when discovery and execution roots differ.",
  );
  assert.deepEqual(response.tools[0].inputSchema.properties.operation.enum, [
    "help",
    "list",
    "guide",
    "explain",
    "inspect",
    "run",
    "doctor",
    "scout_check",
  ]);
});

test("tools/call help returns the single-tool router contract", async () => {
  const server = new AXFMCPServer({ cwd: repoRoot, env: process.env });
  const response = await server.handleRequest({
    method: "tools/call",
    params: {
      name: "axf",
      arguments: {
        operation: "help",
        workspace: repoRoot,
      },
    },
  });

  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.ok, true);
  assert.equal(response.structuredContent.operation, "help");
  assert.equal(response.structuredContent.tool.name, "axf");
  assert.equal(
    response.structuredContent.contract.capabilitiesAreSeparateTools,
    false,
  );
});

test("tools/call routes run through the single axf tool", async () => {
  const server = new AXFMCPServer({ cwd: repoRoot, env: process.env });
  const response = await server.handleRequest({
    method: "tools/call",
    params: {
      name: "axf",
      arguments: {
        operation: "run",
        workspace: repoRoot,
        target: { id: "global.echo.say" },
        args: { message: "server path" },
      },
    },
  });

  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.ok, true);
  assert.equal(response.structuredContent.operation, "run");
  assert.equal(response.structuredContent.data, "server path");
});

test("stdio MCP entrypoint serves the single axf tool", async () => {
  const { responses, stdout } = await requestStdioServer(
    [path.join(repoRoot, "bin", "axf-mcp.js")],
    [
      initializeRequest(1),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
  );
  const initializeResponse = findResponse(responses, 1);
  const toolsListResponse = findResponse(responses, 2);

  assert.equal(initializeResponse.result.serverInfo.name, "axf-mcp");
  assert.equal(toolsListResponse.result.tools.length, 1);
  assert.equal(toolsListResponse.result.tools[0].name, "axf");
  assertStdoutJsonLinesOnly(stdout);
});

test("axf mcp serves the same single axf tool", async () => {
  const { responses, stdout } = await requestStdioServer(
    [path.join(repoRoot, "bin", "axf.js"), "mcp"],
    [
      initializeRequest(1),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
  );
  const response = findResponse(responses, 2);

  assert.equal(response.result.tools.length, 1);
  assert.equal(response.result.tools[0].name, "axf");
  assertStdoutJsonLinesOnly(stdout);
});

test("stdio MCP entrypoint routes tools/call over newline-delimited stdio", async () => {
  const { responses, stdout } = await requestStdioServer(
    [path.join(repoRoot, "bin", "axf-mcp.js")],
    [
      initializeRequest(1),
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "axf",
          arguments: {
            operation: "run",
            workspace: repoRoot,
            target: { id: "global.echo.say" },
            args: { message: "newline stdio" },
          },
        },
      },
    ],
  );
  const response = findResponse(responses, 2);

  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.ok, true);
  assert.equal(response.result.structuredContent.operation, "run");
  assert.equal(response.result.structuredContent.data, "newline stdio");
  assertStdoutJsonLinesOnly(stdout);
});

test("stdio MCP entrypoint accepts VS Code-shaped raw JSON initialize", async () => {
  const { responses, stdout } = await requestStdioServer(
    [path.join(repoRoot, "bin", "axf-mcp.js")],
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Visual Studio Code", version: "1.0.0" },
        },
      },
    ],
  );
  const response = findResponse(responses, 1);

  assert.equal(response.result.serverInfo.name, "axf-mcp");
  assert.equal(response.result.capabilities.tools.listChanged, false);
  assertStdoutJsonLinesOnly(stdout);
});

test("stdio MCP entrypoint accepts Content-Length input as legacy compatibility", async () => {
  const { responses, stdout } = await requestStdioServer(
    [path.join(repoRoot, "bin", "axf-mcp.js")],
    [
      initializeRequest(1),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
    { encodeMessage: encodeContentLengthMessage },
  );
  const response = findResponse(responses, 2);

  assert.equal(response.result.tools.length, 1);
  assert.equal(response.result.tools[0].name, "axf");
  assertStdoutJsonLinesOnly(stdout);
});

test("persistent MCP server reloads registry state between list calls", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "axf-mcp-refresh-"),
  );
  await writeFile(
    path.join(workspaceRoot, "axf.workspace.json"),
    JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" }),
  );
  await mkdir(path.join(workspaceRoot, "manifests", "capabilities"), {
    recursive: true,
  });

  const session = await startPersistentStdioServer(
    [path.join(repoRoot, "bin", "axf-mcp.js")],
    { cwd: workspaceRoot, workspace: workspaceRoot },
  );

  try {
    await session.send(initializeRequest(1));

    const firstList = await session.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "axf",
        arguments: {
          operation: "list",
          workspace: workspaceRoot,
        },
      },
    });
    const firstIds = firstList.result.structuredContent.capabilities.map(
      (capability) => capability.id,
    );

    const addedId = "global.dynamic.status";
    assert.equal(firstIds.includes(addedId), false);

    await writeFile(
      path.join(workspaceRoot, "manifests", "capabilities", `${addedId}.json`),
      `${JSON.stringify(
        {
          manifestVersion: "axf/v0",
          id: addedId,
          summary: "Dynamic capability added after MCP server start",
          provider: "echo",
          adapterType: "internal",
          executionTarget: { handler: "echo.say" },
          argsSchema: {
            type: "object",
            properties: {},
          },
          outputModes: ["json"],
          sideEffects: "none",
          scope: "global",
          lifecycleState: "active",
          defaults: {},
          policies: [],
          owner: "test:mcp-refresh",
        },
        null,
        2,
      )}\n`,
    );

    const secondList = await session.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "axf",
        arguments: {
          operation: "list",
          workspace: workspaceRoot,
        },
      },
    });
    const secondIds = secondList.result.structuredContent.capabilities.map(
      (capability) => capability.id,
    );

    assert.equal(secondIds.includes(addedId), true);
    assert.equal(secondIds.length > firstIds.length, true);
    assertStdoutJsonLinesOnly(session.getStdout());
  } finally {
    await session.stop();
  }
});

async function requestStdioServer(args, requests, options = {}) {
  const encode = options.encodeMessage ?? encodeLineMessage;
  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, AXF_WORKSPACE: repoRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  const responses = [];
  const expectedIds = new Set(
    requests
      .filter((request) => request.id !== undefined && request.id !== null)
      .map((request) => request.id),
  );
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const closePromise = once(proc, "close");
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `timed out waiting for MCP response${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    }, 5000);

    const onData = createLineParser((message) => {
      responses.push(message);
      expectedIds.delete(message.id);
      if (expectedIds.size === 0) {
        clearTimeout(timeout);
        resolve({ responses, stdout });
      }
    });

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      try {
        onData(chunk);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `axf-mcp exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
          ),
        );
      }
    });
  });

  for (const request of requests) {
    proc.stdin.write(encode(request));
  }

  const result = await responsePromise;

  proc.kill("SIGTERM");
  await closePromise;

  return result;
}

async function startPersistentStdioServer(args, options = {}) {
  const proc = spawn(process.execPath, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      AXF_WORKSPACE: options.workspace ?? repoRoot,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  const pending = new Map();

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const onData = createLineParser((message) => {
    const waiter = pending.get(message.id);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timeout);
    pending.delete(message.id);
    waiter.resolve(message);
  });

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    onData(chunk);
  });

  proc.on("exit", (code) => {
    if (code === 0) {
      return;
    }

    for (const [id, waiter] of pending.entries()) {
      clearTimeout(waiter.timeout);
      waiter.reject(
        new Error(
          `axf-mcp exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
      pending.delete(id);
    }
  });

  return {
    send(request, sendOptions = {}) {
      const encode = sendOptions.encodeMessage ?? encodeLineMessage;
      if (request.id === undefined || request.id === null) {
        proc.stdin.write(encode(request));
        return Promise.resolve(null);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(request.id);
          reject(
            new Error(
              `timed out waiting for MCP response${stderr ? `: ${stderr}` : ""}`,
            ),
          );
        }, sendOptions.timeout ?? 5000);

        pending.set(request.id, { resolve, reject, timeout });
        proc.stdin.write(encode(request));
      });
    },
    getStdout() {
      return stdout;
    },
    async stop() {
      const closePromise = once(proc, "close");
      proc.kill("SIGTERM");
      await closePromise;
    },
  };
}

function initializeRequest(id) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  };
}

function encodeLineMessage(value) {
  return `${JSON.stringify(value)}\n`;
}

function encodeContentLengthMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
}

function createLineParser(onMessage) {
  let buffer = "";

  return (chunk) => {
    buffer += chunk.toString("utf8");

    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }

      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line === "") {
        continue;
      }
      onMessage(JSON.parse(line));
    }
  };
}

function findResponse(responses, id) {
  const response = responses.find((message) => message.id === id);
  assert.ok(response, `missing response id ${id}`);
  return response;
}

function assertStdoutJsonLinesOnly(stdout) {
  assert.match(stdout, /^\{/);
  assert.equal(stdout.includes("Content-Length"), false);

  const lines = stdout.trimEnd().split(/\r?\n/);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
}
