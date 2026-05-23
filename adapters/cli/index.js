import { spawnSync } from "node:child_process";
import { AxError } from "../../src/core/errors.js";
import { resolveCliLaunchPlan } from "../../src/core/cli-launch-plan.js";
import { prepareCommandInvocation } from "../../src/core/command-invocation.js";

const FRAMEWORK_ARG_KEYS = new Set(["json", "allow-draft", "any-lifecycle"]);

export async function execute(resolved, ctx = {}) {
  const { capability, args } = resolved;
  const launchPlan = resolveCliLaunchPlan(capability, {
    runtime: ctx.runtime ?? null,
  });
  const cliArgs = [
    ...launchPlan.argsPrefix,
    ...argsToCliArgs(args, capability),
  ];
  const invocation = prepareCommandInvocation(launchPlan.command, cliArgs, {
    env: ctx.runtime?.env ?? process.env,
    platform: ctx.runtime?.platform ?? process.platform,
  });
  const meta = buildLaunchMeta(capability, invocation, launchPlan);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: launchPlan.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    return {
      ok: false,
      error: { message: result.error.message },
      meta,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: {
        message:
          result.stderr?.trim() ||
          `process exited with status ${result.status}`,
      },
      meta: {
        ...meta,
        status: result.status,
      },
    };
  }

  const stdout = result.stdout?.trim() ?? "";
  return {
    ok: true,
    data: parseJsonMaybe(stdout),
    meta,
  };
}

function buildLaunchMeta(capability, invocation, launchPlan) {
  return {
    capabilityId: capability.id,
    adapterType: "cli",
    command: invocation.command,
    args: invocation.args,
    cwd: launchPlan.cwd,
    launchPlan: {
      command: invocation.command,
      args: invocation.args,
      cwd: launchPlan.cwd,
      cwdSource: launchPlan.cwdSource,
      requestedCommand: invocation.requestedCommand,
      resolvedCommand: invocation.resolvedCommand,
      commandSource: invocation.commandSource,
      launchStrategy: invocation.launchStrategy,
      targetPath: launchPlan.targetPath,
      targetSource: launchPlan.targetSource,
    },
  };
}

function argsToCliArgs(args, capability) {
  const argMap = capability?.argMap ?? null;
  return Object.entries(args)
    .filter(([key]) => !FRAMEWORK_ARG_KEYS.has(key))
    .flatMap(([key, value]) => {
      const flag = argMap?.[key] ?? `--${key}`;
      if (value === true) {
        return [flag];
      }
      if (value === false || value === undefined || value === null) {
        return [];
      }
      return [flag, String(value)];
    });
}

function parseJsonMaybe(value) {
  if (!value) {
    return "";
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
