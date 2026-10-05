import { describe, expect, test } from "bun:test";

import { FrameDecoder, encodeFrame } from "../src/protocol/frame.ts";
import { serveWorkerProtocol } from "../src/worker/main.ts";
import type { WorkerSnapshot, WorkerTreeNode } from "../src/worker/types.ts";

type Reply = Record<string, unknown> & { readonly type: string };

const textContent = (node: WorkerTreeNode | string): string =>
  typeof node === "string" ? node : node.children.map(textContent).join("");

const findNode = (node: WorkerTreeNode | string, type: string): WorkerTreeNode | undefined => {
  if (typeof node === "string") return undefined;
  if (node.type === type) return node;
  for (const child of node.children) {
    const match = findNode(child, type);
    if (match) return match;
  }
  return undefined;
};

const decodeReplies = (frames: readonly Uint8Array[]): Reply[] => {
  const decoder = new FrameDecoder({ maxFrameBytes: 1_048_576, partialFrameTimeoutMs: 1_000 });
  return frames.flatMap((frame) => decoder.push(frame, 0) as Reply[]);
};

const frame = (value: unknown): Uint8Array => encodeFrame(value);

describe("framed worker stdio protocol", () => {
  test("initializes, renders, dispatches events, updates data, and closes", async () => {
    const outputFrames: Uint8Array[] = [];
    const source = `
import { useState } from 'react'

export function Inventory() {
  const [clicks, setClicks] = useState(0)
  return <button onClick={() => setClicks((value) => value + 1)}>
    Clicks: {clicks}; total: {data.inventory.total}
  </button>
}

<Inventory />
`;

    async function* requests(): AsyncGenerator<Uint8Array> {
      yield frame({
        type: "init",
        requestId: "init-1",
        generation: 24,
        datasets: { inventory: { total: 2 } },
      });
      yield frame({ type: "render", requestId: "render-1", source });

      const firstReply = decodeReplies(outputFrames).find(
        (reply) => reply.type === "snapshot" && reply.requestId === "render-1",
      );
      const firstSnapshot = firstReply?.snapshot as WorkerSnapshot | undefined;
      const button = firstSnapshot && findNode(firstSnapshot.tree, "button");
      const handle = button?.props.onClick;
      if (!handle || typeof handle !== "object") throw new Error("expected a callback handle");

      yield frame({ type: "event", requestId: "event-1", handle });
      yield frame({ type: "set_data", requestId: "data-1", key: "inventory", value: { total: 3 } });
      yield frame({ type: "close", requestId: "close-1" });
    }

    const result = await serveWorkerProtocol(requests(), async (bytes) => {
      outputFrames.push(bytes.slice());
    });
    const replies = decodeReplies(outputFrames);

    expect(result.kind).toBe("closed");
    expect(replies.find((reply) => reply.type === "ready" && reply.requestId === "init-1")).toEqual({
      type: "ready",
      requestId: "init-1",
      generation: 24,
    });
    const rendered = replies.find(
      (reply) => reply.type === "snapshot" && reply.requestId === "render-1",
    )?.snapshot as WorkerSnapshot | undefined;
    expect(rendered && textContent(rendered.tree)).toContain("Clicks: 0; total: 2");
    expect(replies.find((reply) => reply.type === "event_result" && reply.requestId === "event-1"))
      .toEqual({ type: "event_result", requestId: "event-1", accepted: true });
    const afterEvent = replies.find(
      (reply) => reply.type === "snapshot" && reply.requestId === "event-1",
    )?.snapshot as WorkerSnapshot | undefined;
    expect(afterEvent && textContent(afterEvent.tree)).toContain("Clicks: 1; total: 2");
    const afterData = replies.find(
      (reply) => reply.type === "snapshot" && reply.requestId === "data-1",
    )?.snapshot as WorkerSnapshot | undefined;
    expect(afterData && textContent(afterData.tree)).toContain("Clicks: 1; total: 3");
    expect(replies.at(-1)).toEqual({ type: "closed", requestId: "close-1" });
  });

  test("rejects commands before init without echoing document contents", async () => {
    const outputFrames: Uint8Array[] = [];
    async function* requests(): AsyncGenerator<Uint8Array> {
      yield frame({ type: "render", requestId: "render-1", source: "PRIVATE MDX CONTENT" });
    }
    const result = await serveWorkerProtocol(
      requests(),
      async (bytes) => {
        outputFrames.push(bytes.slice());
      },
    );
    const replies = decodeReplies(outputFrames);
    const diagnostic = replies.find((reply) => reply.type === "diagnostic");

    expect(result.kind).toBe("protocol_error");
    expect(diagnostic?.diagnostic).toEqual({
      code: "invalid_request",
      message: "Worker request is malformed",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE MDX CONTENT");
  });

  test("terminates with a partial-frame diagnostic when input stalls", async () => {
    const outputFrames: Uint8Array[] = [];
    let returned = false;
    let firstChunk = true;
    const stalledInput: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (firstChunk) {
              firstChunk = false;
              return { value: new Uint8Array([0, 0, 0]), done: false };
            }
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
          async return() {
            returned = true;
            return { value: undefined, done: true };
          },
        };
      },
    };

    const result = await serveWorkerProtocol(stalledInput, async (bytes) => {
      outputFrames.push(bytes.slice());
    }, { partialFrameTimeoutMs: 10 });
    const replies = decodeReplies(outputFrames);

    expect(result.kind).toBe("protocol_error");
    expect(returned).toBe(true);
    expect(replies.some((reply) =>
      (reply.diagnostic as { code?: string } | undefined)?.code === "partial_frame_timeout",
    )).toBe(true);
  });

  test("rejects an oversized frame from its header and exits", async () => {
    const outputFrames: Uint8Array[] = [];
    const oversizedHeader = new Uint8Array(4);
    new DataView(oversizedHeader.buffer).setUint32(0, 513, false);
    async function* requests(): AsyncGenerator<Uint8Array> {
      yield oversizedHeader;
    }

    const result = await serveWorkerProtocol(requests(), async (bytes) => {
      outputFrames.push(bytes.slice());
    }, { maxFrameBytes: 512 });
    const replies = decodeReplies(outputFrames);

    expect(result.kind).toBe("protocol_error");
    expect((result as { diagnostic?: { code?: string } }).diagnostic?.code).toBe("frame_too_large");
    expect(replies.some((reply) =>
      (reply.diagnostic as { code?: string } | undefined)?.code === "frame_too_large",
    )).toBe(true);
  });

  test("replaces an oversized rendered snapshot with a bounded diagnostic", async () => {
    const outputFrames: Uint8Array[] = [];
    async function* requests(): AsyncGenerator<Uint8Array> {
      yield frame({ type: "init", requestId: "init-1", generation: 6 });
      yield frame({
        type: "render",
        requestId: "render-1",
        source: `<p>{'x'.repeat(700)}</p>`,
      });
    }

    const result = await serveWorkerProtocol(requests(), async (bytes) => {
      outputFrames.push(bytes.slice());
    }, { maxFrameBytes: 512 });
    const replies = decodeReplies(outputFrames);
    const diagnostic = replies.find((reply) => reply.type === "diagnostic");

    expect(result.kind).toBe("protocol_error");
    expect((result as { diagnostic?: { code?: string } }).diagnostic?.code)
      .toBe("output_frame_too_large");
    expect(diagnostic?.diagnostic).toEqual({
      code: "output_frame_too_large",
      message: "Worker response exceeds the frame limit",
    });
  });

  test("limits initial dataset depth before runtime construction", async () => {
    const outputFrames: Uint8Array[] = [];
    let tooDeep: unknown = {};
    for (let index = 0; index < 64; index += 1) tooDeep = { next: tooDeep };
    async function* requests(): AsyncGenerator<Uint8Array> {
      yield frame({
        type: "init",
        requestId: "init-1",
        generation: 6,
        datasets: { deep: tooDeep },
      });
    }

    const result = await serveWorkerProtocol(requests(), async (bytes) => {
      outputFrames.push(bytes.slice());
    });
    const replies = decodeReplies(outputFrames);

    expect(result.kind).toBe("protocol_error");
    expect((result as { diagnostic?: { code?: string } }).diagnostic?.code).toBe("invalid_request");
    expect(replies.some((reply) => reply.type === "ready")).toBe(false);
  });

  test("contains input pipe errors in bounded protocol diagnostics", async () => {
    const outputFrames: Uint8Array[] = [];
    const brokenInput: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.reject(new Error("synthetic failure at /private/path")),
        };
      },
    };

    const result = await serveWorkerProtocol(brokenInput, async (bytes) => {
      outputFrames.push(bytes.slice());
    });
    const replies = decodeReplies(outputFrames);

    expect(result.kind).toBe("protocol_error");
    expect((result as { diagnostic?: { code?: string; message?: string } }).diagnostic)
      .toEqual({ code: "input_read_failed", message: "Worker input pipe failed" });
    expect(JSON.stringify(replies)).not.toContain("/private/path");
  });
});
