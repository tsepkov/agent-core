---
name: docker
description: Activates when configuring Docker Compose environments, creating Dockerfiles, or managing local container orchestration loops.
---

# Modern Docker Compose Local Development Standards

This specification establishes development rules for configuring Docker environments. It prioritizes the modern Docker Compose CLI engine, eliminates manual container rebuild cycles through real-time sync engines, and maximizes filesystem I/O performance.

## 1. Hard Engineering Constraints

* **No Obsolete Layouts:** Do not include the deprecated `version` field at the root of any `compose.yaml` file. The schema version must be omitted entirely.
* **Modern CLI Invocations:** Always use the modern space-separated `docker compose` command structure. The legacy hyphenated `docker-compose` binary is strictly prohibited.
* **No Manual Rebuild Loops:** Do not force container restarts or image rebuilds for routine source code modifications. Code updates must stream into the execution context instantly.
* **Isolated Dependencies:** Never share the host's local `node_modules` directory with the container filesystem. The container must install and manage its own dependencies internally using isolated virtual volumes.
* **Naming** Configuration file must be named `compose.yml`.

## 2. Guardrails

* **State Isolation:** Ensure all containerized local application state, volatile database tables, and runtime logs reside in named Docker volumes or temporary file mounts. Never allow containers to persist operational state directly inside the volatile root writable layer.
* **Contextual Alignment:** If the Docker configuration introduces networking conflicts, port collisions, or environment mismatch risks against existing host architectures, halt execution immediately. Present the structural alternatives and ask the user for an informed decision before modifying infrastructure files.

## 3. High-Performance Configuration Matrix

### Native File Synchronization via Compose Watch
Instead of using heavy, unoptimized generic bind mounts that degrade filesystem performance, always leverage the native `develop.watch` specification. This allows Compose to stream file deltas directly into the container.

* **Code Changes (`action: sync`):** Map source directories directly to the target application space inside the container. Whenever a `.ts` or `.js` file updates, Compose must sync the file instantly, allowing the application's native `--watch` flag to handle hot reloading without dropping the process.
* **Dependency Changes (`action: rebuild`):** Configure the tracking rule for manifests like `package.json` to automatically trigger an optimized image rebuild only when external dependencies are modified.

### Dockerfile Layer Optimization via BuildKit Cache
Accelerate package installations within the build stage by configuring native BuildKit cache mounts.

* **Cache Manifests:** Mount the package manager's cache directory explicitly using `RUN --mount=type=cache,target=/root/.npm` before executing any install commands. This keeps dependencies cached across subsequent incremental builds.

