---
name: restate
description: Use this whenever you are working with Restate server for durable executions.
---

# Serve restate

```
import { endpoint } from "@/restate/endpoint";
import { serveRestate } from "@/restate/serve";
export const { GET, POST } = serveRestate(endpoint);
```

# Calling services

```
import { NextRequest } from "next/server";
import * as clients from "@restatedev/restate-sdk-clients";
import { Agent } from "@/restate/services/agent";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ topic: string }> },
) {
  const { topic } = await params;
  const { message } = await request.json();
  const ingressUrl = process.env.INGRESS_URL || "http://localhost:8080";

  const ingress = clients.connect({ url: ingressUrl });

  await ingress
    .serviceSendClient<Agent>({ name: "agent" })
    .chat({ prompt: message, topic });

  return Response.json({ ok: true });
}
```

# Streaming responses

Restate supports streaming responses for AI Agents

Restate endpoint:
```
import * as restate from "@restatedev/restate-sdk/fetch";
import agent from "@/restate/services/agent";
import { createPubsubObject } from "@restatedev/pubsub";

const pubsub = createPubsubObject("pubsub", {});

export const endpoint = restate.createEndpointHandler({
  services: [agent, pubsub],
});
```

/pubsub Handler:
```
import { createPubsubClient } from "@restatedev/pubsub-client";
import { NextRequest } from "next/server";

const pubsub = createPubsubClient({
  url: process.env.INGRESS_URL || "http://localhost:8080",
  name: "pubsub",
});

export async function GET(request: NextRequest, { params }: any) {
  const topic = (await params).topic;
  const searchParams = request.nextUrl.searchParams;
  const offsetQuery = Number(searchParams.get("offset") || 0);
  const offset = isNaN(offsetQuery) ? 0 : offsetQuery;
  const stream = pubsub.sse({
    topic,
    offset,
    signal: request.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
```

Frontend
```
let offset = 0;
const evtSource = new EventSource(`/pubsub/${topic}?offset=${offset}`);
evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // show the new messages in the UI...
};
```

# Notify when ready

Let users subscribe to notifications for long-running agent tasks instead of waiting. With Restate’s durable promises, you can coordinate between agent execution and notification handlers, no extra infrastructure needed.

### Creating and waiting for awakeables

1. Create an awakeable - Get a unique ID and promise
2. Send the ID externally - Pass the awakeable ID to your external system
3. Wait for result - Your handler suspends until the external system responds

```
// Create awakeable and get unique ID
const { id, promise } = ctx.awakeable<string>();

// Send ID to external system (email, queue, webhook, etc.)
await ctx.run(() => requestHumanReview(name, id));

// Handler suspends here until external completion
const review = await promise;
```

Note that if you wait for an awakeable in an exclusive handler in a Virtual Object, all other calls to this object will be queued.

### Resolving/rejecting Awakeables

External processes complete awakeables in two ways:
* Resolve with success data → handler continues normally
* Reject with error reason → throws a terminal error in the waiting handler
```
// Complete with success data
ctx.resolveAwakeable(id, "Looks good!");
```

```
// Complete with error (string message)
ctx.rejectAwakeable(id, "This cannot be reviewed.");
```

```
// Complete with a TerminalError — propagates error code and message to the waiter
ctx.rejectAwakeable(
  id,
  new restate.TerminalError("Review rejected: insufficient documentation", {
    errorCode: 400,
  })
);
```

# OOP Virtual Objects

Restate discovers handlers via `Object.keys()` on the instance — only **own enumerable properties** are found, not prototype methods.

Rules:
- Define handlers as **arrow function class fields** (`handler = async (ctx, req) => {}`) so they land on the instance.
- Store config in **JS native private fields** (`#field`) — these are non-enumerable and invisible to Restate's discovery.
- Never use TypeScript `private` keyword for config fields: TypeScript `private` compiles to plain instance properties, which Restate will try to register as handlers and throw `Unexpected handler type`.

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";

interface MyHandlers {
  chat(ctx: ObjectContext, req: ChatRequest): Promise<Result>;
  reset(ctx: ObjectContext): Promise<{ ok: boolean }>;
}

class MyObject implements MyHandlers {
  // JS native private — invisible to Restate
  readonly #config: string;

  constructor(config: string) {
    this.#config = config;
  }

  // Arrow field — own property, discovered by Restate
  chat = async (ctx: ObjectContext, req: ChatRequest): Promise<Result> => {
    // use this.#config
  };

  reset = async (ctx: ObjectContext): Promise<{ ok: boolean }> => {
    ctx.clearAll();
    return { ok: true };
  };
}

export const myObject = restate.object({
  name: "myObject",
  handlers: new MyObject("...") as MyHandlers,
});
```

# Best Practices
* Use awakeables for services/objects coordinating with external systems
* Use durable promises for workflow signaling
* Always handle rejections to gracefully manage failures
* Include timeouts for long-running external processes
