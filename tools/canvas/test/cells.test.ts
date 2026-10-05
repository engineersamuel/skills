import { describe, expect, test } from "bun:test";

import { cellWidth, wrapCells } from "../src/renderer/cells.ts";

describe("terminal cell wrapping", () => {
  test("prefers word boundaries when a phrase fits as whole words", () => {
    expect(wrapCells("verification complete", 17)).toEqual(["verification", "complete"]);
  });

  test("splits a token only when the token itself exceeds the width", () => {
    expect(wrapCells("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("keeps every Unicode line within the requested display cells", () => {
    const lines = wrapCells("界🙂 status complete", 8);
    expect(lines).toEqual(["界🙂", "status", "complete"]);
    expect(lines.every((line) => cellWidth(line) <= 8)).toBe(true);
  });
});
