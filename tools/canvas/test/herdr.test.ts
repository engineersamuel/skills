import { describe, expect, test } from "bun:test";

import { HerdrCanvasOwner, type CommandResult } from "../src/broker/herdr.ts";

const paneList = (panes: unknown[]) =>
  JSON.stringify({ id: "cli:pane:list", result: { panes }, type: "pane_list" });

describe("Herdr canvas ownership", () => {
  test("opens a right pane with the existing-left ratio and no focus change", async () => {
    const calls: (readonly string[])[] = [];
    const responses: CommandResult[] = [
      {
        exitCode: 0,
        stdout: paneList([
          { pane_id: "parent", tab_id: "tab", cwd: "/repo", focused: true },
        ]),
        stderr: "",
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({ result: { pane: { pane_id: "canvas", tab_id: "tab", cwd: "/repo" } } }),
        stderr: "",
      },
      { exitCode: 0, stdout: "", stderr: "" },
    ];
    const owner = new HerdrCanvasOwner(async (args) => {
      calls.push(args);
      return responses.shift()!;
    }, "/repo");

    await owner.open(["bun", "/runtime/renderer.js"]);

    expect(calls).toEqual([
      ["pane", "list"],
      ["pane", "split", "parent", "--direction", "right", "--ratio", "0.60", "--no-focus", "--cwd", "/repo"],
      ["pane", "run", "canvas", "bun /runtime/renderer.js"],
    ]);
  });

  test("anchors the canvas to the inherited agent pane when another workspace is focused", async () => {
    const calls: (readonly string[])[] = [];
    const responses: CommandResult[] = [
      {
        exitCode: 0,
        stdout: paneList([
          { pane_id: "agent", tab_id: "agent-tab", cwd: "/repo", focused: false },
          { pane_id: "elsewhere", tab_id: "other-tab", cwd: "/other", focused: true },
        ]),
        stderr: "",
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({ result: { pane: { pane_id: "canvas", tab_id: "agent-tab", cwd: "/repo" } } }),
        stderr: "",
      },
      { exitCode: 0, stdout: "", stderr: "" },
    ];
    const owner = new HerdrCanvasOwner(async (args) => {
      calls.push(args);
      return responses.shift()!;
    }, "/repo", "agent");

    await owner.open(["renderer"]);

    expect(calls[1]).toEqual([
      "pane", "split", "agent", "--direction", "right", "--ratio", "0.60", "--no-focus", "--cwd", "/repo",
    ]);
  });

  test("reuses only the pane it created and explicitly reopens after manual closure", async () => {
    let panes = [
      { pane_id: "parent", tab_id: "tab", cwd: "/repo", focused: true },
    ];
    let splits = 0;
    const owner = new HerdrCanvasOwner(async (args) => {
      if (args[0] === "pane" && args[1] === "list") {
        return { exitCode: 0, stdout: paneList(panes), stderr: "" };
      }
      if (args[1] === "split") {
        splits += 1;
        const id = `canvas-${splits}`;
        panes = [...panes, { pane_id: id, tab_id: "tab", cwd: "/repo", focused: false }];
        return { exitCode: 0, stdout: JSON.stringify({ result: { pane: { pane_id: id } } }), stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }, "/repo");

    expect(await owner.open(["renderer"])).toBe("canvas-1");
    expect(await owner.open(["renderer"])).toBe("canvas-1");
    panes = panes.filter((pane) => pane.pane_id !== "canvas-1");
    expect(await owner.open(["renderer"])).toBe("canvas-2");
    expect(splits).toBe(2);
  });

  test("closes only its currently verified pane", async () => {
    const calls: (readonly string[])[] = [];
    let panes = [
      { pane_id: "parent", tab_id: "tab", cwd: "/repo", focused: true },
      { pane_id: "other", tab_id: "tab", cwd: "/repo", focused: false },
    ];
    const owner = new HerdrCanvasOwner(async (args) => {
      calls.push(args);
      if (args[1] === "list") return { exitCode: 0, stdout: paneList(panes), stderr: "" };
      if (args[1] === "split") {
        panes = [...panes, { pane_id: "canvas", tab_id: "tab", cwd: "/repo", focused: false }];
        return { exitCode: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "canvas" } } }), stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }, "/repo");

    await owner.open(["renderer"]);
    await owner.close();

    expect(calls.at(-1)).toEqual(["pane", "close", "canvas"]);
  });

  test("rolls back ownership when the renderer command fails", async () => {
    const calls: (readonly string[])[] = [];
    let split = 0;
    const owner = new HerdrCanvasOwner(async (args) => {
      calls.push(args);
      if (args[1] === "list") {
        return { exitCode: 0, stdout: paneList([{ pane_id: "parent", tab_id: "tab", cwd: "/repo", focused: true }]), stderr: "" };
      }
      if (args[1] === "split") {
        split += 1;
        return { exitCode: 0, stdout: JSON.stringify({ result: { pane: { pane_id: `canvas-${split}` } } }), stderr: "" };
      }
      if (args[1] === "run" && split === 1) return { exitCode: 1, stdout: "", stderr: "failed" };
      return { exitCode: 0, stdout: "", stderr: "" };
    }, "/repo");

    await expect(owner.open(["renderer"])).rejects.toThrow();
    expect(calls.at(-1)).toEqual(["pane", "close", "canvas-1"]);
    await expect(owner.open(["renderer"])).resolves.toBe("canvas-2");
  });
});
