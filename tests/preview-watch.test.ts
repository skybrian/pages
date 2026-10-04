import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("Eleventy preview file watching", () => {
  it("rebuilds after repeated atomic Markdown saves and watches TS/data changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "preview-watch-"));
    temporaryRoots.push(root);
    const pageDirectory = path.join(root, "src/pages/sample");
    await mkdir(pageDirectory, { recursive: true });
    await symlink(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"));
    await symlink(path.join(projectRoot, "preview"), path.join(root, "preview"), "dir");
    await symlink(path.join(projectRoot, "scripts"), path.join(root, "scripts"), "dir");
    await copyFile(path.join(projectRoot, "eleventy.config.js"), path.join(root, "eleventy.config.js"));
    await mkdir(path.join(root, "src/_includes"), { recursive: true });
    await copyFile(
      path.join(projectRoot, "src/_includes/preview-ribbon.njk"),
      path.join(root, "src/_includes/preview-ribbon.njk"),
    );
    await writeFile(path.join(root, "src/_includes/test.njk"),
      '{% include "preview-ribbon.njk" %}{{ content | safe }}');
    await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(
      path.join(pageDirectory, "index.md"),
      "---\nlayout: test.njk\npermalink: /sample/index.html\n---\n\nInitial content\n",
    );
    await writeFile(path.join(pageDirectory, "plot.ts"), "export const value = 1;\n");
    await writeFile(path.join(pageDirectory, "data.json"), '{"value":1}\n');

    const output = path.join(root, "_preview");
    const port = await getFreePort();
    const child = spawn(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/@11ty/eleventy/cmd.cjs"),
        "--serve",
        `--port=${port}`,
        `--config=${path.join(root, "eleventy.config.js")}`,

      ],
      {
        cwd: root,
        env: { ...process.env, ELEVENTY_RUN_MODE: "serve" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "";
    child.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });

    try {
      await waitFor(child, () => logs.includes(`Server at http://localhost:${port}/`), () => logs);
      // Eleventy announces the HTTP server before Chokidar finishes scanning.
      // Let the small fixture's initial subscriptions settle before replacing
      // an existing file.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const htmlPath = path.join(output, "sample/index.html");
      assert.match(await readFile(htmlPath, "utf8"), /Initial content/);
      assert.match(await readFile(htmlPath, "utf8"), /class="preview-ribbon"/);

      await promisify(execFile)(process.execPath, [
        path.join(projectRoot, "node_modules/@11ty/eleventy/cmd.cjs"),
      ], { cwd: root, env: { ...process.env, ELEVENTY_RUN_MODE: "build" } });
      const productionHtml = await readFile(path.join(root, "_site/sample/index.html"), "utf8");
      assert.doesNotMatch(productionHtml, /class="preview-ribbon"/);
      const previewHtml = await fetch(`http://localhost:${port}/sample/`).then(response => response.text());
      assert.match(previewHtml, /class="preview-ribbon"/,
        "a production build must not overwrite the running preview");

      for (const [index, content] of ["Atomic save one", "Atomic save two"].entries()) {
        const previousChanges = countChanges(logs, "src/pages/sample/index.md");
        await atomicReplace(
          path.join(pageDirectory, "index.md"),
          `---\nlayout: test.njk\npermalink: /sample/index.html\n---\n\n${content}\n`,
        );
        await waitFor(
          child,
          () => countChanges(logs, "src/pages/sample/index.md") > previousChanges,
          () => logs,
        );
        await waitFor(child, async () => {
          const html = await readFile(htmlPath, "utf8").catch(() => "");
          return html.includes(content);
        }, () => logs);
        assert.ok(countChanges(logs, "src/pages/sample/index.md") > previousChanges);
      }

      for (const [filename, contents] of [
        ["plot.ts", "export const value = 2;\n"],
        ["data.json", '{"value":2}\n'],
      ]) {
        const relativePath = `src/pages/sample/${filename}`;
        const previousChanges = countChanges(logs, relativePath);
        await atomicReplace(path.join(pageDirectory, filename), contents);
        await waitFor(
          child,
          () => countChanges(logs, relativePath) > previousChanges,
          () => logs,
        );
      }
    } finally {
      await stop(child);
    }
  });
});

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function atomicReplace(target: string, content: string) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${Date.now()}.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, target);
}

function countChanges(logs: string, pathSuffix: string) {
  return logs.split("\n").filter((line) =>
    line.includes("[11ty] File changed:") && line.includes(pathSuffix)).length;
}

async function waitFor(
  child: ChildProcess,
  predicate: () => boolean | Promise<boolean>,
  logs: () => string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (child.exitCode !== null) {
      throw new Error(`Eleventy exited with code ${child.exitCode}:\n${logs()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for Eleventy watcher:\n${logs()}`);
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}
