import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/core/registry.js";
import { inspectRegistry } from "../src/core/doctor.js";
import { loadAdapters } from "../src/core/adapter-loader.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("starter manifests pass strict load with no errors", async () => {
    const registry = await createRegistry({ rootDir });
    const adapters = await loadAdapters({ rootDir });
    const report = inspectRegistry(registry, { adapters });

    assert.equal(report.rejectedCount, 0);
    const errors = report.issues.filter((i) => i.severity === "error");
    assert.deepEqual(errors, []);
    // require_workspace_binding is now implemented, so it should NOT
    // surface as an unenforced-policy warning.
    const warnings = report.issues.filter((i) => i.severity === "warning");
    assert.ok(
        warnings.every((w) => !/require_workspace_binding/.test(w.message)),
        "require_workspace_binding should be implemented and not warned about"
    );
});

test("strict mode refuses to load a capability with an invalid manifestVersion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-strict-"));
    try {
        await mkdir(path.join(tmp, "manifests", "capabilities"), { recursive: true });
        await writeFile(
            path.join(tmp, "manifests", "capabilities", "global.bad.cap.json"),
            JSON.stringify({
                manifestVersion: "ax/v9",
                id: "global.bad.cap",
                summary: "bad",
                provider: "x",
                adapterType: "internal",
                executionTarget: { handler: "draft.todo" },
                argsSchema: { type: "object" },
                outputModes: ["json"],
                sideEffects: "none",
                scope: "global",
                lifecycleState: "active",
                defaults: {},
                policies: [],
                owner: "test"
            })
        );

        const registry = await createRegistry({ rootDir: tmp });
        assert.equal(registry.capabilities.size, 0);
        assert.equal(registry.rejected.length, 1);
        assert.ok(
            registry.loadIssues.some((i) => /unsupported manifestVersion/.test(i.message))
        );
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
});

test("strict mode refuses to load a capability with adapter/executionTarget mismatch", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-strict-"));
    try {
        await mkdir(path.join(tmp, "manifests", "capabilities"), { recursive: true });
        await writeFile(
            path.join(tmp, "manifests", "capabilities", "global.bad.cli.json"),
            JSON.stringify({
                manifestVersion: "axf/v0",
                id: "global.bad.cli",
                summary: "missing command",
                provider: "x",
                adapterType: "cli",
                executionTarget: {},
                argsSchema: { type: "object" },
                outputModes: ["json"],
                sideEffects: "none",
                scope: "global",
                lifecycleState: "active",
                defaults: {},
                policies: [],
                owner: "test"
            })
        );

        const registry = await createRegistry({ rootDir: tmp });
        assert.equal(registry.capabilities.size, 0);
        assert.ok(
            registry.loadIssues.some((i) =>
                /cli adapter requires executionTarget.command or executionTarget.target.path/.test(i.message)
            )
        );
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
});

test("strict mode refuses to load a cli capability with an invalid launcher shape", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-strict-"));
    try {
        await mkdir(path.join(tmp, "manifests", "capabilities"), { recursive: true });
        await writeFile(
            path.join(tmp, "manifests", "capabilities", "global.bad.launcher.json"),
            JSON.stringify({
                manifestVersion: "axf/v0",
                id: "global.bad.launcher",
                summary: "missing launcher command",
                provider: "x",
                adapterType: "cli",
                executionTarget: {
                    launcher: {},
                    target: { path: ".ax/ax.ps1", relativeTo: "workspace" }
                },
                argsSchema: { type: "object" },
                outputModes: ["json"],
                sideEffects: "none",
                scope: "global",
                lifecycleState: "active",
                defaults: {},
                policies: [],
                owner: "test"
            })
        );

        const registry = await createRegistry({ rootDir: tmp });
        assert.equal(registry.capabilities.size, 0);
        assert.ok(
            registry.loadIssues.some((i) =>
                /cli adapter executionTarget.launcher.command must be a string/.test(i.message)
            )
        );
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
});

test("strict mode refuses scope/id mismatch", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ax-strict-"));
    try {
        await mkdir(path.join(tmp, "manifests", "capabilities"), { recursive: true });
        await writeFile(
            path.join(tmp, "manifests", "capabilities", "bad.json"),
            JSON.stringify({
                manifestVersion: "axf/v0",
                id: "toolspace.x.echo.say",
                summary: "wrong scope",
                provider: "x",
                adapterType: "internal",
                executionTarget: { handler: "draft.todo" },
                argsSchema: { type: "object" },
                outputModes: ["json"],
                sideEffects: "none",
                scope: "global",
                lifecycleState: "active",
                defaults: {},
                policies: [],
                owner: "test"
            })
        );

        const registry = await createRegistry({ rootDir: tmp });
        assert.equal(registry.capabilities.size, 0);
        assert.ok(
            registry.loadIssues.some((i) => /scope=global but id starts with/.test(i.message))
        );
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
});
