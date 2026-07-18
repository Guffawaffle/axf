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

for (const { label, input, expected } of [
  {
    label: "password JSON members",
    input: 'provider failed: {"password":"hunter2"}',
    expected: 'provider failed: {"password":"[REDACTED]"}',
  },
  {
    label: "secret access key JSON members",
    input: '{"secretAccessKey":"cloud-secret"}',
    expected: '{"secretAccessKey":"[REDACTED]"}',
  },
  {
    label: "API key headers",
    input: "X-API-Key: abc123",
    expected: "X-API-Key: [REDACTED]",
  },
  {
    label: "credential headers in multiline excerpts",
    input: "provider response\nAuthorization: Custom abc123\nstatus: denied",
    expected:
      "provider response\nAuthorization: [REDACTED]\nstatus: denied",
  },
]) {
  test(`redacts embedded ${label} without a structured secret field`, () => {
    const projected = {
      ok: false,
      operation: "run",
      error: { message: input },
    };

    const redacted = redactMcpResponse(projected);

    assert.equal(redacted.error.message, expected);
  });
}

test("does not treat ordinary colon-delimited prose as a secret", () => {
  const message = "provider rejected request: password: required; token: missing";

  const redacted = redactMcpResponse({
    ok: false,
    operation: "run",
    error: { message },
  });

  assert.equal(redacted.error.message, message);
});

test("preserves embedded secrets in capability-owned top-level data", () => {
  const data = {
    message: 'provider failed: {"password":"hunter2"}',
    headers: "X-API-Key: abc123",
  };

  const redacted = redactMcpResponse({
    ok: false,
    operation: "run",
    data,
    error: { message: data.message },
  });

  assert.equal(redacted.data, data);
  assert.equal(
    redacted.error.message,
    'provider failed: {"password":"[REDACTED]"}',
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
