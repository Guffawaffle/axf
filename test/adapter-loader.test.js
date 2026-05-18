import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAdapters } from "../src/core/adapter-loader.js";
import { executeResolvedCapability } from "../src/core/executor.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("loads built-in internal and cli type adapters", async () => {
    const adapters = await loadAdapters({ rootDir });
    assert.ok(adapters.get("internal"));
    assert.ok(adapters.get("cli"));
    assert.equal(typeof adapters.get("internal").execute, "function");
    assert.equal(typeof adapters.get("cli").execute, "function");
});

test("loads the majel provider adapter alongside type adapters", async () => {
    const adapters = await loadAdapters({ rootDir });
    const majel = adapters.getProvider("majel");
    assert.ok(majel, "majel provider adapter should be discovered");
    assert.equal(majel.manifest.kind, "provider");
    assert.equal(majel.manifest.composes, "cli");
});

test("internal adapter runs the echo.say handler", async () => {
    const adapters = await loadAdapters({ rootDir });
    const adapter = adapters.get("internal");
    const result = await adapter.execute({
        capability: {
            id: "global.echo.say",
            executionTarget: { handler: "echo.say" }
        },
        args: { message: "hi" }
    });
    assert.equal(result.ok, true);
    assert.equal(result.data, "hi");
});

test("internal adapter rejects unknown handlers", async () => {
    const adapters = await loadAdapters({ rootDir });
    const adapter = adapters.get("internal");
    await assert.rejects(
        () =>
            adapter.execute({
                capability: {
                    id: "global.bogus",
                    executionTarget: { handler: "no.such.handler" }
                },
                args: {}
            }),
        /unknown internal handler/
    );
});

test("executor composes provider adapter over type adapter", async () => {
    // Build a tiny tmp workspace with a fake type adapter that returns
    // a Majel-shaped envelope, and the real majel provider adapter
    // lifted in by symlink-style copy.
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-provider-"));
    const adaptersDir = path.join(root, "adapters");

    // type adapter: echoes a Majel envelope
    const typeDir = path.join(adaptersDir, "fake");
    await mkdir(typeDir, { recursive: true });
    await writeFile(
        path.join(typeDir, "adapter.manifest.json"),
        JSON.stringify({
            manifestVersion: "axf/v0",
            kind: "type-adapter",
            type: "fake",
            entry: "index.js",
            lifecycleState: "active"
        })
    );
    await writeFile(
        path.join(typeDir, "index.js"),
        `export async function execute(resolved) {
            return {
                ok: true,
                data: { command: "fake:ok", success: true, durationMs: 1, data: { v: 42 } },
                meta: { capabilityId: resolved.capability.id, adapterType: "fake" }
            };
        }`
    );

    // provider adapter: composes "fake", asserts envelope-aware mapping
    const provDir = path.join(adaptersDir, "envelope");
    await mkdir(provDir, { recursive: true });
    await writeFile(
        path.join(provDir, "adapter.manifest.json"),
        JSON.stringify({
            manifestVersion: "axf/v0",
            kind: "provider",
            name: "envelope",
            composes: "fake",
            entry: "index.js",
            lifecycleState: "active"
        })
    );
    await writeFile(
        path.join(provDir, "index.js"),
        `export async function execute(resolved, ctx) {
            const upstream = await ctx.typeAdapter.execute(resolved);
            if (!upstream.ok) return upstream;
            return { ok: true, data: upstream.data.data, meta: { ...upstream.meta, unwrapped: true } };
        }`
    );

    const adapters = await loadAdapters({ rootDir: root });
    const result = await executeResolvedCapability(
        {
            capability: {
                id: "global.fake.thing",
                adapterType: "fake",
                providerAdapter: "envelope",
                policies: []
            },
            args: {}
        },
        { adapters }
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { v: 42 });
    assert.equal(result.meta.unwrapped, true);
    assert.equal(result.meta.providerAdapter, "envelope");
});

test("executor refuses provider whose 'composes' disagrees with capability adapterType", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-provider-mismatch-"));
    const adaptersDir = path.join(root, "adapters");

    const typeDir = path.join(adaptersDir, "fake");
    await mkdir(typeDir, { recursive: true });
    await writeFile(
        path.join(typeDir, "adapter.manifest.json"),
        JSON.stringify({
            manifestVersion: "axf/v0",
            kind: "type-adapter",
            type: "fake",
            entry: "index.js",
            lifecycleState: "active"
        })
    );
    await writeFile(
        path.join(typeDir, "index.js"),
        `export async function execute() { return { ok: true, data: null, meta: {} }; }`
    );

    const provDir = path.join(adaptersDir, "wrongprov");
    await mkdir(provDir, { recursive: true });
    await writeFile(
        path.join(provDir, "adapter.manifest.json"),
        JSON.stringify({
            manifestVersion: "axf/v0",
            kind: "provider",
            name: "wrongprov",
            composes: "fake",
            entry: "index.js",
            lifecycleState: "active"
        })
    );
    await writeFile(
        path.join(provDir, "index.js"),
        `export async function execute() { return { ok: true, data: null, meta: {} }; }`
    );

    // Also need an "other" type adapter so the executor finds *something*
    // for the capability's adapterType, then trips on the composes mismatch.
    const otherDir = path.join(adaptersDir, "other");
    await mkdir(otherDir, { recursive: true });
    await writeFile(
        path.join(otherDir, "adapter.manifest.json"),
        JSON.stringify({
            manifestVersion: "axf/v0",
            kind: "type-adapter",
            type: "other",
            entry: "index.js",
            lifecycleState: "active"
        })
    );
    await writeFile(
        path.join(otherDir, "index.js"),
        `export async function execute() { return { ok: true, data: null, meta: {} }; }`
    );

    const adapters = await loadAdapters({ rootDir: root });
    await assert.rejects(
        () =>
            executeResolvedCapability(
                {
                    capability: {
                        id: "global.x.y",
                        adapterType: "other",
                        providerAdapter: "wrongprov",
                        policies: []
                    },
                    args: {}
                },
                { adapters }
            ),
        /composes 'fake' but .* uses adapterType 'other'/
    );
});
