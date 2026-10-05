import { describe, expect, test } from "bun:test";

import { colorizeTerminalLine } from "../src/renderer/color.ts";

describe("contextual terminal color", () => {
  test("colors progress marks and numeric values with the canvas accent", () => {
    const segments = colorizeTerminalLine("[===========-----] 83%");

    expect(segments.some((segment) => segment.text.includes("===========") && segment.color === "cyan")).toBe(true);
    expect(segments.some((segment) => segment.text === "83%" && segment.color === "cyan" && segment.bold)).toBe(true);
  });

  test("uses semantic colors for explicit operational states", () => {
    expect(colorizeTerminalLine("name: sandbox  status: passed").at(-1)).toMatchObject({
      text: "passed",
      color: "green",
      bold: true,
    });
    expect(colorizeTerminalLine("name: trusted input  status: waiting").at(-1)).toMatchObject({
      text: "waiting",
      color: "yellow",
      bold: true,
    });
    expect(colorizeTerminalLine("status: failed").at(-1)).toMatchObject({
      text: "failed",
      color: "red",
      bold: true,
    });
  });

  test("mutes metadata keys while leaving their values readable", () => {
    const segments = colorizeTerminalLine("step: 5  activity: Confirming sandbox health");

    expect(segments.filter((segment) => segment.dimColor).map((segment) => segment.text)).toEqual(["step:", "activity:"]);
    expect(segments.some((segment) => segment.text === "5" && segment.color === "cyan")).toBe(true);
  });

  test("colors framed titles without making the whole border loud", () => {
    const segments = colorizeTerminalLine("+ Verification ----------------+");

    expect(segments[0]).toMatchObject({ text: "+ ", dimColor: true });
    expect(segments[1]).toMatchObject({ text: "Verification", color: "cyan", bold: true });
    expect(segments[2]).toMatchObject({ text: " ----------------+", dimColor: true });
  });

  test("keeps ordinary prose neutral", () => {
    expect(colorizeTerminalLine("Confirming the sandbox remains healthy")).toEqual([
      { text: "Confirming the sandbox remains ", color: undefined, bold: undefined, dimColor: undefined },
      { text: "healthy", color: "green", bold: true, dimColor: undefined },
    ]);
  });
});
