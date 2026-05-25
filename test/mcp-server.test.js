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
  const response = await requestToolsList([
    path.join(repoRoot, "bin", "axf-mcp.js"),
  ]);

  assert.equal(response.result.tools.length, 1);
  assert.equal(response.result.tools[0].name, "axf");
});

test("axf mcp serves the same single axf tool", async () => {
  const response = await requestToolsList([
    path.join(repoRoot, "bin", "axf.js"),
    "mcp",
  ]);

  assert.equal(response.result.tools.length, 1);
  assert.equal(response.result.tools[0].name, "axf");
});

async function requestToolsList(args) {
  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, AXF_WORKSPACE: repoRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for tools/list response${stderr ? `: ${stderr}` : ""}`));
    }, 5000);

    const onData = createFrameParser((message) => {
      if (message.id === 2) {
        clearTimeout(timeout);
        resolve(message);
      }
    });

    proc.stdout.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`axf-mcp exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
      }
    });
  });

  proc.stdin.write(
    encodeMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  );
  proc.stdin.write(
    encodeMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  );

  const response = await responsePromise;

  proc.kill("SIGTERM");
  await once(proc, "close");

  return response;
}

function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
}

function createFrameParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        throw new Error("missing Content-Length header in MCP response");
      }

      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        return;
      }

      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);
      onMessage(JSON.parse(body));
    }
  };
}