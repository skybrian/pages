import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROUTE = "/admin/assets/microlighter";
const ALLOWED_ASSETS = [
  "dist/microlighter.min.js",
  "dist/grammars/javascript.js",
  "dist/grammars/typescript.js",
  "dist/grammars/json.js",
  "dist/grammars/css.js",
  "dist/grammars/html.js",
  "dist/grammars/markdown.js",
  "dist/grammars/bash.js",
  "dist/grammars/toml.js",
  "dist/grammars/tsx.js",
  "dist/grammars/yaml.js",
  "dist/themes/github.css",
] as const;
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function isOutsideRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** Preview-only allowlisted static assets needed by the file browser highlighter. */
export function createMicrolighterAssetsMiddleware(rootDirectory: string) {
  const packageRoot = path.join(rootDirectory, "node_modules", "microlighter");
  const allowed = new Set<string>(ALLOWED_ASSETS);

  return async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const rawPath = (req.url ?? "/").split("?", 1)[0]!;
    if (rawPath !== ROUTE && !rawPath.startsWith(`${ROUTE}/`)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      return res.end();
    }

    let relative: string;
    try {
      const suffix = rawPath.slice(ROUTE.length);
      if (/%2f|%5c/i.test(suffix)) throw new Error("encoded separator");
      relative = decodeURIComponent(suffix.replace(/^\/+/, ""));
      if (!relative || relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
        throw new Error("invalid asset path");
      }
    } catch {
      res.statusCode = 400;
      return res.end();
    }

    if (!allowed.has(relative)) {
      res.statusCode = 404;
      return res.end();
    }

    try {
      const assetPath = path.resolve(packageRoot, relative);
      const canonicalRoot = await realpath(packageRoot);
      const canonicalAsset = await realpath(assetPath);
      if (isOutsideRoot(path.relative(canonicalRoot, canonicalAsset)) || !(await lstat(assetPath)).isFile()) {
        res.statusCode = 404;
        return res.end();
      }
      const body = await readFile(assetPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_TYPES[path.extname(relative)] ?? "application/octet-stream");
      res.setHeader("Content-Length", body.byteLength);
      return res.end(head ? undefined : body);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        res.statusCode = 404;
        return res.end();
      }
      return next(error);
    }
  };
}
