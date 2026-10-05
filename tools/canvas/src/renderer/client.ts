import { createConnection, type Socket } from "node:net";

import { FrameDecoder, encodeFrame } from "../protocol/frame.ts";
import { brokerToRendererSchema, type RendererStateUpdate } from "../protocol/renderer.ts";
import type { CallbackHandle } from "../protocol/tree.ts";

export interface RendererClientOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly onState: (update: RendererStateUpdate) => void;
  readonly onDisconnect?: () => void;
}

export interface RendererClient {
  readonly connected: Promise<void>;
  readonly closed: Promise<void>;
  choose(requestId: string, value: string): void;
  dispatch(handle: CallbackHandle, payload?: unknown): void;
  close(): void;
}

export const connectRendererClient = (options: RendererClientOptions): RendererClient => {
  const decoder = new FrameDecoder({ maxFrameBytes: 1_048_576, partialFrameTimeoutMs: 2_000 });
  const socket: Socket = createConnection(options.socketPath);
  const frameTimer = setInterval(() => {
    try {
      decoder.checkDeadline(Date.now());
    } catch {
      socket.destroy();
    }
  }, 250);
  let connectedSettled = false;
  let resolveConnected: () => void = () => undefined;
  let rejectConnected: (error: Error) => void = () => undefined;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  void connected.catch(() => undefined);
  const closed = new Promise<void>((resolve) => {
    socket.once("close", () => {
      clearInterval(frameTimer);
      if (!connectedSettled) {
        connectedSettled = true;
        rejectConnected(new Error("Renderer socket closed before authentication"));
      }
      options.onDisconnect?.();
      resolve();
    });
  });
  socket.once("connect", () => {
    socket.write(encodeFrame({ type: "auth", token: options.token }));
  });
  socket.on("data", (chunk: Buffer) => {
    try {
      for (const raw of decoder.push(chunk, Date.now())) {
        const message = brokerToRendererSchema.parse(raw);
        options.onState({ revision: message.revision, state: message.state });
        if (!connectedSettled) {
          connectedSettled = true;
          resolveConnected();
        }
      }
    } catch {
      socket.destroy();
    }
  });
  socket.once("error", (error) => {
    if (!connectedSettled) {
      connectedSettled = true;
      rejectConnected(error);
    }
  });

  return {
    connected,
    closed,
    choose(requestId, value) {
      if (!socket.destroyed) {
        socket.write(encodeFrame({ type: "decision", requestId, value }));
      }
    },
    dispatch(handle, payload) {
      if (!socket.destroyed) {
        socket.write(encodeFrame({
          type: "event",
          handle,
          ...(payload === undefined ? {} : { payload }),
        }));
      }
    },
    close() {
      socket.end();
    },
  };
};
