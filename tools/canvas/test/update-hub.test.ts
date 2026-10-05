import { describe, expect, test } from "bun:test";

import { UpdateHub } from "../src/broker/update-hub.ts";

describe("revisioned renderer updates", () => {
  test("authenticates subscribers, sends a snapshot, and coalesces intermediate updates", () => {
    const scheduled: (() => void)[] = [];
    const hub = new UpdateHub("secret", { status: "initial" }, (run, delay) => {
      expect(delay).toBe(150);
      scheduled.push(run);
    });
    const received: unknown[] = [];

    expect(hub.connect("wrong", (message) => received.push(message))).toBe(false);
    expect(hub.connect("secret", (message) => received.push(message))).toBe(true);
    expect(received).toEqual([{ kind: "snapshot", revision: 0, value: { status: "initial" } }]);

    hub.publish({ status: "compiling" });
    hub.publish({ status: "ready" });
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();

    expect(received.at(-1)).toEqual({ kind: "update", revision: 2, value: { status: "ready" } });
  });

  test("a reconnect receives the latest value as a fresh snapshot", () => {
    const scheduled: (() => void)[] = [];
    const hub = new UpdateHub("token", 1, (run) => scheduled.push(run));
    hub.publish(2);
    scheduled[0]!();
    const received: unknown[] = [];

    hub.connect("token", (message) => received.push(message));

    expect(received).toEqual([{ kind: "snapshot", revision: 1, value: 2 }]);
  });
});
