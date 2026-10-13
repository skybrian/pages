import { after } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const runnerOutput = process.env.PAGES_TEST_SITE_OUTPUT;
const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
let privateOutput: string | undefined;
let pendingOutput: Promise<string> | undefined;

/**
 * Return the site output shared by the test runner, or lazily build a private
 * output for focused test-file invocations.
 */
export async function getSiteTestOutput(): Promise<string> {
  if (runnerOutput) {
    const output = path.resolve(repositoryRoot, runnerOutput);
    const details = await stat(output).catch(() => undefined);
    if (!details?.isDirectory()) {
      throw new Error(`PAGES_TEST_SITE_OUTPUT is not a directory: ${output}`);
    }
    return output;
  }

  pendingOutput ??= buildPrivateOutput();
  return pendingOutput;
}

async function buildPrivateOutput(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pages-site-test-"));
  privateOutput = temporaryRoot;
  const output = path.join(temporaryRoot, "site");
  try {
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, "node_modules/@11ty/eleventy/cmd.cjs"),
      `--output=${output}`,
    ], {
      cwd: repositoryRoot,
      env: { ...process.env, ELEVENTY_RUN_MODE: "build" },
    });
    return output;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    privateOutput = undefined;
    pendingOutput = undefined;
    throw error;
  }
}

// Runner-owned output is cleaned up by the runner. Only remove this helper's
// private focused-run output, once the importing test file has finished.
after(async () => {
  if (privateOutput) {
    await rm(privateOutput, { recursive: true, force: true });
    privateOutput = undefined;
  }
});
