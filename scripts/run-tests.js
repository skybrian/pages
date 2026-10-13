import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = /\.test\.tsx?$/;
const FIXTURE_DIRECTORY = /^(?:__fixtures__|fixtures|test-fixtures)$/i;

/**
 * Discover shared and page-specific tests. Only files with the test suffix are
 * entries; helpers and fixtures remain importable without being executed.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function discoverTestFiles(root) {
  /**
   * @param {string} directory
   * @param {(entry: import("node:fs").Dirent) => boolean} include
   * @returns {Promise<string[]>}
   */
  async function walk(directory, include) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!FIXTURE_DIRECTORY.test(entry.name)) files.push(...await walk(join(directory, entry.name), include));
      } else if (entry.isFile() && include(entry)) {
        files.push(join(directory, entry.name));
      }
    }
    return files;
  }

  const preview = await walk(join(root, "preview"), (entry) => TEST_FILE.test(entry.name));
  const shared = await walk(join(root, "tests"), (entry) => TEST_FILE.test(entry.name));
  const pagesRoot = join(root, "src", "pages");
  /** @type {string[]} */
  const pageTests = [];
  /**
   * @param {string} directory
   * @returns {Promise<void>}
   */
  async function findPageTests(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || FIXTURE_DIRECTORY.test(entry.name)) continue;
      const child = join(directory, entry.name);
      if (entry.name === "tests") {
        pageTests.push(...await walk(child, (file) => TEST_FILE.test(file.name)));
      } else {
        await findPageTests(child);
      }
    }
  }
  await findPageTests(pagesRoot);
  return [...preview, ...shared, ...pageTests].map((file) => resolve(file)).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await discoverTestFiles(repositoryRoot);
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
