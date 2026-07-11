import test from "node:test";
import assert from "node:assert/strict";
import { composeSessionContext } from "../templates/session-context/scripts/axf/session-context.mjs";

function fakeRunner(command, args) {
  if (command === "git") return { status: 0, stdout: "feature/continuity\n", stderr: "" };
  if (String(command).includes("axf")) {
    assert.ok(args.includes("--project-root"));
    assert.ok(args.includes("--execution-root"));
    return {
      status: 0,
      stdout: JSON.stringify({ intent: "session-start", recommendations: [{ id: "workspace.check" }] }),
      stderr: "",
    };
  }
  if (String(command).includes("lex")) {
    return {
      status: 0,
      stdout: JSON.stringify({
        safety: { contentTrust: "untrusted-historical-data" },
        frames: [{ id: "frame-1", summary: "Prior work", nextAction: "Continue" }],
      }),
      stderr: "",
    };
  }
  return { status: 1, stdout: "", stderr: "unexpected command" };
}

test("session-context template composes explicit-root AXF guidance and bounded Lex context", () => {
  const result = composeSessionContext(
    {
      intent: "continue dogfooding",
      projectRoot: "/repo",
      executionRoot: "/repo",
      maxOutputChars: 4000,
    },
    fakeRunner,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.components, { axf: true, lex: true });
  assert.match(result.text, /untrusted historical evidence/);
  assert.match(result.text, /continue dogfooding/);
  assert.match(result.text, /workspace\.check/);
  assert.match(result.text, /frame-1/);
  assert.ok(result.budget.outputChars <= result.budget.maxOutputChars);
});

test("session-context template degrades cleanly when Lex is unavailable", () => {
  const result = composeSessionContext(
    { projectRoot: "/repo", executionRoot: "/repo", maxOutputChars: 4000 },
    (command) => {
      if (command === "git") return { status: 0, stdout: "main\n", stderr: "" };
      if (String(command).includes("axf")) {
        return { status: 0, stdout: JSON.stringify({ recommendations: [] }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "lex not found" };
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.components, { axf: true, lex: false });
  assert.ok(result.warnings.some((warning) => warning.includes("Lex context unavailable")));
});
