export const AXF_TOOL_NAME = "axf";

export const AXF_MCP_OPERATIONS = Object.freeze([
  "help",
  "list",
  "inspect",
  "run",
  "doctor",
  "scout_check",
]);

export const AXF_TOOL_DESCRIPTION =
  "AXF capability router. Use this single MCP tool to list, inspect, and run AXF capabilities. Capabilities such as global.echo.say are not separate MCP tools. Call with operation=help, list, inspect, run, doctor, or scout_check. Always inspect before run, and use projectRoot/executionRoot when discovery and execution roots differ.";

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
    title: "list",
    arguments: { operation: "list" },
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
