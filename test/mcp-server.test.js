import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";
import { AXFMCPServer } from "../src/mcp/server.js";

const repoRoot = new URL("..", import.meta.url).pathname;

test("tools/list advertises exactly one tool named axf", async () => {
  const server = new AXFMCPServer({ cwd: repoRoot, env: process.env });
  const response = await server.handleRequest({ method: "tools/list" });

  assert.equal(Array.isArray(response.tools), true);
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].name, "axf");
  assert.deepEqual(response.tools[0].inputSchema.properties.operation.enum, [
    "list",
    "inspect",
    "doctor",
    "scout_check",
    "run",
  ]);
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
