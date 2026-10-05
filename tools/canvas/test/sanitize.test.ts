import { describe, expect, test } from "bun:test";

import { sanitizeText, sanitizeValue } from "../src/security/sanitize.ts";

describe("terminal text sanitization", () => {
  test("removes CSI, OSC, and disallowed control characters", () => {
    const input = "safe\u001b[31m red\u001b[0m\u001b]8;;https://evil.test\u0007link\u001b]8;;\u0007\u0000end";

    expect(sanitizeText(input)).toBe("safe redlinkend");
  });

  test("preserves ordinary Unicode, newlines, and tabs", () => {
    expect(sanitizeText("café 漢字\n\tready")).toBe("café 漢字\n\tready");
  });

  test("sanitizes every nested string without changing non-string JSON values", () => {
    expect(
      sanitizeValue({
        title: "\u001b[2JBuild",
        rows: ["ok", { detail: "bad\u0007bell", count: 2, active: true }],
      }),
    ).toEqual({
      title: "Build",
      rows: ["ok", { detail: "badbell", count: 2, active: true }],
    });
  });
});
