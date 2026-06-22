# Tech Spec & Prompt: Core Architectural Framework for Durable AI Agents

### Objective
Build a lightweight, production-ready abstract framework to orchestrate long-running, autonomous, and reactive AI agents on **Vercel Serverless** using **Restate (Durable Execution)** and the **Vercel AI SDK**. 

The core mission of this framework is to solve the serverless timeout limit by turning the traditional Agent Loop into a stateful, deterministic workflow where every LLM call, tool execution, and human approval step is fully checkpointed, resumeable, and resilient to crashes.

---

### 1. Architectural Blueprint & Core Requirements

#### A. Durable Agent Loop (The Orchestrator)
* Implement an abstract Restate Virtual Object/Service handler that encapsulates the Vercel AI SDK agent loop (e.g., using `generateText` or custom loop constructs).
* The framework must execute the agent loop inside a durable context. Every single LLM invocation must be wrapped in a deterministic step (`ctx.run()`).
* The system must track and append chat history and intermediate tool tokens strictly inside **Restate KV State** (`ctx.get`, `ctx.set`), accumulating runtime context safely without relying on an external DB during the active session.

#### B. API-As-A-Tool Abstraction
* Provide a clean abstraction interface to register tools. **Every single tool (or logical group of API requests) must be executed as an isolated, checkpointed step.**
* The framework must expose a base class or configuration structure for tools that enforces:
  * Strict containment within a Restate step execution context.
  * Native integration with Restate’s retry policy (exponential backoff for Rate Limits / HTTP 429 / 5xx) configured on a per-step or per-tool basis.
  * Injection of deterministic Idempotency Keys generated from the workflow state for any mutating write operations.

#### C. Execution Modes & Control Flow
* **Reactive Handler:** A standard endpoint invoking the Virtual Object to handle live incoming chat payloads.
* **Proactive/Scheduled Handler:** Support for triggering the core workflow via Restate Scheduled Invocations or cron endpoints to run background autonomous loops.
* **Human-in-the-Loop Primitives:** Expose a reliable suspend/resume mechanism. When a destructive or high-risk tool is selected by the agent, the framework must pause execution using **Restate Awakeables** (`ctx.awakeable()`), outputting the pending payload to the frontend. The workflow must scale to zero and resume exactly where it left off only when the awakeable token is resolved via an external web hook or UI action.

#### D. Frontend Streaming & Generative UI Core
* Provide the server-side infrastructure to support real-time streaming of both the **final response** and the **agent's internal reasoning/thoughts (Reasoning tokens)** using Vercel AI SDK streams (`ai`).
* Ensure the streaming output supports raw tool payload delivery to allow Next.js components to render rich, interactive UI widgets (Generative UI) based on the tool's execution state or pending human approvals.

#### E. Plug-and-Play Memory Adapter
* Design a clean interface separation between the *operational context* (managed strictly inside Restate's fast state) and *long-term/semantic memory*. 
* Provide a simple interface/hook (`saveToLongTermMemory`, `retrieveFromLongTermMemory`) that developers can implement to connect the agent to an external database (PostgreSQL, Vector DB, etc.) without mixing database state with the active execution cycle.

---

### 2. Implementation Deliverables
Provide a minimal, working boilerplate skeleton demonstrating:
1. A Next.js API route / handler that acts as a Restate Service.
2. An abstract agent loop running `generateText` inside a Restate Virtual Object context, holding session conversation history inside Restate state.
3. One sample tool wrapper executing a mocked external API request inside a checkpointed `ctx.run` block.
4. Seamless integration with Vercel AI SDK's streaming response utility to output reasoning tokens and text directly to a client UI.
