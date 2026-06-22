---
name: nodejs-24
description: Universal Node.js architecture standards whenever you build, refine, test, or configure a modern Node.js application, serverless function, backend service, or fullstack monorepo. This universal standard forces a low-dependency architecture by leveraging the native engine capabilities of Node.js 24 and newer runtimes. It dictates how to implement lightweight routing via modern frameworks. It guarantees clean, fast, and secure TypeScript deployment across any serverless or containerized environment.
---

# Universal Node.js 24+ Standards

This specification establishes the foundation for building high-performance, ultra-lightweight, and incredibly secure applications. The core engineering philosophy focuses on maximizing the runtime engine's native capabilities while relentlessly eliminating unnecessary third-party packages. This setup minimizes cold start times in serverless environments, reduces supply-chain vulnerabilities, and guarantees that codebase dependencies stay clean and maintainable.

## 1. Hard Engineering Constraints

* **Direct TypeScript Execution:** Always configure code and tests to run directly via native Node.js TypeScript execution (e.g., `node main.ts` or `node --test`). Using `tsc` or `ts-node` for execution is prohibited. Node 24+ strips by default thus never add `--experimental-strip-types`.
* **Module Layout:** Force ESM by setting `"type": "module"` in `package.json`. All relative path imports must explicitly append the `.js` extension.
* **Zero-Dependency:** Never install third party utilities for tasks supported natively by Node.js 24+ including experimental. Use of `dotenv`, `jest`, `ts-jest`, `mocha`, `axios`, `@nestjs/axios`, filesystem utilities or standalone regex escapers is strictly forbidden.
* **Native Testing:** Use `node:test` and `node:assert/strict` exclusively.
* **Environment Injection:** Run `process.loadEnvFile()` at the absolute entry point inside `try/catch` to allow graceful execution without `.env` file.
* **Strings & Routes:** Parse paths with global `URLPattern`. Sanitize user inputs using `RegExp.escape()`.
* **Cleanup:** Release descriptors, clients, and database sockets natively via `using` or `await using` scope handlers.

## 2. Guardrails

* **Ambiguity:** Engineering precision takes precedence over assumption. If uncertain about architecture, infrastructure, domain, or parameters, halt execution, then present the clean structural options and ask the user for an informed decision before generating any code.
* **YAGNI Compliance:** Implement exclusively what is requested in the current prompt. Do not generate speculative interfaces, empty utility classes, or extension points for "future flexibility".
* **Red-Green TDD:** You must expose the native verification tests before writing the corresponding production logic. Show the failing test scenario first, then provide the minimum implementation required to make the test pass.
* **Anti-Placeholder:** Every generated code block must be fully production-ready and operational. Writing comments like `// TODO`, `// Implement logic here`, or omitting function bodies using placeholders is strictly prohibited.
* **Atomic Refactoring:** When modifying existing files, only emit the specific lines or functions being targeted. Do not rewrite large, unchanged parts of the codebase unless explicitly authorized.

## 3. Framework Selection

Framework choices must strictly align with the infrastructure footprint and execution environment. 
Avoid heavy, reflection-based enterprise frameworks unless complex dependency graphs and multi-module architectures demand them.

* **No Hidden Magic:** Do not use implicit auto-discovery hooks or magic file-system routers. Every endpoint, route definition, and middleware interceptor must be explicitly declared and registered programmatically in code.
* **Decoupled Architecture:** The selected framework is strictly an delivery mechanism (I/O layer). Keep business logic and domain core services entirely framework-agnostic. All domain engines must be pure TypeScript classes that can be instantiated and tested independently of Hono, NestJS, or Fastify.

Select the operational routing layer based on the deployment target and execution lifecycle.

### Micro-Services and Serverless (Edge / Cloud Functions)
* **Framework:** Use Hono as the default routing engine for serverless environments, webhooks, and performance-critical microservices.
* **Architecture:** Leverage Hono's web-standard abstractions (`Request`, `Response`, Web Fetch API). Avoid platform-specific wrappers to ensure identical execution behavior across environments.
* **Dependency Injection:** Assemble the object graph manually using classic object-oriented programming via constructors. Do not use external dynamic metadata reflection or heavy injection frameworks.

### Monoliths and Complex Domains (Cloud Run / Dedicated Containers)
* **Framework:** Use NestJS exclusively when building complex applications with rich domain logic, multiple downstream integrations, or shared corporate boundaries. Use Fastify for small apps.
* **Architecture:** Stick to standard NestJS modular conventions but enforce native Node.js ESM execution. If using NestJS, configure it to run on top of Fastify rather than Express.
* **Constraint:** Evaluate every NestJS ecosystem plugin before installation. If a feature can be modeled using native Node.js 24 capabilities (such as built-in health checks, native fetch, or raw context tracing), build it manually instead of pulling in an external NestJS wrapper.

### Tooling and Utilities (CLI / Background Workers)
* **Framework:** Zero framework. Build scripts, background processes, and command-line utilities using pure, unadulterated Node.js 24+ built-in modules.
* **Architecture:** Utilize standard input/output handling, native process management hooks, and the native asynchronous context engine to track runtime operations.

## 4. Dependency Injection (DI) & Testability

The implementation of Dependency Injection is strictly mandatory across all frameworks and utilities to guarantee absolute isolation and execution speed during unit testing.

* **Explicit Over Implicit:** Prioritize explicit Constructor Injection as the primary pattern for passing dependencies. Objects must receive their collaborators exclusively via class constructors or factory functions.
* **Separation of Assembly:** Separate object configuration from object usage. Assemble the application's dependency graph exactly once at the entry point (Composition Root). Avoid scattered or mid-lifecycle instantiations via the `new` keyword within business logic.
* **No-Library Mandate for Light Runtimes:** When developing within Hono, CLI tools, or background workers, assemble dependencies manually using pure TypeScript. Do not install metadata-reflection packages, structural container libraries, or implicit injection frameworks.
* **Strict Interface Contracts:** Depend entirely on abstract boundaries, ports, or TypeScript interfaces rather than concrete infrastructure implementations. This ensures that the native testing suite can substitute real database engines or network sockets with ultra-lightweight test doubles instantly and without third-party mocking tools.

## 5. Data Layer & State Management

Data persistence and memory state must remain clean, predictable, and fully optimized for execution environments.

* **Stateless by Default:** Avoid maintaining in-memory application state across different request lifecycles. All operational data must reside in external persistence layers to ensure absolute compatibility with serverless scaling.
* **Pure Data Mappers:** Keep database driver semantics out of domain models. Domain entities must remain pure TypeScript objects, utilizing mapping layers to translate raw database shapes into business models.
* **Native Connection Scopes:** Manage connection lifecycles dynamically. Always utilize native `[Symbol.asyncDispose]` contracts to handle database pool or socket close operations automatically on scope exit.

## 6. Error Handling & Observability

Observability must be lightweight, built-in, and rely entirely on native Node.js capabilities to prevent security context leaks and performance degradation.

* **No-Throw Domain Boundary:** Business services must handle predictable operational errors gracefully by returning explicit error objects or union types instead of throwing unhandled exceptions. Reservably throw native `Error` instances only for unrecoverable infrastructure crashes.
* **Native Error Context:** Utilize standard native `Error` features including the `cause` option for proper exception chaining and trace tracking. Validate error instances safely via the native `Error.isError()` engine runtime check.
* **Context Preservation:** Capture transaction boundaries, client telemetry, and execution flow IDs without explicit parameter drilling by utilizing native `AsyncLocalStorage` cross-context frames.
* **Structured Standard Output:** Emit system logs solely as structured JSON payloads sent directly to `process.stdout`. Do not integrate third-party logger frameworks.

