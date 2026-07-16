import test from "node:test";
import assert from "node:assert/strict";
import {
    parseOptionTokens,
    splitCommandTokens,
    splitRunTokens
} from "../src/cli/options.js";

test("parses --key value pairs as strings by default", () => {
    const { options } = parseOptionTokens(["--name", "alice", "--count", "5"]);
    assert.deepEqual(options, { name: "alice", count: "5" });
});

test("does not coerce numeric strings (schema owns coercion)", () => {
    const { options } = parseOptionTokens(["--limit", "42"]);
    assert.equal(options.limit, "42");
});

test("only literal true/false coerce to booleans", () => {
    const { options } = parseOptionTokens([
        "--a",
        "true",
        "--b=false",
        "--c",
        "yes"
    ]);
    assert.equal(options.a, true);
    assert.equal(options.b, false);
    assert.equal(options.c, "yes");
});

test("bare flags become true", () => {
    const { options } = parseOptionTokens(["--verbose", "--name", "x"]);
    assert.equal(options.verbose, true);
    assert.equal(options.name, "x");
});

test("--key=value form works", () => {
    const { options } = parseOptionTokens(["--name=alice", "--count=5"]);
    assert.deepEqual(options, { name: "alice", count: "5" });
});

test("splitCommandTokens splits at first --flag", () => {
    const { pathTokens, options } = splitCommandTokens([
        "echo",
        "say",
        "--message",
        "hi"
    ]);
    assert.deepEqual(pathTokens, ["echo", "say"]);
    assert.deepEqual(options, { message: "hi" });
});

test("empty option name throws", () => {
    assert.throws(() => parseOptionTokens(["--", "x"]), /empty option name/);
});

test("splitRunTokens separates framework controls from capability arguments", () => {
    const parsed = splitRunTokens([
        "demo",
        "query",
        "--axf-json",
        "--",
        "--json",
        "--limit",
        "20"
    ]);

    assert.deepEqual(parsed, {
        pathTokens: ["demo", "query"],
        frameworkOptions: { "axf-json": true },
        boundaryOptions: { json: true, limit: "20" },
        hasBoundary: true
    });
});

test("splitRunTokens preserves legacy no-boundary options", () => {
    const parsed = splitRunTokens(["demo", "query", "--limit", "20"]);
    assert.deepEqual(parsed, {
        pathTokens: ["demo", "query"],
        frameworkOptions: { limit: "20" },
        boundaryOptions: {},
        hasBoundary: false
    });
});

test("splitRunTokens rejects multiple boundaries and positional capability args", () => {
    assert.throws(
        () => splitRunTokens(["demo", "query", "--", "--", "--limit", "2"]),
        /at most one/
    );
    assert.throws(
        () => splitRunTokens(["demo", "query", "--", "limit", "2"]),
        /must use --name value form/
    );
});

test("explicit run sections reject internal duplicates but may reuse a name across ownership", () => {
    assert.throws(
        () => splitRunTokens([
            "demo",
            "query",
            "--",
            "--limit",
            "2",
            "--limit",
            "3"
        ]),
        /more than once in the same argument section/
    );

    const parsed = splitRunTokens([
        "demo",
        "query",
        "--json",
        "--",
        "--json"
    ]);
    assert.deepEqual(parsed.frameworkOptions, { json: true });
    assert.deepEqual(parsed.boundaryOptions, { json: true });
});
