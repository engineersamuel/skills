import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SandboxUnavailable, type SandboxUnavailableReason } from "./errors.ts";
import { validateRuntimeBundle, type VerifiedRuntimeBundle } from "./runtime-bundle.ts";
import { hasCompleteSandboxChecks } from "./probe-contract.ts";

export const verifySandboxAvailability = async (): Promise<VerifiedRuntimeBundle> => {
  if (process.platform !== "darwin") throw new SandboxUnavailable("unsupported_platform");
  const runtimeDirectory = process.env.CANVAS_RUNTIME_BUNDLE;
  if (runtimeDirectory === undefined) {
    if (Bun.which("nono") === null) throw new SandboxUnavailable("nono_missing");
    throw new SandboxUnavailable("runtime_bundle_invalid");
  }
  const bundle = await validateRuntimeBundle(runtimeDirectory);
  const probeScript = [
    fileURLToPath(new URL("../../scripts/probe-sandbox.ts", import.meta.url)),
    fileURLToPath(new URL("../scripts/probe-sandbox.js", import.meta.url)),
  ].find(existsSync);
  if (probeScript === undefined) throw new SandboxUnavailable("enforcement_probe_failed");
  const result = Bun.spawnSync({
    cmd: [process.execPath, probeScript],
    cwd: bundle.root,
    env: {
      CANVAS_NONO_BIN: bundle.nonoBinary,
      CANVAS_BUN_BIN: bundle.bunBinary,
      CANVAS_RUNTIME_ROOT: bundle.root,
    },
    stdout: "pipe",
    stderr: "ignore",
  });
  let report: { status?: string; reason?: SandboxUnavailableReason; checks?: unknown } = {};
  try {
    report = JSON.parse(result.stdout?.toString() ?? "") as typeof report;
  } catch {
    throw new SandboxUnavailable("enforcement_probe_failed");
  }
  if (result.exitCode !== 0 || report.status !== "sandbox_ready" || !hasCompleteSandboxChecks(report.checks)) {
    throw new SandboxUnavailable(report.reason ?? "enforcement_probe_failed");
  }
  return bundle;
};
