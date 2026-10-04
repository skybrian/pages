import { Worker } from "node:worker_threads";

/** @typedef {{ resolve: (result: any) => void, reject: (error: Error) => void }} PendingRequest */
/** @typedef {{ worker: Worker, request: (method: "render" | "bundle", args: any[]) => Promise<any> }} ChartWorker */
/** @type {ChartWorker | undefined} */
let active;
let nextId = 0;

function getWorker() {
  if (active) return active;
  const worker = new Worker(new URL("./build-charts-worker.js", import.meta.url));
  /** @type {Map<number, PendingRequest>} */
  const pending = new Map();
  worker.on("message", ({ id, result, error }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(error); else request.resolve(result);
    if (!pending.size) worker.unref();
  });
  /** @param {Error} error */
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    if (active?.worker === worker) active = undefined;
    worker.unref();
  };
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`Chart worker exited (${code}).`)));
  worker.unref();
  active = {
    worker,
    // Keep Node alive only while a chart operation is outstanding.
    request: (method, args) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.ref();
      worker.postMessage({ id, method, args });
    }),
  };
  return active;
}

// A build gets a fresh module cache, including transitive chart dependencies.
// Terminating the worker prevents ESM namespaces and loader hooks accumulating
// in the long-lived preview process.
export async function finishChartBuild() {
  const current = active;
  active = undefined;
  if (current) await current.worker.terminate();
}

/** @param {string} inputPath @param {"charts" | "tabs"} part @returns {Promise<string>} */
export async function renderInitialCharts(inputPath, part = "charts") {
  return getWorker().request("render", [inputPath, part]);
}

/** @param {{ pagesDirectory?: string, siteOutputDirectory?: string, outputMode?: string }} options */
export async function buildChartBundles(options = {}) {
  try {
    if (options.outputMode !== undefined && options.outputMode !== "fs") return;
    await getWorker().request("bundle", [options]);
  } finally {
    await finishChartBuild();
  }
}
