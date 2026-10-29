/* The image worker, started once on first use. */
import { WorkerClient } from "../shared/worker-client.ts";

let client: WorkerClient | null = null;

export function imageWorker(): WorkerClient {
  client ??= new WorkerClient(new Worker(new URL("../worker/image-worker.ts", import.meta.url), { type: "module" }));
  return client;
}
