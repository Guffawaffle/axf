export const AXF_TOOL_NAME = "axf";

export const AXF_MCP_OPERATIONS = Object.freeze([
  "help",
  "list",
  "guide",
  "explain",
  "inspect",
  "run",
  "doctor",
  "scout_check",
]);

export const AXF_TOOL_DESCRIPTION =
  "AXF capability router. Use this single MCP tool to guide, list, explain, inspect, and run AXF capabilities. Capabilities such as global.echo.say are not separate MCP tools. Prefer guide for bounded workflow entrypoints or list with compact/search for discovery. Always inspect before run, and use projectRoot/executionRoot when discovery and execution roots differ.";

export const AXF_MCP_CAPABILITY_EXAMPLES = Object.freeze(["global.echo.say"]);

export const AXF_MCP_NOT_EXPOSED_COMMANDS = Object.freeze([
  "init",
  "promote",
  "demote",
  "scout --write",
  "materialization commands",
]);

export const AXF_MCP_EXAMPLES = Object.freeze([
  {
    title: "help",
    arguments: { operation: "help" },
  },
  {
    title: "bounded workflow guide",
    arguments: { operation: "guide" },
  },
  {
    title: "compact capability search",
    arguments: { operation: "list", compact: true, search: "echo" },
  },
  {
    title: "explain a missing capability",
    arguments: { operation: "explain", query: "global.echo" },
  },
  {
    title: "inspect global.echo.say",
    arguments: {
      operation: "inspect",
      projectRoot: "/repo/with/manifests",
      executionRoot: "/caller/workspace",
      target: { id: "global.echo.say" },
    },
  },
  {
    title: "run global.echo.say",
    arguments: {
      operation: "run",
      target: { id: "global.echo.say" },
    },
  },
]);
