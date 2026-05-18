import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/core/registry.js";
import { resolveCapability } from "../src/core/resolver.js";
import { executeResolvedCapability } from "../src/core/executor.js";
import { loadAdapters } from "../src/core/adapter-loader.js";
import { main } from "../src/cli/main.js";

const frameworkRoot = fileURLToPath(new URL("..", import.meta.url));

test("cli adapter resolves a workspace-relative target through a declared launcher", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
    try {
        await bootstrapWorkspace(root);
        await mkdir(path.join(root, "tools"), { recursive: true });
        await writeFile(
            path.join(root, "tools", "echo.mjs"),
            `console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n`
        );
        await writeCapability(root, {
            manifestVersion: "axf/v0",
            id: "global.demo.echo",
            summary: "demo",
            provider: "demo",
            adapterType: "cli",
            executionTarget: {
                launcher: { command: process.execPath },
                target: {
                    path: "tools/echo.mjs",
                    relativeTo: "workspace"
                },
                args: ["seed"]
            },
            argsSchema: {
                type: "object",
                properties: { message: { type: "string" } }
            },
            outputModes: ["json"],
            sideEffects: "none",
            scope: "global",
            lifecycleState: "active",
            defaults: {},
            policies: [],
            owner: "test"
        });

        const registry = await createRegistry({ rootDir: root });
        const adapters = await loadAdapters({ rootDir: frameworkRoot });
        const resolved = resolveCapability(registry, ["demo", "echo"], {
            args: { message: "hello" }
        });
        const result = await executeResolvedCapability(resolved, {
            adapters,
            runtime: { workspace: { root, viaMarker: true, source: "explicit" } }
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.data, {
            argv: ["seed", "--message", "hello"]
        });
        assert.equal(result.meta.launchPlan.command, process.execPath);
        assert.equal(result.meta.launchPlan.targetPath, path.join(root, "tools", "echo.mjs"));
        assert.equal(result.meta.launchPlan.targetSource, "relative:workspace");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("cli adapter runs from the bound workspace for relative launcher args", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
    try {
        await bootstrapWorkspace(root);
        await mkdir(path.join(root, "tools"), { recursive: true });
        await writeFile(
            path.join(root, "tools", "launcher.mjs"),
            `console.log(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n`
        );
        await writeFile(path.join(root, "tools", "payload.mjs"), "// target placeholder\n");
        await writeCapability(root, {
            manifestVersion: "axf/v0",
            id: "global.demo.cwd",
            summary: "demo",
            provider: "demo",
            adapterType: "cli",
            executionTarget: {
                launcher: { command: process.execPath, args: ["tools/launcher.mjs"] },
                target: {
                    path: "tools/payload.mjs",
                    relativeTo: "workspace"
                }
            },
            argsSchema: { type: "object", properties: {} },
            outputModes: ["json"],
            sideEffects: "none",
            scope: "global",
            lifecycleState: "active",
            defaults: {},
            policies: [],
            owner: "test"
        });

        const registry = await createRegistry({ rootDir: root });
        const adapters = await loadAdapters({ rootDir: frameworkRoot });
        const resolved = resolveCapability(registry, ["demo", "cwd"], { args: {} });
        const result = await executeResolvedCapability(resolved, {
            adapters,
            runtime: { workspace: { root, viaMarker: true, source: "explicit" } }
        });

        assert.equal(result.ok, true);
        assert.equal(result.data.cwd, root);
        assert.deepEqual(result.data.argv, [path.join(root, "tools", "payload.mjs")]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("cli adapter resolves an env-bound target root with a workspace-relative fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
    const sibling = path.join(path.dirname(root), `${path.basename(root)}-managed`);
    const original = process.env.AX_TARGET_ROOT;
    try {
        await bootstrapWorkspace(root);
        await mkdir(path.join(sibling, "tools"), { recursive: true });
        await writeFile(
            path.join(sibling, "tools", "echo.mjs"),
            `console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n`
        );
        await writeCapability(root, {
            manifestVersion: "axf/v0",
            id: "global.demo.env",
            summary: "demo",
            provider: "demo",
            adapterType: "cli",
            executionTarget: {
                launcher: { command: process.execPath },
                target: {
                    path: "tools/echo.mjs",
                    fromEnv: "AX_TARGET_ROOT",
                    fallbackRoot: `../${path.basename(sibling)}`,
                    fallbackRelativeTo: "workspace"
                },
                args: ["probe"]
            },
            argsSchema: {
                type: "object",
                properties: { note: { type: "string" } }
            },
            outputModes: ["json"],
            sideEffects: "none",
            scope: "global",
            lifecycleState: "active",
            defaults: {},
            policies: [],
            owner: "test"
        });

        delete process.env.AX_TARGET_ROOT;

        const registry = await createRegistry({ rootDir: root });
        const adapters = await loadAdapters({ rootDir: frameworkRoot });
        const resolved = resolveCapability(registry, ["demo", "env"], {
            args: { note: "fallback" }
        });
        const result = await executeResolvedCapability(resolved, {
            adapters,
            runtime: { workspace: { root, viaMarker: true, source: "explicit" } }
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.data, {
            argv: ["probe", "--note", "fallback"]
        });
        assert.equal(result.meta.launchPlan.targetSource, "fallback:AX_TARGET_ROOT");

        process.env.AX_TARGET_ROOT = sibling;
        const envResult = await executeResolvedCapability(resolved, {
            adapters,
            runtime: { workspace: { root, viaMarker: true, source: "explicit" } }
        });
        assert.equal(envResult.ok, true);
        assert.equal(envResult.meta.launchPlan.targetSource, "env:AX_TARGET_ROOT");
    } finally {
        if (original === undefined) {
            delete process.env.AX_TARGET_ROOT;
        } else {
            process.env.AX_TARGET_ROOT = original;
        }
        await rm(root, { recursive: true, force: true });
        await rm(sibling, { recursive: true, force: true });
    }
});

test("inspect --json includes the resolved cli launch plan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-cli-launch-"));
    try {
        await bootstrapWorkspace(root);
        await writeCapability(root, {
            manifestVersion: "axf/v0",
            id: "global.demo.inspect",
            summary: "demo",
            provider: "demo",
            adapterType: "cli",
            executionTarget: {
                launcher: {
                    command: process.execPath,
                    args: ["--no-warnings"]
                },
                target: {
                    path: "tools/echo.mjs",
                    relativeTo: "workspace"
                }
            },
            argsSchema: { type: "object", properties: {} },
            outputModes: ["json"],
            sideEffects: "none",
            scope: "global",
            lifecycleState: "active",
            defaults: {},
            policies: [],
            owner: "test"
        });

        const out = await captureStdout(() =>
            main(["--workspace", root, "inspect", "demo", "inspect", "--json"])
        );
        const parsed = JSON.parse(out);

        assert.equal(parsed.launchPlan.command, process.execPath);
        assert.deepEqual(parsed.launchPlan.argsPrefix, [
            "--no-warnings",
            path.join(root, "tools", "echo.mjs")
        ]);
        assert.equal(parsed.launchPlan.targetPath, path.join(root, "tools", "echo.mjs"));
        assert.equal(parsed.launchPlan.targetSource, "relative:workspace");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

async function bootstrapWorkspace(root) {
    await writeFile(
        path.join(root, "axf.workspace.json"),
        JSON.stringify({ manifestVersion: "axf/v0", name: "fixture" })
    );
    await mkdir(path.join(root, "manifests", "capabilities"), { recursive: true });
}

async function writeCapability(root, capability) {
    await writeFile(
        path.join(root, "manifests", "capabilities", `${capability.id}.json`),
        JSON.stringify(capability, null, 2) + "\n"
    );
}

function captureStdout(fn) {
    const original = process.stdout.write.bind(process.stdout);
    const chunks = [];
    process.stdout.write = (chunk, ...rest) => {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
    };
    return Promise.resolve(fn())
        .finally(() => {
            process.stdout.write = original;
        })
        .then(() => chunks.join(""));
}