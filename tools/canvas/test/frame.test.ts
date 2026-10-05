import { describe, expect, test } from "bun:test";

import { FrameDecoder, FrameError, encodeFrame } from "../src/protocol/frame.ts";

describe("bounded framed JSON", () => {
  test("decodes frames split across arbitrary chunks", () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 1024, partialFrameTimeoutMs: 100 });
    const encoded = encodeFrame({ type: "ping", revision: 4 });

    expect(decoder.push(encoded.subarray(0, 2), 0)).toEqual([]);
    expect(decoder.push(encoded.subarray(2, 7), 20)).toEqual([]);
    expect(decoder.push(encoded.subarray(7), 30)).toEqual([{ type: "ping", revision: 4 }]);
  });

  test("rejects an oversized length from the header before receiving the body", () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 8, partialFrameTimeoutMs: 100 });
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 9, false);

    expect(() => decoder.push(header, 0)).toThrow(
      new FrameError("frame_too_large", "Frame declares 9 bytes; limit is 8"),
    );
  });

  test("rejects an oversized transport chunk before buffering it", () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 8, partialFrameTimeoutMs: 100 });
    expect(() => decoder.push(new Uint8Array(13), 0)).toThrow(
      new FrameError("frame_too_large", "Incoming frame chunk exceeds the configured limit"),
    );
  });

  test("rejects oversized encoded output", () => {
    expect(() => encodeFrame({ value: "123456789" }, 8)).toThrow(FrameError);
  });

  test("rejects a partial frame after its deadline", () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 1024, partialFrameTimeoutMs: 50 });
    const encoded = encodeFrame({ ok: true });

    decoder.push(encoded.subarray(0, 5), 10);
    expect(() => decoder.checkDeadline(61)).toThrow(
      new FrameError("partial_frame_timeout", "Partial frame exceeded 50ms"),
    );
  });

  test("rejects malformed JSON without accepting a later frame", () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 1024, partialFrameTimeoutMs: 50 });
    const invalid = new TextEncoder().encode("{");
    const frame = new Uint8Array(5);
    new DataView(frame.buffer).setUint32(0, invalid.byteLength, false);
    frame.set(invalid, 4);

    expect(() => decoder.push(frame, 0)).toThrow(
      new FrameError("invalid_json", "Frame body is not valid JSON"),
    );
    expect(() => decoder.push(encodeFrame({ ok: true }), 1)).toThrow(
      new FrameError("decoder_closed", "Frame decoder is closed"),
    );
  });
});
