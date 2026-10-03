import { buildSync } from "esbuild";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const ROUTE = "/admin/assets/editor/editor.js";
const bundle = buildSync({
  entryPoints: [path.resolve("preview/editor-client.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
}).outputFiles[0]!.contents;

/** Serves the locally bundled editor only from Eleventy's development server. */
export function createEditorAssetsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const target = (req.url ?? "/").split("?", 1)[0];
    if (target !== ROUTE) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Content-Length", bundle.byteLength);
    res.end(req.method === "HEAD" ? undefined : bundle);
  };
}
