import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  PINNED_NONO_SOURCE_REVISION,
  PINNED_NONO_VERSION,
  validateNonoArtifact,
  type NonoArtifactManifest,
} from "../src/runner/nono-pin.ts";

const reportFailure = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const [sourceArgument, binaryArgument] = process.argv.slice(2);
if (sourceArgument === undefined || binaryArgument === undefined) {
  reportFailure("Usage: bun scripts/pin-nono.ts <nono-source-directory> <nono-binary>");
}

const sourceDirectory = realpathSync(sourceArgument);
const binaryPath = realpathSync(binaryArgument);
if (!lstatSync(binaryArgument).isFile() || lstatSync(binaryArgument).isSymbolicLink()) {
  reportFailure("Nono binary must be a regular, non-symlink file.");
}

const sourceResult = Bun.spawnSync({
  cmd: ["git", "-C", sourceDirectory, "rev-parse", "HEAD"],
  env: {},
  stdout: "pipe",
  stderr: "ignore",
});
const sourceRevision = sourceResult.stdout?.toString().trim();
if (sourceResult.exitCode !== 0 || sourceRevision !== PINNED_NONO_SOURCE_REVISION) {
  reportFailure(`Nono source must be exactly ${PINNED_NONO_SOURCE_REVISION}.`);
}
const dirtyResult = Bun.spawnSync({
  cmd: ["git", "-C", sourceDirectory, "status", "--porcelain", "--untracked-files=no"],
  env: {},
  stdout: "pipe",
  stderr: "ignore",
});
if (dirtyResult.exitCode !== 0 || (dirtyResult.stdout?.toString().trim() ?? "") !== "") {
  reportFailure("Nono source tree must be clean before pinning an artifact.");
}

const versionResult = Bun.spawnSync({
  cmd: [binaryPath, "--version"],
  cwd: dirname(binaryPath),
  env: {},
  stdout: "pipe",
  stderr: "ignore",
});
const versionOutput = versionResult.stdout?.toString() ?? "";
const sha256 = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
const manifest: NonoArtifactManifest = {
  sourceRevision,
  version: PINNED_NONO_VERSION,
  sha256,
};

if (versionResult.exitCode !== 0) {
  reportFailure("Unable to run the Nono version check.");
}

try {
  validateNonoArtifact(manifest, sha256, versionOutput);
} catch {
  reportFailure("Nono binary does not match the reviewed source pin.");
}

const manifestPath = join(dirname(binaryPath), "nono-artifact.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
chmodSync(manifestPath, 0o444);
process.stdout.write(`Pinned Nono artifact ${PINNED_NONO_VERSION} (${sourceRevision}).\n`);
