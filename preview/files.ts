import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROUTE = "/admin/files";
// Text previews are intentionally bounded so listings and direct requests never
// read arbitrarily large files into memory.
const MAX_TEXT_BYTES = 1024 * 1024;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

async function readTextFile(filePath: string): Promise<string | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;

    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_TEXT_BYTES) return null;

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    } catch {
      return null;
    }
    // Permit ordinary whitespace controls, but reject NUL and other binary
    // control characters (including the C1 range).
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)) return null;
    return text;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

function isOutsideRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function htmlResponse(res: ServerResponse, status: number, body: string, head: boolean): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
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
      res.setHeader("X-Content-Type-Options", "nosniff");
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
    if (isOutsideRoot(relative)) {
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
      if (isOutsideRoot(canonicalRelative)) {
        return htmlResponse(res, 404, errorPage(404, "Not found"), head);
      }
      const stat = await lstat(targetPath);
      if (stat.isFile()) {
        const text = await readTextFile(targetPath);
        if (text === null) return htmlResponse(res, 415, errorPage(415, "This file is not a supported text file"), head);
        const name = segments.at(-1) ?? "";
        const parentPath = `${ROUTE}${segments.length > 1 ? `/${segments.slice(0, -1).map(encodeURIComponent).join("/")}` : ""}/`;
        const breadcrumbs = [`<a href="${ROUTE}/">root</a>`, ...segments.slice(0, -1).map((part, i) =>
          `<a href="${ROUTE}/${segments.slice(0, i + 1).map(encodeURIComponent).join("/")}/">${escapeHtml(part)}</a>`),
          escapeHtml(name)].join(" / ");
        const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title></head><body><h1>${escapeHtml(name)}</h1><nav>${breadcrumbs}</nav><p><a href="${parentPath}">Back to parent</a></p><pre><code>${escapeHtml(text)}</code></pre></body></html>`;
        return htmlResponse(res, 200, body, head);
      }
      if (!stat.isDirectory()) return htmlResponse(res, 404, errorPage(404, "Not found"), head);

      const entries = await readdir(targetPath, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const parent = segments.length
        ? `<li><a href="${ROUTE}${segments.length > 1 ? `/${segments.slice(0, -1).map(encodeURIComponent).join("/")}` : ""}/">../</a></li>`
        : "";
      const rows: string[] = [];
      for (const entry of entries) {
        const isLink = entry.isSymbolicLink();
        const isDirectory = entry.isDirectory();
        const isTextFile = entry.isFile() && (await readTextFile(path.join(targetPath, entry.name))) !== null;
        const href = `${ROUTE}/${[...segments, entry.name].map(encodeURIComponent).join("/")}${entry.isDirectory() ? "/" : ""}`;
        const name = `${entry.name}${isDirectory ? "/" : ""}${isLink ? " (symlink blocked)" : ""}`;
        const linked = !isLink && (isDirectory || isTextFile);
        rows.push(`<li>${linked ? `<a href="${href}">${escapeHtml(name)}</a>` : escapeHtml(name)}</li>`);
      }
      const crumbs = [`<a href="${ROUTE}/">root</a>`, ...segments.map((part, i) =>
        `<a href="${ROUTE}/${segments.slice(0, i + 1).map(encodeURIComponent).join("/")}/">${escapeHtml(part)}</a>`)].join(" / ");
      const body = `<!doctype html><html><head><meta charset="utf-8"><title>Files</title></head><body><h1>Worktree files</h1><nav>${crumbs}</nav><ul>${parent}${rows.join("\n")}</ul></body></html>`;
      return htmlResponse(res, 200, body, head);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        return htmlResponse(res, 404, errorPage(404, "Not found"), head);
      }
      return next(error);
    }
  };
}
