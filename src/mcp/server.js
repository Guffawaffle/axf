import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AXF_MCP_OPERATIONS,
  AXF_TOOL_DESCRIPTION,
  AXF_TOOL_NAME,
} from "./contract.js";
import { performOperation } from "./operations.js";
import {
  AXF_RESPONSE_DETAILS,
  DEFAULT_AXF_RESPONSE_DETAIL,
} from "./response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export { AXF_TOOL_NAME } from "./contract.js";

export const AXF_TOOL = {
  name: AXF_TOOL_NAME,
  description: AXF_TOOL_DESCRIPTION,
  inputSchema: {
    type: "object",
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        enum: AXF_MCP_OPERATIONS,
      },
      projectRoot: {
        type: "string",
        description:
          "Canonical AXF project root override for manifest and adapter discovery.",
      },
      executionRoot: {
        type: "string",
        description:
          "Canonical AXF execution root override for runtime cwd and caller-facing execution.",
      },
      workspace: {
        type: "string",
        description:
          "Legacy AXF workspace root override that sets both project and execution roots.",
      },
      registryWorkspace: {
        type: "string",
        description:
          "Legacy AXF registry workspace override for manifest and adapter discovery.",
      },
      executionWorkspace: {
        type: "string",
        description:
          "Legacy AXF execution workspace override for runtime cwd and caller-facing execution.",
      },
      target: {
        type: "object",
        description: "Capability target for explain, inspect, or run.",
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
        description:
          "Capability arguments passed into AXF's existing validation and execution path.",
      },
      includeDrafts: {
        type: "boolean",
      },
      allowAnyLifecycle: {
        type: "boolean",
      },
      compact: {
        type: "boolean",
        description:
          "Return compact capability summaries instead of full manifests for operation=list.",
      },
      responseDetail: {
        type: "string",
        enum: AXF_RESPONSE_DETAILS,
        default: DEFAULT_AXF_RESPONSE_DETAIL,
        description:
          "Agent-facing response detail. compact is the deterministic context-efficient default; standard expands the result; diagnostic explicitly adds compatibility and execution metadata with sensitive framework fields redacted.",
      },
      search: {
        type: "string",
        description:
          "Filter operation=list by id, summary, provider, owner, family, or manifest source.",
      },
      sideEffects: {
        type: "string",
        enum: ["none", "read", "write", "network", "unknown"],
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description:
          "Bound list or guide results. Compact response-detail lists default to 25; an explicit limit overrides that bound.",
      },
      intent: {
        type: "string",
        enum: [
          "context",
          "session-start",
          "check",
          "validation",
          "handoff",
        ],
        description: "Optional workflow intent filter for operation=guide.",
      },
      query: {
        type: "string",
        description:
          "Capability id, family, prefix, or search term for operation=explain.",
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
    draining = draining
      .then(async () => {
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
      })
      .catch((error) => {
        const message = error?.message ?? String(error);
        process.stderr.write(`axf-mcp: ${message}\n`);
      });
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  return server;

  function readMessage() {
    while (buffer.length > 0) {
      const framedMessage = readContentLengthMessage();
      if (framedMessage.status === "message") {
        return framedMessage.message;
      }
      if (framedMessage.status === "incomplete") {
        return null;
      }

      const line = readLineMessage();
      if (!line) {
        return null;
      }
      if (line.text === "") {
        continue;
      }
      return JSON.parse(line.text);
    }

    return null;
  }

  function readContentLengthMessage() {
    const prefix = buffer
      .subarray(0, Math.min(buffer.length, 32))
      .toString("utf8");
    if (!/^Content-Length:/i.test(prefix)) {
      return { status: "not-frame" };
    }

    const delimiter = findHeaderDelimiter(buffer);
    if (!delimiter) {
      return { status: "incomplete" };
    }

    const header = buffer.subarray(0, delimiter.index).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(delimiter.index + delimiter.length);
      return { status: "not-frame" };
    }

    const contentLength = Number(match[1]);
    const bodyStart = delimiter.index + delimiter.length;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      return { status: "incomplete" };
    }

    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    return { status: "message", message: JSON.parse(body) };
  }

  function readLineMessage() {
    const lfIndex = buffer.indexOf(0x0a);
    if (lfIndex === -1) {
      return null;
    }

    const lineEnd =
      lfIndex > 0 && buffer[lfIndex - 1] === 0x0d ? lfIndex - 1 : lfIndex;
    const text = buffer.subarray(0, lineEnd).toString("utf8").trim();
    buffer = buffer.subarray(lfIndex + 1);
    return { text };
  }
}

function findHeaderDelimiter(sourceBuffer) {
  const crlfEnd = sourceBuffer.indexOf("\r\n\r\n");
  const lfEnd = sourceBuffer.indexOf("\n\n");

  if (crlfEnd === -1 && lfEnd === -1) {
    return null;
  }
  if (crlfEnd !== -1 && (lfEnd === -1 || crlfEnd < lfEnd)) {
    return { index: crlfEnd, length: 4 };
  }
  return { index: lfEnd, length: 2 };
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
    isError: !payload.ok,
  };
}

function writeMessage(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function getPackageVersion() {
  try {
    const packagePath = join(__dirname, "..", "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
