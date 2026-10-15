import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HeadFileState =
  | { kind: "tracked"; content: Buffer }
  | { kind: "untracked" }
  | { kind: "unavailable"; reason: "git" | "too-large" | "unsupported" };

async function git(root: string, args: string[], maxBuffer = 1024 * 1024 + 1024): Promise<Buffer> {
  const result = await execFileAsync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer,
    timeout: 5000,
    windowsHide: true,
  });
  return result.stdout;
}

/** Read a literal repository-relative file from HEAD without consulting the index. */
export async function readHeadFile(root: string, relativePath: string): Promise<HeadFileState> {
  let prefix: string;
  try {
    await git(root, ["rev-parse", "--verify", "HEAD"]);
    prefix = (await git(root, ["rev-parse", "--show-prefix"])).toString("utf8").trim();
  } catch {
    return { kind: "unavailable", reason: "git" };
  }
  const repositoryPath = `${prefix}${relativePath}`;
  let treeEntry: Buffer;
  try {
    treeEntry = await git(root, ["ls-tree", "--full-tree", "-z", "HEAD", "--", `:(top,literal)${repositoryPath}`]);
  } catch {
    return { kind: "unavailable", reason: "git" };
  }
  if (treeEntry.length === 0) return { kind: "untracked" };
  const metadata = treeEntry.toString("utf8").split("\t", 1)[0]!;
  const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]+)$/.exec(metadata);
  if (!match || match[2] !== "blob") return { kind: "unavailable", reason: "unsupported" };
  if (match[1] === "120000") return { kind: "unavailable", reason: "unsupported" };
  try {
    const content = await git(root, ["cat-file", "blob", match[3]!]);
    if (content.length > 1024 * 1024) return { kind: "unavailable", reason: "too-large" };
    return { kind: "tracked", content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { kind: "unavailable", reason: "too-large" };
    }
    return { kind: "unavailable", reason: "git" };
  }
}

/** Produce a bounded diff in a temporary directory; git is never given a worktree path. */
export async function diffHeadToWorking(
  root: string,
  _relativePath: string,
  head: Buffer,
  working: Buffer,
): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "pages-preview-diff-"));
  const oldPath = path.join(temporaryDirectory, "head");
  const newPath = path.join(temporaryDirectory, "working");
  try {
    await writeFile(oldPath, head, { flag: "wx" });
    await writeFile(newPath, working, { flag: "wx" });
    try {
      const output = await execFileAsync("git", [
        "-c", "core.attributesFile=/dev/null", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3",
        "--src-prefix=a/", "--dst-prefix=b/", "--", oldPath, newPath,
      ], { cwd: root, encoding: "buffer", maxBuffer: 2 * 1024 * 1024, timeout: 3000, windowsHide: true });
      return normalizeDiff(output.stdout);
    } catch (error) {
      const result = error as { code?: number | string; stdout?: Buffer };
      if (result.code !== 1 || !Buffer.isBuffer(result.stdout)) throw error;
      return normalizeDiff(result.stdout);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function normalizeDiff(output: Buffer): string {
  return output.toString("utf8")
    .replace(/^diff --git .*$/m, "diff --git a/HEAD b/WORKING")
    .replace(/^--- a\/.*$/m, "--- a/HEAD")
    .replace(/^\+\+\+ b\/.*$/m, "+++ b/WORKING")
    .replace(/^index .*$/m, "");
}

