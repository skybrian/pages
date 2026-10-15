import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { readHeadFile } from "./git-file-state.ts";

const temporaryRoots: string[] = [];

async function newRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pages-git-file-state-"));
  temporaryRoots.push(root);
  return root;
}

function fixtureGit(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], { cwd: root, encoding: "buffer" });
}

function assertFixtureRoot(root: string): void {
  assert.equal(path.resolve(fixtureGit(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim()), path.resolve(root));
}

describe("preview Git file state", () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("distinguishes missing and unborn HEAD from an untracked path", async () => {
    const noRepository = await newRoot();
    assert.deepEqual(await readHeadFile(noRepository, "file.md"), { kind: "unavailable", reason: "git" });

    const unborn = await newRoot();
    fixtureGit(unborn, ["init", "-q"]);
    assertFixtureRoot(unborn);
    assert.deepEqual(await readHeadFile(unborn, "file.md"), { kind: "unavailable", reason: "git" });
  });

  it("marks oversized HEAD blobs unavailable and never restores committed symlinks as text", async () => {
    const root = await newRoot();
    fixtureGit(root, ["init", "-q"]);
    const repo = path.resolve(fixtureGit(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim());
    assert.equal(repo, path.resolve(root), "all Git fixture operations must stay inside their temp repo");
    fixtureGit(root, ["config", "user.name", "Preview Test"]);
    fixtureGit(root, ["config", "user.email", "preview-test@example.invalid"]);
    await writeFile(path.join(root, "large.md"), Buffer.alloc(1024 * 1024 + 512, 0x61));
    await writeFile(path.join(root, "target.md"), "# target\n");
    await symlink("target.md", path.join(root, "link.md"));
    fixtureGit(root, ["add", "-f", "--", "large.md", "target.md", "link.md"]);
    fixtureGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);

    assert.deepEqual(await readHeadFile(root, "large.md"), { kind: "unavailable", reason: "too-large" });
    assert.deepEqual(await readHeadFile(root, "link.md"), { kind: "unavailable", reason: "unsupported" });
    assert.deepEqual(await readHeadFile(root, "new.md"), { kind: "untracked" });
  });

  it("reads literal metacharacter paths from a nested preview root", async () => {
    const repository = await newRoot();
    fixtureGit(repository, ["init", "-q"]);
    const repo = path.resolve(fixtureGit(repository, ["rev-parse", "--show-toplevel"]).toString("utf8").trim());
    assert.equal(repo, path.resolve(repository), "Git fixture operations must stay in the temporary repository");
    fixtureGit(repository, ["config", "user.name", "Preview Test"]);
    fixtureGit(repository, ["config", "user.email", "preview-test@example.invalid"]);
    const nestedRoot = path.join(repository, "nested");
    await mkdir(nestedRoot);
    await writeFile(path.join(nestedRoot, "page[1].md"), "# tracked\n");
    fixtureGit(repository, ["add", "-f", "--", "nested/page[1].md"]);
    fixtureGit(repository, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "nested fixture"]);

    assert.deepEqual(await readHeadFile(nestedRoot, "page[1].md"), {
      kind: "tracked", content: Buffer.from("# tracked\n"),
    });
    assert.deepEqual(await readHeadFile(nestedRoot, "missing[2].md"), { kind: "untracked" });
  });
});
