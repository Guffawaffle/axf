import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repoRoot = new URL("..", import.meta.url);

test("npm and MCP Registry metadata publish the same AXF version", async () => {
  const [packageJson, serverJson] = await Promise.all([
    readJson("package.json"),
    readJson("server.json"),
  ]);
  const [serverPackage] = serverJson.packages;

  assert.equal(serverJson.name, "dev.smartergpt/axf");
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(serverPackage.identifier, packageJson.name);
  assert.equal(serverPackage.version, packageJson.version);
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repoRoot), "utf8"));
}
