/*
  The image worker: decoding, encoding, filters and effects run here, off the page. Each
  area adds a record of handlers ("format.decode", "filter.apply"...) as it is ported.
*/
import { serve } from "../shared/worker-host.ts";
import { JSPAINTSHOP_VERSION } from "../core/version.ts";
import { fileHandlers } from "./file-handlers.ts";

serve({
  "worker.version": () => JSPAINTSHOP_VERSION,
  ...fileHandlers,
});
