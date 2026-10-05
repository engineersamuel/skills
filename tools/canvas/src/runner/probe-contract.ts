export const SANDBOX_ENFORCEMENT_CHECKS = [
  "bun_startup",
  "dns_denied",
  "dotenv_disabled",
  "environment_filtered",
  "filesystem_read_denied",
  "filesystem_write_denied",
  "fork_denied",
  "mach_lookup_denied",
  "network_denied",
  "posix_semaphore_denied",
  "posix_shm_denied",
  "posix_spawn_denied",
  "scratch_write_allowed",
  "signal_denied",
  "symlink_traversal_denied",
  "terminal_denied",
  "unix_socket_denied",
] as const;

export type SandboxEnforcementCheck = typeof SANDBOX_ENFORCEMENT_CHECKS[number];

export const hasCompleteSandboxChecks = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const checks = value as Record<string, unknown>;
  const names = Object.keys(checks).sort();
  return names.length === SANDBOX_ENFORCEMENT_CHECKS.length &&
    names.every((name, index) => name === [...SANDBOX_ENFORCEMENT_CHECKS].sort()[index]) &&
    Object.values(checks).every((passed) => passed === true);
};
