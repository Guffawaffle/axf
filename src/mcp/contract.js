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
  "AXF capability router. Use this single MCP tool to list, inspect, and run AXF capabilities. Capabilities such as global.lex.status are not separate MCP tools. Call with operation=help, list, inspect, run, doctor, or scout_check. Always inspect before run and respect lifecycle/sideEffects/policy metadata.";

export const AXF_MCP_CAPABILITY_EXAMPLES = Object.freeze([
  "global.lex.status",
  "global.stfc-mod.status",
]);

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
    title: "inspect global.lex.status",
    arguments: {
      operation: "inspect",
      target: { id: "global.lex.status" },
    },
  },
  {
    title: "run global.lex.status",
    arguments: {
      operation: "run",
      target: { id: "global.lex.status" },
    },
  },
  {
    title: "inspect global.stfc-mod.status",
    arguments: {
      operation: "inspect",
      target: { id: "global.stfc-mod.status" },
    },
  },
]);