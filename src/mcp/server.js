import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performOperation } from "./operations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const AXF_TOOL_NAME = "axf";

export const AXF_TOOL = {
  name: AXF_TOOL_NAME,
  description:
    "Stable AXF capability router. Use it to list, inspect, diagnose, scout, and run AXF capabilities through AXF's own control plane.",
  inputSchema: {
    type: "object",
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        enum: ["list", "inspect", "doctor", "scout_check", "run"],
      },
      workspace: {
        type: "string",
        description: "Optional AXF workspace root override.",
      },
      target: {
        type: "object",
        description: "Capability target for inspect or run.",
        properties: {
          id: { type: "string" },
          path: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      args: {
        type: "object",
        description: "Capability arguments passed into AXF's existing validation and execution path.",
      },
      includeDrafts: {
        type: "boolean",
      },
      allowAnyLifecycle: {
        type: "boolean",
      },
    },
  },
};

export class AXFMCPServer {
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
  }

  async handleRequest(request) {
    const runtime = {
      cwd: this.cwd,
      env: this.env,
    };

    try {
      switch (request.method) {
        case "initialize":
          return {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: "axf-mcp",
              version: getPackageVersion(),
            },
          };
        case "tools/list":
          return {
            tools: [AXF_TOOL],
          };
        case "tools/call":
          return await this.handleToolsCall(request.params ?? {}, runtime);
        case "ping":
          return {};
        default:
          return {
            error: {
              code: -32601,
              message: `Unknown method: ${request.method}`,
            },
          };
      }
    } catch (error) {
      return {
        error: {
          code: error?.code ?? -32603,
          message: error?.message ?? String(error),
        },
      };
    }
  }

  async handleToolsCall(params, runtime) {
    if (params.name !== AXF_TOOL_NAME) {
      return toolResult({
        ok: false,
        operation: "unknown",
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool: ${params.name ?? "<missing>"}`,
        },
      });
    }

    const payload = await performOperation(params.arguments ?? {}, runtime);
    return toolResult(payload);
  }
}

export function startStdioServer(options = {}) {
  const server = new AXFMCPServer(options);
  let buffer = Buffer.alloc(0);
  let draining = Promise.resolve();

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    draining = draining.then(async () => {
      while (true) {
        const request = readMessage();
        if (!request) {
          return;
        }
        if (request.id === undefined || request.id === null) {
          continue;
        }

        const response = await server.handleRequest(request);
        writeMessage(
          response?.error
            ? {
                jsonrpc: "2.0",
                id: request.id,
                error: response.error,
              }
            : {
                jsonrpc: "2.0",
                id: request.id,
                result: response,
              },
        );
      }
    });
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  return server;

  function readMessage() {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return null;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      return null;
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      return null;
    }

    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    return JSON.parse(body);
  }
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: `${JSON.stringify(payload, null, 2)}\n`,
      },
    ],
    structuredContent: payload,
    isError: !payload.ok,
  };
}

function writeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function getPackageVersion() {
  try {
    const packagePath = join(__dirname, "..", "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}