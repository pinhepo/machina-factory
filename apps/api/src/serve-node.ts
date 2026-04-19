import { serve } from "@hono/node-server";
import app from "./index";

const port = (app as { port?: number }).port ?? 3001;

serve(
  { fetch: (app as { fetch: (...args: unknown[]) => Response }).fetch, port },
  () => {
    console.log(`Machina Factory API listening on http://localhost:${port}`);
  },
);
