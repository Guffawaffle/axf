import test from "node:test";
import assert from "node:assert/strict";
import { redactMcpResponse } from "../src/mcp/redaction.js";

test("redacts connection-string passwords without a structured secret field", () => {
  const projected = {
    ok: false,
    operation: "doctor",
    meta: {
      detail: "Host=db;Password=pw;Username=agent",
    },
  };

  const redacted = redactMcpResponse(projected);

  assert.equal(
    redacted.meta.detail,
    "Host=db;Password=[REDACTED];Username=agent",
  );
});

test("redacts quoted connection-string passwords as one value", () => {
  const projected = {
    ok: false,
    operation: "doctor",
    meta: {
      detail: 'Host=db;Password="short phrase";Username=agent',
    },
  };

  const redacted = redactMcpResponse(projected);

  assert.equal(
    redacted.meta.detail,
    "Host=db;Password=[REDACTED];Username=agent",
  );
});

for (const { field, secret } of [
  { field: "secretAccessKey", secret: "xy" },
  { field: "passphrase", secret: "q" },
  { field: "connection", secret: "db" },
  { field: "pwd", secret: "abc" },
]) {
  test(`redacts and propagates short ${field} values`, () => {
    const projected = {
      ok: false,
      operation: "run",
      args: { [field]: secret },
      meta: {
        argv: [`--${field}`, secret],
        message: `provider rejected value ${secret}`,
      },
    };

    const redacted = redactMcpResponse(projected);

    assert.equal(redacted.args[field], "[REDACTED]");
    assert.equal(redacted.meta.argv[1], "[REDACTED]");
    assert.equal(
      redacted.meta.message,
      "provider rejected value [REDACTED]",
    );
  });
}
