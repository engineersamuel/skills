export type FrameErrorCode =
  | "frame_too_large"
  | "partial_frame_timeout"
  | "invalid_json"
  | "decoder_closed";

export class FrameError extends Error {
  readonly code: FrameErrorCode;

  constructor(code: FrameErrorCode, message: string) {
    super(message);
    this.name = "FrameError";
    this.code = code;
  }
}

export const MAX_ENCODED_FRAME_BYTES = 1_048_576;

export const encodeFrame = (value: unknown, maxFrameBytes = MAX_ENCODED_FRAME_BYTES): Uint8Array => {
  const body = new TextEncoder().encode(JSON.stringify(value));
  if (body.byteLength > maxFrameBytes) {
    throw new FrameError("frame_too_large", `Frame encodes ${body.byteLength} bytes; limit is ${maxFrameBytes}`);
  }
  return frameBytes(body);
};

const frameBytes = (body: Uint8Array): Uint8Array => {
  const frame = new Uint8Array(4 + body.byteLength);
  new DataView(frame.buffer).setUint32(0, body.byteLength, false);
  frame.set(body, 4);
  return frame;
};

export class FrameDecoder {
  readonly #maxFrameBytes: number;
  readonly #partialFrameTimeoutMs: number;
  #buffer = new Uint8Array();
  #partialSince: number | undefined;
  #closed = false;

  constructor(options: { maxFrameBytes: number; partialFrameTimeoutMs: number }) {
    this.#maxFrameBytes = options.maxFrameBytes;
    this.#partialFrameTimeoutMs = options.partialFrameTimeoutMs;
  }

  push(chunk: Uint8Array, now: number): unknown[] {
    this.#assertOpen();
    this.checkDeadline(now);
    if (chunk.byteLength > this.#maxFrameBytes + 4) {
      this.#fail(new FrameError("frame_too_large", "Incoming frame chunk exceeds the configured limit"));
    }
    if (chunk.byteLength > 0) {
      const next = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
      next.set(this.#buffer);
      next.set(chunk, this.#buffer.byteLength);
      this.#buffer = next;
      this.#partialSince ??= now;
    }

    const messages: unknown[] = [];
    while (this.#buffer.byteLength >= 4) {
      const length = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength,
      ).getUint32(0, false);
      if (length > this.#maxFrameBytes) {
        this.#fail(
          new FrameError(
            "frame_too_large",
            `Frame declares ${length} bytes; limit is ${this.#maxFrameBytes}`,
          ),
        );
      }
      if (this.#buffer.byteLength < length + 4) {
        break;
      }
      const body = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.slice(length + 4);
      try {
        messages.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
      } catch {
        this.#fail(new FrameError("invalid_json", "Frame body is not valid JSON"));
      }
      this.#partialSince = this.#buffer.byteLength > 0 ? now : undefined;
    }
    return messages;
  }

  checkDeadline(now: number): void {
    this.#assertOpen();
    if (
      this.#partialSince !== undefined &&
      now - this.#partialSince > this.#partialFrameTimeoutMs
    ) {
      this.#fail(
        new FrameError(
          "partial_frame_timeout",
          `Partial frame exceeded ${this.#partialFrameTimeoutMs}ms`,
        ),
      );
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new FrameError("decoder_closed", "Frame decoder is closed");
    }
  }

  #fail(error: FrameError): never {
    this.#closed = true;
    this.#buffer = new Uint8Array();
    throw error;
  }
}
