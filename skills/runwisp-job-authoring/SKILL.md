---
name: runwisp-job-authoring
description: Use when creating, changing, debugging, or validating RunWisp filesystem job packages, job.toml manifests, or runwisp-job doctor/run behavior.
---

# RunWisp Job Authoring

Treat the current Jobkit contract as authoritative. Build a self-contained job package without inventing scheduler policy, deployment details, credentials, or an unspecified external integration.

## Workflow

1. Read the target repository's instructions. Inspect the current Jobkit `README.md`, `docs/authoring.md`, relevant implementation/tests, and `examples/`; use the public repository when a local checkout is absent or stale. Resolve exact semantics there rather than copying a contract that can drift.
2. Choose the closest current Jobkit example and follow the target project's existing language and package conventions. Keep unknown product or service behavior as an explicit seam and request its authoritative contract.
3. Make the job package own its runtime dependencies, forwarded arguments and validation, side effects, useful output, and exit codes. Declare actual runtime inputs, including lockfiles, scripts, prompts, or configuration.
4. Run proportionate package tests, then `runwisp-job doctor JOB_DIR`. Before scheduling or normal invocation, doctor must pass in the intended runtime environment.
5. If the job provides a safe dry run, invoke it through `runwisp-job run JOB_DIR [ARG ...]` to verify forwarded arguments. Never run a side-effecting path without authorization.

## Manifest

Use all seven fields unless current authoritative documentation says otherwise:

| Field | Purpose |
| --- | --- |
| `schema` | Supported manifest schema. |
| `id` | Stable, nonempty job identifier. |
| `kind` | Current execution kind. |
| `cwd` | Working directory relative to the job directory. |
| `argv` | Nonempty executable and argument vector. |
| `required_env` | Environment variable names required at launch. |
| `required_files` | Readable files actually needed at runtime. |

Keep `cwd` and every declared file inside the job directory; parent traversal and symlink escapes are invalid. Put only environment variable names in the manifest. Never place secret values in manifests, examples, logs, tests, or generated public files.

Preserve shell-free `argv`: Jobkit appends forwarded arguments unchanged and performs no shell parsing. Choose an explicit shell only when the job genuinely requires one; that job then owns quoting and safety.

## Evidence boundaries

`doctor` is passive. It checks the manifest, confined paths, required environment presence, files, and executable availability without executing the job. A passing doctor does not prove runtime behavior, forwarded-argument handling, external-service success, permissions beyond those checks, or safe side effects. Report package tests and dry-run evidence separately and precisely.

Jobkit does not discover jobs, install dependencies, store secrets, configure schedules, or provide a sandbox. For schedule, retry, notification, secret injection, deployment path, or service-account work, inspect the actual scheduler configuration, version, runtime environment, and authoritative schema separately. Do not invent scheduler syntax or private deployment details.

## Common mistakes

- Calling a package ready from doctor alone.
- Omitting a lockfile, prompt, or config that the command reads.
- Embedding a shell command as one `argv` string.
- Guessing an API, credential meaning, schedule, path, or notification target.
