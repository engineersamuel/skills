import { SandboxUnavailable } from "./errors.ts";
import type { NonoInvocation } from "./invocation.ts";

export const WORKER_STARTUP_TIMEOUT_MS = 5_000;
export const WORKER_LIVENESS_TIMEOUT_MS = 2_000;
export const WORKER_TERMINATION_GRACE_MS = 500;

export type WorkerTerminationReason =
  | "closed"
  | "broker_disconnected"
  | "worker_startup_timeout"
  | "worker_unresponsive"
  | "worker_exited";

export interface WorkerProcessControl {
  readonly exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface WorkerLifecycleScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface WorkerLifecycleOptions {
  readonly brokerSignal?: AbortSignal;
  readonly scheduler?: WorkerLifecycleScheduler;
  readonly startupTimeoutMs?: number;
  readonly livenessTimeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly onFailure?: (failure: SandboxUnavailable) => void;
}

export interface WorkerTermination {
  readonly reason: WorkerTerminationReason;
  readonly exitCode: number;
}

export interface WorkerLifecycle {
  readonly ready: Promise<void>;
  readonly terminated: Promise<WorkerTermination>;
  markFirstRenderValidated(): boolean;
  markHeartbeat(): boolean;
  close(): Promise<WorkerTermination>;
}

export interface SpawnedWorker extends WorkerLifecycle {
  readonly stdin: Bun.FileSink;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

const scheduleTimer: WorkerLifecycleScheduler["schedule"] = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export const createWorkerLifecycle = (
  processHandle: WorkerProcessControl,
  options: WorkerLifecycleOptions = {},
): WorkerLifecycle => {
  const scheduler = options.scheduler ?? { schedule: scheduleTimer };
  const startupTimeoutMs = options.startupTimeoutMs ?? WORKER_STARTUP_TIMEOUT_MS;
  const livenessTimeoutMs = options.livenessTimeoutMs ?? WORKER_LIVENESS_TIMEOUT_MS;
  const terminationGraceMs = options.terminationGraceMs ?? WORKER_TERMINATION_GRACE_MS;
  let state: "starting" | "ready" | "terminating" | "exited" = "starting";
  let reason: WorkerTerminationReason | undefined;
  let startupTimer: (() => void) | undefined;
  let livenessTimer: (() => void) | undefined;
  let escalationTimer: (() => void) | undefined;
  let readySettled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  let resolveTermination: (result: WorkerTermination) => void = () => undefined;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  const terminated = new Promise<WorkerTermination>((resolve) => {
    resolveTermination = resolve;
  });

  const clearTimer = (timer: (() => void) | undefined): undefined => {
    timer?.();
    return undefined;
  };
  const clearWatchdogs = (): void => {
    startupTimer = clearTimer(startupTimer);
    livenessTimer = clearTimer(livenessTimer);
  };
  const finish = (exitCode: number): void => {
    if (state === "exited") return;
    state = "exited";
    clearWatchdogs();
    escalationTimer = clearTimer(escalationTimer);
    options.brokerSignal?.removeEventListener("abort", onBrokerDisconnect);
    if (!readySettled) {
      readySettled = true;
      rejectReady(new SandboxUnavailable("worker_exited"));
    }
    resolveTermination({ reason: reason ?? "worker_exited", exitCode });
  };
  const ignoreKillError = (signal: "SIGTERM" | "SIGKILL"): void => {
    try {
      processHandle.kill(signal);
    } catch {
      // A process can exit between the state check and signal delivery.
    }
  };
  const terminate = (nextReason: WorkerTerminationReason): Promise<WorkerTermination> => {
    if (state === "terminating" || state === "exited") return terminated;
    state = "terminating";
    reason = nextReason;
    clearWatchdogs();
    options.brokerSignal?.removeEventListener("abort", onBrokerDisconnect);
    if (!readySettled && nextReason !== "worker_startup_timeout") {
      readySettled = true;
      rejectReady(new Error(`Worker stopped before first render: ${nextReason}`));
    }
    ignoreKillError("SIGTERM");
    escalationTimer = scheduler.schedule(() => {
      escalationTimer = undefined;
      if (state !== "exited") ignoreKillError("SIGKILL");
    }, terminationGraceMs);
    return terminated;
  };
  const fail = (failureReason: "worker_startup_timeout" | "worker_unresponsive"): void => {
    const failure = new SandboxUnavailable(failureReason);
    options.onFailure?.(failure);
    if (!readySettled) {
      readySettled = true;
      rejectReady(failure);
    }
    void terminate(failureReason);
  };
  const onStartupTimeout = (): void => {
    startupTimer = undefined;
    fail("worker_startup_timeout");
  };
  const onLivenessTimeout = (): void => {
    livenessTimer = undefined;
    fail("worker_unresponsive");
  };
  function onBrokerDisconnect(): void {
    void terminate("broker_disconnected");
  }
  const armLivenessDeadline = (): void => {
    livenessTimer = clearTimer(livenessTimer);
    livenessTimer = scheduler.schedule(onLivenessTimeout, livenessTimeoutMs);
  };

  startupTimer = scheduler.schedule(onStartupTimeout, startupTimeoutMs);
  options.brokerSignal?.addEventListener("abort", onBrokerDisconnect, { once: true });
  if (options.brokerSignal?.aborted) onBrokerDisconnect();
  void processHandle.exited.then(finish);

  return {
    ready,
    terminated,
    markFirstRenderValidated() {
      if (state !== "starting") return false;
      state = "ready";
      startupTimer = clearTimer(startupTimer);
      readySettled = true;
      resolveReady();
      armLivenessDeadline();
      return true;
    },
    markHeartbeat() {
      if (state !== "ready") return false;
      armLivenessDeadline();
      return true;
    },
    close() {
      return terminate("closed");
    },
  };
};

export const spawnNonoWorker = (
  invocation: NonoInvocation,
  options: WorkerLifecycleOptions = {},
): SpawnedWorker => {
  const processHandle = Bun.spawn({
    cmd: invocation.cmd,
    cwd: invocation.cwd,
    env: invocation.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ...createWorkerLifecycle(processHandle, options),
    stdin: processHandle.stdin,
    stdout: processHandle.stdout,
    stderr: processHandle.stderr,
  };
};
