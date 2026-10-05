import { describe, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import React from "react";

import { CanvasApp } from "../src/renderer/app.tsx";
import type { TreeNode } from "../src/protocol/tree.ts";
import {
  contentViewportHeight,
  canvasTerminalWidth,
  decisionCardHeight,
  decisionOptionText,
  documentViewportWidth,
  focusSummary,
  trustedHeaderRows,
  statusPresentation,
} from "../src/renderer/presentation.ts";

const stripAnsi = (value: string): string => value.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");

const createCanvasRender = (node: React.ReactNode, columns = 60, rows = 24) => {
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = columns;
  stdout.rows = rows;
  stdout.isTTY = true;
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (value: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => undefined;
  stdin.ref = () => undefined;
  stdin.unref = () => undefined;
  let output = "";
  let chunks: string[] = [];
  stdout.on("data", (chunk) => {
    const value = String(chunk);
    output += value;
    chunks.push(value);
  });
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
  });
  return {
    instance,
    stdin,
    stdout,
    read: () => stripAnsi(output),
    readLatest: () => stripAnsi(chunks.at(-1) ?? ""),
    reset: () => { output = ""; chunks = []; },
  };
};

const renderCanvas = async (node: React.ReactNode, columns = 60, rows = 24): Promise<string> => {
  const harness = createCanvasRender(node, columns, rows);
  await Bun.sleep(20);
  const output = harness.read();
  harness.instance.unmount();
  return output;
};

const manyLines = (count: number): TreeNode => ({
  type: "div",
  props: {},
  children: [Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")],
});

describe("canvas renderer presentation", () => {
  test("reserves terminal rows for chrome and trusted decisions", () => {
    expect(contentViewportHeight(24, {
      hasDiagnostic: true,
      decisionRows: 10,
      hasControls: true,
    })).toBe(10);
    expect(contentViewportHeight(4, {
      hasDiagnostic: true,
      decisionRows: 10,
      hasControls: true,
    })).toBe(0);
  });

  test("measures a wrapped trusted decision at the current terminal width", () => {
    expect(decisionCardHeight(
      "The live-update pressure test reached its decision point. Continue to final verification?",
      ["Continue", "Stop"],
      31,
    )).toBe(10);
  });

  test("accounts for document padding before formatting terminal lines", () => {
    expect(documentViewportWidth(60)).toBe(58);
    expect(documentViewportWidth(8)).toBe(8);
  });

  test("uses the real narrow terminal width and stacks trusted header content", () => {
    expect(canvasTerminalWidth(14)).toBe(14);
    expect(trustedHeaderRows(14)).toBe(4);
    expect(trustedHeaderRows(60)).toBe(3);
  });

  test("status uses a visible symbol and label instead of color alone", () => {
    expect(statusPresentation("connected")).toEqual({ symbol: "●", label: "CONNECTED", color: "green" });
    expect(statusPresentation("diagnostic")).toEqual({ symbol: "▲", label: "DIAGNOSTIC", color: "yellow" });
    expect(statusPresentation("disconnected")).toEqual({ symbol: "×", label: "DISCONNECTED", color: "red" });
  });

  test("trusted decision choices expose selection and keyboard position", () => {
    expect(decisionOptionText("Ship", 0, 0)).toBe("▶ 1  Ship");
    expect(decisionOptionText("Hold", 1, 0)).toBe("  2  Hold");
    expect(decisionOptionText("\u001b[2JUnsafe", 0, 0)).toBe("▶ 1  Unsafe");
  });

  test("focus summary identifies the active document control", () => {
    expect(focusSummary([], 0)).toBeUndefined();
    expect(focusSummary(["Retry", "Details", "Open logs"], 1)).toBe("FOCUS 2/3  Details");
  });

  test("renders an operations header and a clearly separated trusted decision", async () => {
    const output = await renderCanvas(
      React.createElement(CanvasApp, {
        status: "connected",
        decision: {
          id: "ship",
          prompt: "Continue with deployment?",
          options: ["Continue", "Hold"],
          onChoose: () => undefined,
        },
      }),
    );

    expect(output).toContain("HERDR / CANVAS");
    expect(output).toContain("● CONNECTED");
    expect(output).toContain("ACTION REQUIRED");
    expect(output).toContain("▶ 1  Continue");
    expect(output).toContain("←/→ choose");
  });

  test("submits the newly selected choice when arrow and Enter arrive back-to-back", async () => {
    const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
    stdout.columns = 60;
    stdout.rows = 24;
    stdout.isTTY = true;
    const stdin = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (value: boolean) => void;
      ref: () => void;
      unref: () => void;
    };
    stdin.isTTY = true;
    stdin.setRawMode = () => undefined;
    stdin.ref = () => undefined;
    stdin.unref = () => undefined;
    let chosen: string | undefined;
    const instance = render(React.createElement(CanvasApp, {
      status: "connected",
      decision: {
        id: "ship",
        prompt: "Continue?",
        options: ["Ship", "Hold"],
        onChoose: (_requestId, value) => {
          chosen = value;
        },
      },
    }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    });
    await Bun.sleep(20);

    stdin.write("\u001b[C\r");
    await Bun.sleep(20);
    instance.unmount();

    expect(chosen).toBe("Hold");
  });

  test("keeps all rendered chrome within a narrow terminal height", async () => {
    const output = await renderCanvas(React.createElement(CanvasApp, {
      status: "diagnostic",
      diagnostic: "A long diagnostic message that wraps across narrow terminal rows",
      tree: manyLines(50),
      onEvent: () => undefined,
    }), 31, 24);

    expect(output.trimEnd().split("\n").length).toBeLessThanOrEqual(24);
  });

  test("recomputes header mode and viewport when the terminal resizes", async () => {
    const harness = createCanvasRender(React.createElement(CanvasApp, {
      status: "connected",
      tree: manyLines(50),
    }), 31, 24);
    await Bun.sleep(20);
    harness.reset();

    harness.stdout.columns = 60;
    harness.stdout.rows = 40;
    harness.stdout.emit("resize");
    await Bun.sleep(20);
    const output = harness.read();
    harness.instance.unmount();

    expect(output.split("\n").some((line) => line.includes("HERDR / CANVAS") && line.includes("CONNECTED"))).toBe(true);
    expect(output).toContain("line 30");
  });

  test("scrolls a full viewport with Page Down and Page Up", async () => {
    const harness = createCanvasRender(React.createElement(CanvasApp, {
      status: "connected",
      tree: manyLines(50),
    }), 60, 16);
    await Bun.sleep(20);
    expect(harness.readLatest()).toContain("line 1");
    harness.reset();

    harness.stdin.write("\u001b[6~");
    await Bun.sleep(20);
    expect(harness.readLatest()).not.toContain("line 1\n");
    expect(harness.readLatest()).toContain("line 13");
    harness.reset();

    harness.stdin.write("\u001b[5~");
    await Bun.sleep(20);
    const output = harness.readLatest();
    harness.instance.unmount();

    expect(output).toContain("line 1");
    expect(output).toContain("PgUp/PgDn");
  });

  test("does not activate a newly streamed control while the displayed tree is paused", async () => {
    const first: TreeNode = {
      type: "button",
      props: { onClick: { $type: "callback", id: "a", generation: 1, revision: 1 } },
      children: ["Safe A"],
    };
    const second: TreeNode = {
      type: "button",
      props: { onClick: { $type: "callback", id: "b", generation: 1, revision: 2 } },
      children: ["Changed B"],
    };
    const fired: string[] = [];
    const harness = createCanvasRender(React.createElement(CanvasApp, {
      status: "connected",
      tree: first,
      onEvent: (handle) => fired.push(handle.id),
    }));
    await Bun.sleep(20);
    harness.stdin.write("p");
    await Bun.sleep(10);
    harness.instance.rerender(React.createElement(CanvasApp, {
      status: "connected",
      tree: second,
      onEvent: (handle) => fired.push(handle.id),
    }));
    await Bun.sleep(20);

    harness.stdin.write("\r");
    await Bun.sleep(20);
    const output = harness.read();
    harness.instance.unmount();

    expect(output).toContain("Safe A");
    expect(fired).toEqual([]);
  });

  test("bounds long trusted decisions and keeps the selected option visible", async () => {
    const options = Array.from({ length: 12 }, (_, index) => `Choice ${index + 1} with explanatory text`);
    const harness = createCanvasRender(React.createElement(CanvasApp, {
      status: "connected",
      decision: {
        id: "long",
        prompt: "Review this detailed prompt ".repeat(20),
        options,
        onChoose: () => undefined,
      },
    }), 31, 12);
    await Bun.sleep(20);
    expect(harness.readLatest().trimEnd().split("\n").length).toBeLessThanOrEqual(12);
    expect(harness.readLatest()).not.toContain("Choice 12");
    harness.reset();

    for (let index = 0; index < 11; index += 1) harness.stdin.write("\u001b[C");
    await Bun.sleep(30);
    const output = harness.readLatest();
    harness.instance.unmount();

    expect(output).toContain("Choice 12");
    expect(output.trimEnd().split("\n").length).toBeLessThanOrEqual(12);
  });

  test("allows inspecting the beginning of a long decision prompt after selection-following", async () => {
    const prompt = Array.from({ length: 15 }, (_, index) => `Prompt ${index + 1}`).join("\n");
    const renderDecision = (tree?: TreeNode) => React.createElement(CanvasApp, {
      status: "connected" as const,
      decision: { id: "inspect", prompt, options: ["Yes", "No"], onChoose: () => undefined },
      ...(tree === undefined ? {} : { tree }),
    });
    const harness = createCanvasRender(renderDecision(), 31, 12);
    await Bun.sleep(20);
    harness.reset();

    for (let index = 0; index < 4; index += 1) {
      harness.stdin.write("\u001b[A");
      await Bun.sleep(10);
    }
    expect(harness.readLatest()).toContain("Prompt 9");
    harness.reset();
    harness.instance.rerender(renderDecision({ type: "p", props: {}, children: ["live update"] }));
    await Bun.sleep(20);
    const output = harness.readLatest();
    harness.instance.unmount();

    expect(output).toContain("Prompt 9");
    expect(output).not.toContain("▶ 1  Yes");
  });

  test("caps oversized diagnostics and focus labels while preserving decision choices", async () => {
    const longText = "trusted diagnostic detail ".repeat(80);
    const decisionOutput = await renderCanvas(React.createElement(CanvasApp, {
      status: "diagnostic",
      diagnostic: longText,
      decision: { id: "bounded", prompt: "Continue?", options: ["Yes", "No"], onChoose: () => undefined },
    }), 31, 24);
    expect(decisionOutput.trimEnd().split("\n").length).toBeLessThanOrEqual(24);
    expect(decisionOutput).toContain("▶ 1  Yes");

    const focusOutput = await renderCanvas(React.createElement(CanvasApp, {
      status: "connected",
      tree: {
        type: "button",
        props: { onClick: { $type: "callback", id: "long", generation: 1, revision: 1 } },
        children: [longText],
      },
      onEvent: () => undefined,
    }), 31, 24);
    expect(focusOutput.trimEnd().split("\n").length).toBeLessThanOrEqual(24);
    expect(focusOutput).toContain("FOCUS 1/1");
  });
});
