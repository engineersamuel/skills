import { render } from "ink";
import React from "react";
import { readFileSync } from "node:fs";

import type { RendererState } from "../protocol/renderer.ts";
import { CanvasApp } from "./app.tsx";
import { connectRendererClient, type RendererClient } from "./client.ts";

const rendererConfig = (() => {
  const path = process.env.CANVAS_RENDERER_CONFIG;
  if (path === undefined) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { socketPath?: unknown; token?: unknown };
    return typeof value.socketPath === "string" && typeof value.token === "string"
      ? { socketPath: value.socketPath, token: value.token }
      : undefined;
  } catch {
    return undefined;
  }
})();
const socketPath = rendererConfig?.socketPath;
const token = rendererConfig?.token;
const configuredGrace = Number(process.env.CANVAS_DISCONNECT_GRACE_MS ?? "30000");
const disconnectGraceMs = Number.isFinite(configuredGrace) && configuredGrace >= 0
  ? configuredGrace
  : 30_000;

const ink = render(
  <CanvasApp
    status="disconnected"
    diagnostic={socketPath === undefined || token === undefined
      ? "Renderer authentication was not provided"
      : "Connecting to the canvas broker"}
  />,
);

if (socketPath !== undefined && token !== undefined) {
  let client: RendererClient | undefined;
  let disconnectedAt = Date.now();
  let lastRevision = -1;
  let stopped = false;

  const show = (state: RendererState): void => {
    ink.rerender(
      <CanvasApp
        status={state.status}
        {...(state.tree === undefined ? {} : { tree: state.tree })}
        {...(state.diagnostic === undefined ? {} : { diagnostic: state.diagnostic })}
        {...(state.decision === undefined ? {} : {
          decision: {
            ...state.decision,
            onChoose: (requestId: string, value: string) => client?.choose(requestId, value),
          },
        })}
        onEvent={(handle) => client?.dispatch(handle)}
      />,
    );
  };

  const reconnect = (): void => {
    if (stopped) return;
    client = connectRendererClient({
      socketPath,
      token,
      onState(update) {
        if (update.revision < lastRevision) return;
        lastRevision = update.revision;
        disconnectedAt = Date.now();
        show(update.state);
      },
      onDisconnect() {
        if (stopped) return;
        show({ status: "disconnected", diagnostic: "Broker connection lost" });
        if (Date.now() - disconnectedAt >= disconnectGraceMs) {
          stopped = true;
          ink.unmount();
          return;
        }
        setTimeout(reconnect, 250);
      },
    });
  };

  reconnect();
  process.once("SIGTERM", () => {
    stopped = true;
    client?.close();
    ink.unmount();
  });
}
