import { describe, expect, test } from "bun:test";

import {
  TreeValidationError,
  validateTree,
  type TreeNode,
} from "../src/protocol/tree.ts";

const node = (
  type: string,
  props: Record<string, unknown> = {},
  children: Array<string | TreeNode> = [],
): TreeNode => ({ type, props: props as TreeNode["props"], children });

const treeOfDepth = (depth: number): TreeNode => {
  let current = node("Callout");
  for (let index = 1; index < depth; index++) {
    current = node("Callout", {}, [current]);
  }
  return current;
};

const treeWithNodeCount = (count: number): TreeNode =>
  node(
    "Graph",
    {},
    Array.from({ length: count - 1 }, () => node("Callout")),
  );

const thrownValidationError = (run: () => unknown): TreeValidationError => {
  try {
    run();
  } catch (error) {
    if (error instanceof TreeValidationError) return error;
    throw error;
  }
  throw new Error("Expected tree validation to fail");
};

describe("serializable terminal trees", () => {
  test("rejects unknown node names and function-valued props", () => {
    expect(thrownValidationError(() => validateTree(node("RunCommand"))).code).toBe("invalid_tree");
    expect(
      thrownValidationError(() => validateTree(node("Callout", { onClick: () => "run" }))).code,
    ).toBe("invalid_tree");
  });

  test("allows only well-formed serializable callback handles on event props", () => {
    const handle = { $type: "callback", generation: 3, revision: 8, id: "press_1" };

    expect(validateTree(node("Callout", { onClick: handle })).props).toEqual({
      onClick: handle,
    });
    expect(
      thrownValidationError(() => validateTree(node("Callout", { onClick: "press_1" }))).code,
    ).toBe("invalid_tree");
    expect(
      thrownValidationError(() =>
        validateTree(
          node("Callout", {
            onClick: { $type: "callback", generation: 3, id: "press_1" },
          }),
        ),
      ).code,
    ).toBe("invalid_tree");
    expect(
      thrownValidationError(() => validateTree(node("Callout", { token: handle }))).code,
    ).toBe("invalid_tree");
    expect(
      thrownValidationError(() =>
        validateTree(node("Head", { onClick: handle })),
      ).code,
    ).toBe("invalid_tree");
  });

  test("allows data-only helpers, Footnotes, and named canvas slots", () => {
    const tree = node("Footnotes", {}, [
      node("Head", { label: "Sources" }, ["Source text"]),
      node("Canvas.Slot", { id: "summary" }),
    ]);

    expect(validateTree(tree)).toEqual(tree);
    expect(
      thrownValidationError(() => validateTree(node("Canvas.Slot", {}))).code,
    ).toBe("invalid_tree");
  });

  test("allows the catalogued MDX host nodes and rejects other host tags", () => {
    const handle = { $type: "callback", generation: 4, revision: 2, id: "button_1" };
    const tree = node("section", {}, [
      node("h2", {}, ["Summary"]),
      node("p", {}, ["Ready"]),
      node("button", { onClick: handle }, ["Continue"]),
    ]);

    expect(validateTree(tree)).toEqual(tree);
    expect(thrownValidationError(() => validateTree(node("script", {}, ["bad"]))).code).toBe(
      "invalid_tree",
    );
  });

  test("sanitizes all text and props before returning the validated tree", () => {
    const input = node(
      "Callout",
      {
        "tit\u001b[31mle": "\u001b[32mBuild\u001b[0m",
        detail: ["ready\u0007", { label: "safe\u001b[2J" }],
      },
      ["\u001b[2JCompiling"],
    );

    expect(validateTree(input)).toEqual(
      node("Callout", { title: "Build", detail: ["ready", { label: "safe" }] }, ["Compiling"]),
    );
  });

  test("sanitizes untrusted prop names in validation diagnostics", () => {
    const error = thrownValidationError(() =>
      validateTree(node("Callout", { "label\u001b[31m": () => "bad" })),
    );

    expect(
      error.issues.some((issue) =>
        issue.path.some((segment) => typeof segment === "string" && segment.includes("\u001b")),
      ),
    ).toBe(false);
  });

  test("enforces the default depth limit of 64 nodes", () => {
    expect(() => validateTree(treeOfDepth(64))).not.toThrow();
    expect(thrownValidationError(() => validateTree(treeOfDepth(65))).code).toBe("tree_too_deep");
  });

  test("enforces the default maximum of 10,000 component nodes", () => {
    expect(() => validateTree(treeWithNodeCount(10_000))).not.toThrow();
    expect(thrownValidationError(() => validateTree(treeWithNodeCount(10_001))).code).toBe(
      "too_many_nodes",
    );
  });

  test("accepts configured depth and node limits", () => {
    const limits = { maxDepth: 2, maxNodes: 2 };

    expect(() => validateTree(treeOfDepth(2), limits)).not.toThrow();
    expect(thrownValidationError(() => validateTree(treeOfDepth(3), limits)).code).toBe(
      "tree_too_deep",
    );
    expect(thrownValidationError(() => validateTree(treeWithNodeCount(3), limits)).code).toBe(
      "too_many_nodes",
    );
  });
});
