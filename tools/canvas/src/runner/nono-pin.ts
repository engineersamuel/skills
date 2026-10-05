import pinnedSource from "../../runtime/nono-source-pin.json" with { type: "json" };

import { SandboxUnavailable } from "./errors.ts";

export interface NonoArtifactManifest {
  readonly sourceRevision: string;
  readonly version: string;
  readonly sha256: string;
}

const expectedSource = pinnedSource as {
  readonly sourceRevision: string;
  readonly version: string;
};

export const PINNED_NONO_SOURCE_REVISION = expectedSource.sourceRevision;
export const PINNED_NONO_VERSION = expectedSource.version;

export const validateNonoArtifact = (
  manifest: NonoArtifactManifest,
  actualSha256: string,
  versionOutput: string,
): void => {
  if (
    manifest.sourceRevision !== PINNED_NONO_SOURCE_REVISION ||
    manifest.version !== PINNED_NONO_VERSION ||
    !/^[a-f0-9]{64}$/u.test(manifest.sha256) ||
    manifest.sha256 !== actualSha256
  ) {
    throw new SandboxUnavailable("nono_artifact_mismatch");
  }

  if (versionOutput.trim() !== `nono ${PINNED_NONO_VERSION}`) {
    throw new SandboxUnavailable("nono_version_mismatch");
  }
};
