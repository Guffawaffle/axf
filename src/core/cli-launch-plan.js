import path from "node:path";
import { AxError } from "./errors.js";

const WORKSPACE_RELATIVE = "workspace";

export function resolveCliLaunchPlan(capability, { runtime = null, env = process.env } = {}) {
    const executionTarget = capability.executionTarget;
    if (!executionTarget || typeof executionTarget !== "object") {
        throw new AxError(
            `cli capability '${capability.id}' is missing a valid executionTarget`,
            2
        );
    }

    const workingDirectory = resolveWorkingDirectory(
        executionTarget.cwd,
        capability.id,
        runtime
    );

    const baseArgs = normalizeStringArray(
        executionTarget.args,
        `cli capability '${capability.id}' executionTarget.args`
    );

    if (typeof executionTarget.command === "string" && executionTarget.command) {
        if (executionTarget.target || executionTarget.launcher) {
            throw new AxError(
                `cli capability '${capability.id}' cannot mix executionTarget.command with executionTarget.target or executionTarget.launcher`,
                2
            );
        }

        return {
            command: executionTarget.command,
            argsPrefix: baseArgs,
            cwd: workingDirectory.path,
            cwdSource: workingDirectory.source,
            targetPath: null,
            targetSource: "command",
            executionTarget
        };
    }

    const target = executionTarget.target;
    if (!target || typeof target !== "object") {
        throw new AxError(
            `cli capability '${capability.id}' requires executionTarget.command or executionTarget.target.path`,
            2
        );
    }

    if (typeof target.path !== "string" || !target.path) {
        throw new AxError(
            `cli capability '${capability.id}' requires executionTarget.target.path`,
            2
        );
    }

    const resolvedTarget = resolveTargetPath(target, capability.id, runtime, env);
    const launcher = executionTarget.launcher;

    if (!launcher) {
        return {
            command: resolvedTarget.path,
            argsPrefix: baseArgs,
            cwd: workingDirectory.path,
            cwdSource: workingDirectory.source,
            targetPath: resolvedTarget.path,
            targetSource: resolvedTarget.source,
            executionTarget
        };
    }

    if (typeof launcher !== "object") {
        throw new AxError(
            `cli capability '${capability.id}' executionTarget.launcher must be an object`,
            2
        );
    }

    if (typeof launcher.command !== "string" || !launcher.command) {
        throw new AxError(
            `cli capability '${capability.id}' requires executionTarget.launcher.command`,
            2
        );
    }

    const launcherArgs = normalizeStringArray(
        launcher.args,
        `cli capability '${capability.id}' executionTarget.launcher.args`
    );

    return {
        command: launcher.command,
        argsPrefix: [...launcherArgs, resolvedTarget.path, ...baseArgs],
        cwd: workingDirectory.path,
        cwdSource: workingDirectory.source,
        targetPath: resolvedTarget.path,
        targetSource: resolvedTarget.source,
        executionTarget
    };
}

function resolveWorkingDirectory(cwdSpec, capabilityId, runtime) {
    const processCwd = runtime?.cwd ?? process.cwd();
    if (cwdSpec === undefined) {
        const workspaceRoot = runtime?.workspace?.root;
        if (workspaceRoot) {
            return { path: path.resolve(workspaceRoot), source: "workspace" };
        }
        return { path: path.resolve(processCwd), source: "process" };
    }

    if (typeof cwdSpec === "string") {
        return resolveCwdPath(cwdSpec, "workspace", capabilityId, runtime, processCwd);
    }

    if (typeof cwdSpec !== "object" || Array.isArray(cwdSpec)) {
        throw new AxError(
            `cli capability '${capabilityId}' executionTarget.cwd must be a string or object`,
            2
        );
    }

    if (typeof cwdSpec.path !== "string" || !cwdSpec.path) {
        throw new AxError(
            `cli capability '${capabilityId}' executionTarget.cwd.path must be a string`,
            2
        );
    }

    return resolveCwdPath(
        cwdSpec.path,
        cwdSpec.relativeTo ?? "workspace",
        capabilityId,
        runtime,
        processCwd
    );
}

function resolveCwdPath(cwdPath, relativeTo, capabilityId, runtime, processCwd) {
    if (path.isAbsolute(cwdPath)) {
        return { path: path.resolve(cwdPath), source: "executionTarget.cwd:absolute" };
    }

    if (relativeTo === "workspace") {
        const workspaceRoot = runtime?.workspace?.root;
        if (!workspaceRoot) {
            throw new AxError(
                `cli capability '${capabilityId}' requires a bound workspace to resolve executionTarget.cwd relativeTo='workspace'`,
                2
            );
        }
        return {
            path: path.resolve(workspaceRoot, cwdPath),
            source: "executionTarget.cwd:workspace"
        };
    }

    if (relativeTo === "process") {
        return {
            path: path.resolve(processCwd, cwdPath),
            source: "executionTarget.cwd:process"
        };
    }

    throw new AxError(
        `cli capability '${capabilityId}' has unsupported executionTarget.cwd.relativeTo '${relativeTo}'`,
        2
    );
}

function resolveTargetPath(target, capabilityId, runtime, env) {
    if (path.isAbsolute(target.path)) {
        return { path: target.path, source: "absolute" };
    }

    const envName = typeof target.fromEnv === "string" ? target.fromEnv : null;
    if (envName && env[envName]) {
        return {
            path: path.resolve(env[envName], target.path),
            source: `env:${envName}`
        };
    }

    if (target.fallbackRoot) {
        const root = resolveRelativeRoot(
            target.fallbackRoot,
            target.fallbackRelativeTo,
            capabilityId,
            runtime,
            envName ? `fallback for ${envName}` : "fallbackRoot"
        );
        return {
            path: path.resolve(root, target.path),
            source: envName ? `fallback:${envName}` : "fallback"
        };
    }

    if (target.relativeTo) {
        const root = resolveRelativeRoot(
            ".",
            target.relativeTo,
            capabilityId,
            runtime,
            "relativeTo"
        );
        return {
            path: path.resolve(root, target.path),
            source: `relative:${target.relativeTo}`
        };
    }

    if (envName) {
        throw new AxError(
            `cli capability '${capabilityId}' could not resolve executionTarget.target.path because ${envName} is unset and no fallbackRoot is declared`,
            2
        );
    }

    throw new AxError(
        `cli capability '${capabilityId}' uses a relative executionTarget.target.path and must declare target.relativeTo or target.fromEnv`,
        2
    );
}

function resolveRelativeRoot(rootPath, relativeTo, capabilityId, runtime, contextLabel) {
    if (relativeTo !== WORKSPACE_RELATIVE) {
        throw new AxError(
            `cli capability '${capabilityId}' has unsupported ${contextLabel} '${relativeTo}'`,
            2
        );
    }

    const workspaceRoot = runtime?.workspace?.root;
    if (!workspaceRoot) {
        throw new AxError(
            `cli capability '${capabilityId}' requires a bound workspace to resolve ${contextLabel}='${relativeTo}'`,
            2
        );
    }

    return path.resolve(workspaceRoot, rootPath);
}

function normalizeStringArray(value, label) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new AxError(`${label} must be an array of strings`, 2);
    }
    return value;
}