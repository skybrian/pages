import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROUTE = "/admin/files";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function htmlResponse(res: ServerResponse, status: number, body: string, head: boolean): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (head) res.end();
  else res.end(body);
}

function errorPage(status: number, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${status}</title><h1>${status}</h1><p>${escapeHtml(text)}</p>`;
}

/**
 * Preview-only, read-only browser. Symlinks are deliberately not traversed or
 * offered as links, keeping every accessible object inside the configured root.
 */
export function createFileBrowserMiddleware(rootDirectory: string) {
  const root = path.resolve(rootDirectory);

  return async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const target = req.url ?? "/";
    const rawPath = target.split("?", 1)[0]!;
    if (rawPath !== ROUTE && !rawPath.startsWith(`${ROUTE}/`)) return next();

    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    let segments: string[];
    try {
      const suffix = rawPath.slice(ROUTE.length).replace(/\/$/, "");
      const rawSegments = suffix ? suffix.slice(1).split("/") : [];
      if (rawSegments.some((part) => /%2f|%5c/i.test(part))) throw new Error("encoded separator");
      segments = rawSegments.map((part) => decodeURIComponent(part));
      if (segments.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) {
        throw new Error("invalid segment");
      }
    } catch {
      return htmlResponse(res, 400, errorPage(400, "Invalid path"), head);
    }

    const targetPath = path.resolve(root, ...segments);
    const relative = path.relative(root, targetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return htmlResponse(res, 400, errorPage(400, "Invalid path"), head);
    }

    try {
      let current = root;
      for (const segment of segments) {
        current = path.join(current, segment);
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) return htmlResponse(res, 404, errorPage(404, "Not found"), head);
      }
      const canonicalRoot = await realpath(root);
      const canonicalTarget = await realpath(targetPath);
      const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
      if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
        return htmlResponse(res, 404, errorPage(404, "Not found"), head);
      }
      const stat = await lstat(targetPath);
      if (stat.isFile()) {
        const contents = await readFile(targetPath);
        const name = segments.at(-1) ?? "download";
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Length", contents.byteLength);
        return res.end(head ? undefined : contents);
      }
      if (!stat.isDirectory()) return htmlResponse(res, 404, errorPage(404, "Not found"), head);

      const entries = await readdir(targetPath, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const parent = segments.length
        ? `<li><a href="${ROUTE}${segments.length > 1 ? `/${segments.slice(0, -1).map(encodeURIComponent).join("/")}` : ""}/">../</a></li>`
        : "";
      const rows = entries.map((entry) => {
        const isLink = entry.isSymbolicLink();
        const href = `${ROUTE}/${[...segments, entry.name].map(encodeURIComponent).join("/")}${entry.isDirectory() ? "/" : ""}`;
        const name = `${entry.name}${entry.isDirectory() ? "/" : ""}${isLink ? " (symlink blocked)" : ""}`;
        return `<li>${isLink ? escapeHtml(name) : `<a href="${href}">${escapeHtml(name)}</a>`}</li>`;
      }).join("\n");
      const crumbs = [`<a href="${ROUTE}/">root</a>`, ...segments.map((part, i) =>
        `<a href="${ROUTE}/${segments.slice(0, i + 1).map(encodeURIComponent).join("/")}/">${escapeHtml(part)}</a>`)].join(" / ");
      const body = `<!doctype html><html><head><meta charset="utf-8"><title>Files</title></head><body><h1>Worktree files</h1><nav>${crumbs}</nav><ul>${parent}${rows}</ul></body></html>`;
      return htmlResponse(res, 200, body, head);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        return htmlResponse(res, 404, errorPage(404, "Not found"), head);
      }
      return next(error);
    }
  };
}
