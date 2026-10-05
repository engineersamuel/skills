import { chmod, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";

import { FrameDecoder, encodeFrame } from "../protocol/frame.ts";
import {
  rendererToBrokerSchema,
  type RendererState,
} from "../protocol/renderer.ts";
import type { CallbackHandle } from "../protocol/tree.ts";
import { UpdateHub, type UpdateMessage } from "./update-hub.ts";

export interface RendererSocketServerOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly initialState: RendererState;
  readonly onDecision?: (decision: { requestId: string; value: string }) => void;
  readonly onEvent?: (event: { handle: CallbackHandle; payload?: unknown }) => void;
  readonly onDisconnect?: () => void;
}

export class RendererSocketServer {
  readonly #socketPath: string;
  readonly #token: string;
  readonly #hub: UpdateHub<RendererState>;
  readonly #onDecision: RendererSocketServerOptions["onDecision"];
  readonly #onEvent: RendererSocketServerOptions["onEvent"];
  readonly #onDisconnect: RendererSocketServerOptions["onDisconnect"];
  readonly #sockets = new Set<Socket>();
  readonly #authenticatedSockets = new Set<Socket>();
  #server: Server | undefined;

  constructor(options: RendererSocketServerOptions) {
    this.#socketPath = options.socketPath;
    this.#token = options.token;
    this.#onDecision = options.onDecision;
    this.#onEvent = options.onEvent;
    this.#onDisconnect = options.onDisconnect;
    this.#hub = new UpdateHub(options.token, options.initialState, (run, delayMs) => {
      setTimeout(run, delayMs);
    });
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) return;
    await unlink(this.#socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    const server = createServer((socket) => this.#accept(socket));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.#socketPath, 0o600);
  }

  publish(state: RendererState): void {
    this.#hub.publish(state);
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server !== undefined) {
      for (const socket of this.#sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
    await unlink(this.#socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  #accept(socket: Socket): void {
    this.#sockets.add(socket);
    const decoder = new FrameDecoder({ maxFrameBytes: 1_048_576, partialFrameTimeoutMs: 2_000 });
    let authenticated = false;
    const authTimer = setTimeout(() => socket.destroy(), 2_000);
    const frameTimer = setInterval(() => {
      try {
        decoder.checkDeadline(Date.now());
      } catch {
        socket.destroy();
      }
    }, 250);
    const send = (message: UpdateMessage<RendererState>): void => {
      socket.write(encodeFrame({ type: "state", revision: message.revision, state: message.value }));
    };
    const disconnect = (): void => {
      clearTimeout(authTimer);
      clearInterval(frameTimer);
      this.#sockets.delete(socket);
      const wasAuthenticated = this.#authenticatedSockets.delete(socket);
      this.#hub.disconnect(send);
      if (wasAuthenticated && this.#authenticatedSockets.size === 0) this.#onDisconnect?.();
    };
    socket.once("close", disconnect);
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const raw of decoder.push(chunk, Date.now())) {
          const message = rendererToBrokerSchema.parse(raw);
          if (!authenticated) {
            if (message.type !== "auth" || !this.#hub.connect(message.token, send)) {
              socket.destroy();
              return;
            }
            authenticated = true;
            this.#authenticatedSockets.add(socket);
            clearTimeout(authTimer);
            continue;
          }
          if (message.type === "decision") {
            this.#onDecision?.({ requestId: message.requestId, value: message.value });
          } else if (message.type === "event") {
            this.#onEvent?.({
              handle: message.handle,
              ...(message.payload === undefined ? {} : { payload: message.payload }),
            });
          } else {
            socket.destroy();
            return;
          }
        }
      } catch {
        socket.destroy();
      }
    });
  }
}
