#!/usr/bin/env node

import { startStdioServer } from "../src/mcp/server.js";

try {
  startStdioServer();
} catch (error) {
  const message = error?.message ?? String(error);
  console.error(`axf-mcp: ${message}`);
  process.exitCode = 1;
}