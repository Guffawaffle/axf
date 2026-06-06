import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    findExecutionWorkspaceRoot,
    findWorkspaceRoot,
    WORKSPACE_MARKER,
} from "../src/core/workspace.js";

async function tmpWorkspace() {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-ws-"));
    await writeFile(
        path.join(root, WORKSPACE_MARKER),
        JSON.stringify({ manifestVersion: "axf/v0", name: "fixture", summary: "test" })
    );
    return root;
}

test("explicit --workspace wins over everything", async () => {
    const root = await tmpWorkspace();
    const ws = findWorkspaceRoot({
        cwd: "/some/other/place",
        env: { AXF_WORKSPACE: "/elsewhere" },
        explicit: root
    });
    assert.equal(ws.root, root);
    assert.equal(ws.source, "explicit");
    assert.equal(ws.viaMarker, true);
});

test("AXF_WORKSPACE wins over marker walks", async () => {
    const root = await tmpWorkspace();
    const ws = findWorkspaceRoot({
        cwd: "/no/marker/here",
        env: { AXF_WORKSPACE: root }
    });
    assert.equal(ws.root, root);
    assert.equal(ws.source, "env");
    assert.equal(ws.viaMarker, true);
});

test("AXF_PROJECT_ROOT and AXF_EXECUTION_ROOT drive split root env resolution", async () => {
    const projectRoot = await tmpWorkspace();
    const executionRoot = await mkdtemp(path.join(os.tmpdir(), "ax-exec-root-"));

    const discoveredProjectRoot = findWorkspaceRoot({
        cwd: "/no/marker/here",
        env: {
            AXF_PROJECT_ROOT: projectRoot,
            AXF_EXECUTION_ROOT: executionRoot,
        }
    });
    const discoveredExecutionRoot = findExecutionWorkspaceRoot({
        cwd: "/no/marker/here",
        env: {
            AXF_PROJECT_ROOT: projectRoot,
            AXF_EXECUTION_ROOT: executionRoot,
        }
    });

    assert.equal(discoveredProjectRoot.root, projectRoot);
    assert.equal(discoveredProjectRoot.source, "env");
    assert.equal(discoveredExecutionRoot.root, executionRoot);
    assert.equal(discoveredExecutionRoot.source, "env");
    assert.equal(discoveredExecutionRoot.viaMarker, false);
});

test("walks ancestors of cwd to find marker file", async () => {
    const root = await tmpWorkspace();
    await mkdir(path.join(root, "deep", "nested", "child"), { recursive: true });
    const ws = findWorkspaceRoot({
        cwd: path.join(root, "deep", "nested", "child"),
        env: {}
    });
    assert.equal(ws.root, root);
    assert.equal(ws.source, "cwd-marker");
    assert.equal(ws.viaMarker, true);
});

test("falls back to cwd when no marker is found and no scriptDir is set", () => {
    const cwd = os.tmpdir();
    const ws = findWorkspaceRoot({ cwd, env: {}, scriptDir: null });
    assert.equal(ws.root, path.resolve(cwd));
    assert.equal(ws.source, "cwd-fallback");
    assert.equal(ws.viaMarker, false);
});

test("uses scriptDir as a secondary marker walk root", async () => {
    const root = await tmpWorkspace();
    const ws = findWorkspaceRoot({
        cwd: "/no/marker/up/from/here",
        env: {},
        scriptDir: path.join(root, "bin")
    });
    assert.equal(ws.root, root);
    assert.equal(ws.source, "script-marker");
    assert.equal(ws.viaMarker, true);
});

test("explicit path that lacks a marker reports viaMarker false", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-no-marker-"));
    const ws = findWorkspaceRoot({ cwd: "/", env: {}, explicit: dir });
    assert.equal(ws.root, dir);
    assert.equal(ws.source, "explicit");
    assert.equal(ws.viaMarker, false);
});
