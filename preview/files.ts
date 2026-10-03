import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
const MAX_SAVE_BYTES = MAX_TEXT_BYTES;
const MAX_SAVE_REQUEST_BYTES = MAX_SAVE_BYTES * 3 + 4096;
const MAX_PNG_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const saveQueues = new Map<string, Promise<void>>();

async function withSaveLock<T>(canonicalPath: string, action: () => Promise<T>): Promise<T> {
  const previous = saveQueues.get(canonicalPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  saveQueues.set(canonicalPath, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (saveQueues.get(canonicalPath) === current) saveQueues.delete(canonicalPath);
  }
}

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
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
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

function validPng(buffer: Buffer): boolean {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  const crc32 = (start: number, end: number): number => {
    let crc = 0xffffffff;
    for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  let offset = 8;
  let first = true;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end + 4 > buffer.length) return false;
    const type = buffer.toString("ascii", typeOffset, dataOffset);
    if (crc32(typeOffset, end) !== buffer.readUInt32BE(end)) return false;
    if (first) {
      if (type !== "IHDR" || length !== 13 || buffer.readUInt32BE(dataOffset) === 0
        || buffer.readUInt32BE(dataOffset + 4) === 0) return false;
      first = false;
    }
    if (type === "IEND") return length === 0 && end + 4 === buffer.length;
    offset = end + 4;
  }
  return false;
}

async function readPngFile(filePath: string): Promise<Buffer | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES || stat.size < 45) return null;
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size || length > MAX_PNG_BYTES) return null;
    const png = buffer.subarray(0, length);
    return validPng(png) ? png : null;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

function isPngFilename(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".png";
}

function pngResponse(res: ServerResponse, image: Buffer, head: boolean): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", image.length);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (head) res.end();
  else res.end(image);
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
 * Preview-only file browser with explicit Markdown saves. Symlinks are not traversed or
 * offered as links, keeping every accessible object inside the configured root.
 */
export function createFileBrowserMiddleware(
  rootDirectory: string,
  resolvePreviewUrl?: (sourcePath: string) => string | undefined,
) {
  const root = path.resolve(rootDirectory);
  const csrfSecret = randomBytes(32);
  const csrfCookie = randomBytes(32).toString("hex");
  const csrf = (file: string) => createHmac("sha256", csrfSecret).update(file).digest("hex");

  return async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const target = req.url ?? "/";
    const rawPath = target.split("?", 1)[0]!;
    if (rawPath !== ROUTE && !rawPath.startsWith(`${ROUTE}/`)) return next();

    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head && req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD, POST");
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
      if (req.method === "POST") {
        const extension = path.extname(segments.at(-1) ?? "").toLowerCase();
        if (!segments.length || ![".md", ".markdown"].includes(extension)) {
          return htmlResponse(res, 405, renderErrorPage(405, "Method not allowed"), false);
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
          return htmlResponse(res, 415, renderErrorPage(415, "Expected JSON"), false);
        }
        const cookie = req.headers.cookie?.match(/(?:^|;\s*)pages_edit_csrf=([a-f0-9]{64})(?:;|$)/)?.[1];
        const tokenHeader = req.headers["x-pages-csrf-token"];
        const expected = csrf(relative);
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
        const validToken = !!cookie && !!token && cookie === csrfCookie && token === expected
          && timingSafeEqual(Buffer.from(cookie), Buffer.from(csrfCookie))
          && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
        const origin = req.headers.origin;
        const host = req.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() ?? req.headers.host;
        const proto = req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim()
          ?? ((req.socket as import("node:tls").TLSSocket).encrypted ? "https" : "http");
        let validOrigin = true;
        if (origin) {
          try { validOrigin = new URL(origin).host === host && new URL(origin).protocol === `${proto}:`; }
          catch { validOrigin = false; }
        }
        if (!validToken || !validOrigin || req.headers["sec-fetch-site"] === "cross-site") {
          return htmlResponse(res, 403, renderErrorPage(403, "Request rejected"), false);
        }
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > MAX_SAVE_REQUEST_BYTES) {
            res.statusCode = 413;
            return res.end();
          }
          chunks.push(buffer);
        }
        let payload: { content?: unknown; hash?: unknown };
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return htmlResponse(res, 400, renderErrorPage(400, "Invalid save request"), false); }
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          return htmlResponse(res, 400, renderErrorPage(400, "Invalid save request"), false);
        }
        if (typeof payload.content !== "string" || Buffer.byteLength(payload.content, "utf8") > MAX_SAVE_BYTES
          || typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/.test(payload.hash)
          || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(payload.content)) {
          return htmlResponse(res, 400, renderErrorPage(400, "Invalid Markdown content"), false);
        }
        const content = payload.content as string;
        const expectedHash = payload.hash as string;
        const canonicalRoot = await realpath(root);
        const canonicalTarget = await realpath(targetPath);
        const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
        if (isOutsideRoot(canonicalRelative)) return htmlResponse(res, 404, renderErrorPage(404, "Not found"), false);
        const saved = await withSaveLock(canonicalTarget, async () => {
          // Check again under the per-path lock; simultaneous same-base saves
          // must serialize before the hash comparison and replacement.
          let current = root;
          for (const segment of segments) {
            current = path.join(current, segment);
            const part = await lstat(current);
            if (part.isSymbolicLink()) return { status: 404, error: "Not found" };
          }
          const target = await open(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            const stat = await target.stat();
            if (!stat.isFile() || stat.size > MAX_SAVE_BYTES) return { status: 415, error: "File cannot be saved" };
            const buffer = Buffer.alloc(MAX_SAVE_BYTES + 1);
            let length = 0;
            while (length < buffer.length) {
              const { bytesRead } = await target.read(buffer, length, buffer.length - length, length);
              if (bytesRead === 0) break;
              length += bytesRead;
            }
            if (length > MAX_SAVE_BYTES) return { status: 415, error: "File cannot be saved" };
            const oldHash = createHash("sha256").update(buffer.subarray(0, length)).digest("hex");
            if (oldHash !== expectedHash) return { status: 409, hash: oldHash };
            const latest = await lstat(targetPath);
            if (!latest.isFile() || latest.dev !== stat.dev || latest.ino !== stat.ino) {
              return { status: 409, error: "File changed; reload before saving" };
            }
            const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomBytes(12).toString("hex")}.tmp`);
            try {
              const replacement = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, stat.mode & 0o777);
              try {
                await replacement.chmod(stat.mode & 0o777);
                await replacement.writeFile(content, "utf8");
                await replacement.sync();
              }
              finally { await replacement.close(); }
              const check = await lstat(targetPath);
              if (!check.isFile() || check.dev !== stat.dev || check.ino !== stat.ino) {
                return { status: 409, error: "File changed; reload before saving" };
              }
              // Re-read immediately before rename to catch non-cooperating
              // writers that modify the same inode while the temp file is made.
              const lateCheck = await open(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
              let lateHash = "";
              try {
                const lateStat = await lateCheck.stat();
                if (!lateStat.isFile() || lateStat.dev !== stat.dev || lateStat.ino !== stat.ino
                  || lateStat.size > MAX_SAVE_BYTES) {
                  return { status: 409, error: "File changed; reload before saving" };
                }
                const lateBytes = Buffer.alloc(MAX_SAVE_BYTES + 1);
                let lateLength = 0;
                while (lateLength < lateBytes.length) {
                  const { bytesRead } = await lateCheck.read(lateBytes, lateLength, lateBytes.length - lateLength, lateLength);
                  if (bytesRead === 0) break;
                  lateLength += bytesRead;
                }
                if (lateLength > MAX_SAVE_BYTES) return { status: 409, error: "File changed; reload before saving" };
                lateHash = createHash("sha256").update(lateBytes.subarray(0, lateLength)).digest("hex");
              } finally { await lateCheck.close(); }
              if (lateHash !== expectedHash) return { status: 409, hash: lateHash };
              await rename(temporary, targetPath);
            } finally { await unlink(temporary).catch(() => {}); }
            return { status: 200, hash: createHash("sha256").update(content, "utf8").digest("hex") };
          } finally {
            await target.close();
          }
        });
        if (saved.status !== 200) {
          res.statusCode = saved.status;
          res.setHeader("Content-Type", saved.status === 409 ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          return res.end(saved.status === 409 ? JSON.stringify({ error: "conflict", hash: saved.hash })
            : renderErrorPage(saved.status, saved.error ?? "Save failed"));
        }
        res.statusCode = saved.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify({ hash: saved.hash }));
      }
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
        const name = segments.at(-1) ?? "";
        if (isPngFilename(name)) {
          const image = await readPngFile(targetPath);
          if (image === null) return htmlResponse(res, 415, renderErrorPage(415, "This is not a supported PNG image"), head);
          return pngResponse(res, image, head);
        }
        const text = await readTextFile(targetPath);
        if (text === null) return htmlResponse(res, 415, renderErrorPage(415, "This file is not a supported text file"), head);

        const language = languageForFilename(name);
        const editable = [".md", ".markdown"].includes(path.extname(name).toLowerCase());
        const editToken = editable ? csrf(relative) : undefined;
        const sourceHash = createHash("sha256").update(text, "utf8").digest("hex");
        if (editToken) {
          res.setHeader("Set-Cookie", `pages_edit_csrf=${csrfCookie}; Path=${ROUTE}/; SameSite=Strict; HttpOnly`);
        }
        return htmlResponse(res, 200, renderSourceView({
          name,
          breadcrumbs: breadcrumbs(segments.slice(0, -1)),

          language,
          source: text,
          editable,
          editToken,
          sourceHash,
          sourceEncoded: Buffer.from(text, "utf8").toString("base64"),
          previewUrl: resolvePreviewUrl?.(path.relative(root, targetPath)),
        }), head);
      }
      if (!stat.isDirectory()) return htmlResponse(res, 404, renderErrorPage(404, "Not found"), head);

      const entries = await readdir(targetPath, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const entriesForView: DirectoryEntry[] = [];
      for (const entry of entries) {
        const isLink = entry.isSymbolicLink();
        const isDirectory = entry.isDirectory();
        const isPngName = isPngFilename(entry.name);
        const isTextFile = entry.isFile() && !isPngName
          && (await readTextFile(path.join(targetPath, entry.name))) !== null;
        const isPng = entry.isFile() && isPngName
          && (await readPngFile(path.join(targetPath, entry.name))) !== null;
        const href = `${ROUTE}/${[...segments, entry.name].map(encodeURIComponent).join("/")}${entry.isDirectory() ? "/" : ""}`;
        const name = `${entry.name}${isDirectory ? "/" : ""}${isLink ? " (symlink blocked)" : ""}`;
        const linked = !isLink && (isDirectory || isTextFile || isPng);
        entriesForView.push({ name, href: linked ? href : undefined, target: isPng && !isLink ? "_blank" : undefined });
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
