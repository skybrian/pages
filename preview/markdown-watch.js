import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Chokidar 3 can omit existing Markdown files when Eleventy supplies several
 * overlapping recursive globs. Add current Markdown templates as explicit
 * paths so each file receives its own watch subscription.
 *
 * @param {string} inputDirectory
 * @param {string} relativeTo
 * @returns {Promise<string[]>}
 */
export async function getMarkdownWatchTargets(inputDirectory = "src", relativeTo = ".") {
  /** @type {string[]} */
  const targets = [];

  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        targets.push(path.relative(relativeTo, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await visit(inputDirectory);
  return targets.sort();
}
