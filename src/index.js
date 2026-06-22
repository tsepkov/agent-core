import * as restate from "@restatedev/restate-sdk";
import { manager } from "./agents/manager.js";

// Serve the agent as a Restate deployment (h2c on :9080). Bind additional agents here as needed.
restate.endpoint().bind(manager).listen(9080);
