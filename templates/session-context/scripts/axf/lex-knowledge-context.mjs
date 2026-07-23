#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEALTH_VALUES = new Set(["ready", "empty", "stale", "invalid", "unavailable"]);
const FRESHNESS_VALUES = new Set(["current", "stale", "missing", "invalid"]);
const SELECTION_REASONS = new Set(["query-match", "active", "current"]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    options[key] = value && !value.startsWith("--") ? value : true;
    if (options[key] !== true) index += 1;
  }
  return options;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function warning(code, evidence) {
  return { code, digest: digest(evidence) };
}

function baseResult(request) {
  return {
    schemaVersion: "axf/context-provider/v1",
    provider: "lex",
    operation: "knowledge-context",
    health: "unavailable",
    request,
    snapshot: null,
    selection: { candidateCount: 0, selectedCount: 0, ids: [], reasons: [] },
    budget: null,
    warnings: [],
    provenance: { sourceDigest: null },
  };
}

function classifyHealth(value) {
  if (!value || value.operation !== "knowledge-context") return "invalid";
  const freshness = value.snapshot?.freshness;
  if (freshness !== "current") return "stale";
  if (boundedInteger(value.selection?.selectedCount, 0, 0, 100000) === 0) return "empty";
  return "ready";
}

export function queryLexKnowledgeContext(options = {}, runner = spawnSync) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const executionRoot = path.resolve(options.executionRoot || projectRoot);
  const query = String(options.query || "").slice(0, 1000);
  const branch = String(options.branch || "unknown").slice(0, 240);
  const repositoryKey = options.repositoryKey
    ? String(options.repositoryKey).slice(0, 240)
    : null;
  const limit = boundedInteger(options.limit, 5, 1, 20);
  const maxBytes = boundedInteger(options.maxBytes, 4096, 1024, 16000);
  const request = {
    projectRoot,
    executionRoot,
    query,
    branch,
    repositoryKey,
    limit,
    maxBytes,
  };
  const output = baseResult(request);
  const command =
    options.command ||
    process.env.AXF_SESSION_LEX_COMMAND ||
    (process.platform === "win32" ? "lex.cmd" : "lex");
  const args = [
    "--json",
    "knowledge",
    "context",
    query,
    "--project-root",
    projectRoot,
    "--limit",
    String(limit),
    "--max-bytes",
    String(maxBytes),
  ];
  if (repositoryKey) {
    args.push("--repository-key", repositoryKey);
  }
  const result = runner(command, args, {
    cwd: executionRoot,
    env: { ...process.env },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });

  if (result.error || result.status !== 0) {
    const evidence = result.error?.message || String(result.stderr || `exit ${result.status}`);
    output.warnings.push(warning(result.error ? "provider-launch-failed" : "provider-failed", evidence));
    return output;
  }

  const raw = String(result.stdout || "").trim();
  output.provenance.sourceDigest = digest(raw);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    output.health = "invalid";
    output.warnings.push(warning("provider-invalid-json", raw));
    return output;
  }

  output.health = classifyHealth(value);
  if (!HEALTH_VALUES.has(output.health)) output.health = "invalid";
  const freshness = FRESHNESS_VALUES.has(value.snapshot?.freshness)
    ? value.snapshot.freshness
    : "invalid";
  output.snapshot = {
    activeSnapshotId:
      typeof value.snapshot?.activeSnapshotId === "string"
        ? value.snapshot.activeSnapshotId.slice(0, 160)
        : null,
    currentSnapshotId:
      typeof value.snapshot?.currentSnapshotId === "string"
        ? value.snapshot.currentSnapshotId.slice(0, 160)
        : null,
    freshness,
  };
  const records = Array.isArray(value.records) ? value.records : [];
  output.selection = {
    candidateCount: boundedInteger(value.selection?.candidateCount, 0, 0, 100000),
    selectedCount: boundedInteger(value.selection?.selectedCount, 0, 0, 100000),
    ids: records
      .map((record) => record?.id)
      .filter((id) => typeof id === "string")
      .map((id) => id.slice(0, 160))
      .slice(0, 20),
    reasons: Array.isArray(value.selection?.reasons)
      ? value.selection.reasons.filter((reason) => SELECTION_REASONS.has(reason)).slice(0, 10)
      : [],
  };
  output.budget = {
    maxBytes: boundedInteger(value.budget?.maxBytes, maxBytes, 0, Number.MAX_SAFE_INTEGER),
    usedBytes: boundedInteger(value.budget?.usedBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    omittedRecords: boundedInteger(value.budget?.omittedRecords, 0, 0, 100000),
  };
  output.warnings = Array.isArray(value.warnings)
    ? value.warnings.slice(0, 20).map((item) => warning("provider-warning", item))
    : [];
  return output;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = queryLexKnowledgeContext({
    query: args.query,
    projectRoot: args["project-root"],
    executionRoot: args["execution-root"],
    branch: args.branch,
    repositoryKey: args["repository-key"],
    limit: args.limit,
    maxBytes: args["max-bytes"],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
