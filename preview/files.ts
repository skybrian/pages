import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { renderDirectoryListing, renderErrorPage, renderSourceView, type Breadcrumb, type DirectoryEntry } from "./views.tsx";

const ROUTE = "/admin/files";
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".bash": "bash",
  ".cjs": "javascript",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mjs": "javascript",
  ".sh": "bash",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
};
// Text previews are intentionally bounded so listings and direct requests never
// read arbitrarily large files into memory.
const MAX_TEXT_BYTES = 1024 * 1024;

export function languageForFilename(filename: string): string {
  return LANGUAGE_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "plaintext";
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

function breadcrumbs(segments: string[]): Breadcrumb[] {
  return [
    { label: "root", href: `${ROUTE}/` },
    ...segments.map((part, i) => ({
      label: part,
      href: `${ROUTE}/${segments.slice(0, i + 1).map(encodeURIComponent).join("/")}/`,
    })),
  ];
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
      return htmlResponse(res, 400, renderErrorPage(400, "Invalid path"), head);
    }

    const targetPath = path.resolve(root, ...segments);
    const relative = path.relative(root, targetPath);
    if (isOutsideRoot(relative)) {
      return htmlResponse(res, 400, renderErrorPage(400, "Invalid path"), head);
    }

    try {
      let current = root;
      for (const segment of segments) {
        current = path.join(current, segment);
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) return htmlResponse(res, 404, renderErrorPage(404, "Not found"), head);
      }
      const canonicalRoot = await realpath(root);
      const canonicalTarget = await realpath(targetPath);
      const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
      if (isOutsideRoot(canonicalRelative)) {
        return htmlResponse(res, 404, renderErrorPage(404, "Not found"), head);
      }
      const stat = await lstat(targetPath);
      if (stat.isFile()) {
        const text = await readTextFile(targetPath);
        if (text === null) return htmlResponse(res, 415, renderErrorPage(415, "This file is not a supported text file"), head);
        const name = segments.at(-1) ?? "";

        const language = languageForFilename(name);
        return htmlResponse(res, 200, renderSourceView({
          name,
          breadcrumbs: breadcrumbs(segments.slice(0, -1)),

          language,
          source: text,
        }), head);
      }
      if (!stat.isDirectory()) return htmlResponse(res, 404, renderErrorPage(404, "Not found"), head);

      const entries = await readdir(targetPath, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const entriesForView: DirectoryEntry[] = [];
      for (const entry of entries) {
        const isLink = entry.isSymbolicLink();
        const isDirectory = entry.isDirectory();
        const isTextFile = entry.isFile() && (await readTextFile(path.join(targetPath, entry.name))) !== null;
        const href = `${ROUTE}/${[...segments, entry.name].map(encodeURIComponent).join("/")}${entry.isDirectory() ? "/" : ""}`;
        const name = `${entry.name}${isDirectory ? "/" : ""}${isLink ? " (symlink blocked)" : ""}`;
        const linked = !isLink && (isDirectory || isTextFile);
        entriesForView.push({ name, href: linked ? href : undefined });
      }
      const parentHref = segments.length
        ? `${ROUTE}${segments.length > 1 ? `/${segments.slice(0, -1).map(encodeURIComponent).join("/")}` : ""}/`
        : undefined;
      return htmlResponse(res, 200, renderDirectoryListing({
        breadcrumbs: breadcrumbs(segments),
        parentHref,
        entries: entriesForView,
      }), head);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        return htmlResponse(res, 404, renderErrorPage(404, "Not found"), head);
      }
      return next(error);
    }
  };
}
