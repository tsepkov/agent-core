import { endpoint } from "@restatedev/restate-sdk/fetch";
import { manager } from "@/restate/objects/manager";
import { createPubsubObject } from "@restatedev/pubsub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pubsub = createPubsubObject("pubsub");
const { fetch: restateHandler } = endpoint().bind(manager).bind(pubsub).handler();

export { restateHandler as GET, restateHandler as POST };
