export type SandboxUnavailableReason =
  | "nono_missing"
  | "nono_path_invalid"
  | "nono_version_mismatch"
  | "nono_artifact_mismatch"
  | "enforcement_probe_failed"
  | "unsupported_platform"
  | "runtime_bundle_invalid"
  | "worker_startup_timeout"
  | "worker_unresponsive"
  | "worker_exited"
  | "bun_version_mismatch";

export class SandboxUnavailable extends Error {
  readonly code = "sandbox_unavailable" as const;

  constructor(readonly reason: SandboxUnavailableReason) {
    super(`Sandbox unavailable: ${reason}`);
    this.name = "SandboxUnavailable";
  }
}
