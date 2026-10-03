import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extract, mainlineVersion, versionsBetween } from "../src/pages/2026/kernel-cve-fixes/update-data.ts";

test("normalizes mainline rc versions and excludes stable backports", () => {
  assert.equal(mainlineVersion("6.12-rc3", "fixture", 1), "6.12");
  assert.equal(mainlineVersion("6.12", "fixture", 1), "6.12");
  assert.equal(mainlineVersion("6.12.4", "fixture", 1), undefined);
  assert.equal(mainlineVersion("2.6.39.2", "fixture", 1), undefined);
  assert.equal(mainlineVersion("0", "fixture", 1), undefined);
  assert.throws(() => mainlineVersion("bad", "fixture", 1), /Malformed fixed version/);
});

test("uses only observed releases for coverage", () => {
  const result = versionsBetween("6.9", "7.2", new Set(["6.9", "6.12", "7.2"]));
  assert.deepEqual(result, ["6.9", "6.12", "7.2"]);
});

test("includes an observed future-major release without synthesizing versions", () => {
  const result = versionsBetween("6.9", "8.0", new Set(["6.9", "7.2", "8.0"]));
  assert.deepEqual(result, ["6.9", "7.2", "8.0"]);
});

test("rejects a cutoff not observed in published dyads", () => {
  assert.throws(
    () => versionsBetween("6.9", "8.2", new Set(["6.9", "7.2", "8.0"])),
    /--through 8\.2 was not observed/,
  );
});

async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "kernel-cves-"));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  const year = path.join(repo, "cve", "published", "2026");
  await mkdir(year, { recursive: true });
  return { repo, year };
}

test("counts distinct published CVEs per release and reports missing dyads", async () => {
  const { repo, year } = await fixture();
  try {
    for (const id of ["CVE-2026-10001", "CVE-2026-10002", "CVE-2026-10003"]) {
      await writeFile(path.join(year, `${id}.json`), JSON.stringify({ cveMetadata: { cveId: id } }));
    }
    const sha = "a".repeat(40);
    await writeFile(path.join(year, "CVE-2026-10001.dyad"), [
      "# comment",
      `0:0:6.9-rc2:${sha}`,
      `0:0:6.9:${sha}`,
      `0:0:6.9:${sha}`,
      `0:0:6.10.2:${sha}`,
      `0:0:2.6.39.2:${sha}`,
      `0:0:7.1:${sha}`,
    ].join("\n"));
    await writeFile(path.join(year, "CVE-2026-10002.dyad"), `0:0:7.1-rc1:${sha}\n`);
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
    const data = await extract(repo, "7.1");
    assert.equal(data.metadata.coverage.publishedCves, 3);
    assert.deepEqual(data.metadata.coverage.missingDyadIds, ["CVE-2026-10003"]);
    assert.equal(data.metadata.asOf, execFileSync("git", ["-C", repo, "show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }).trim());
    assert.deepEqual(data.releases.filter((r) => r.count), [
      { version: "6.9", count: 1 },
      { version: "7.1", count: 2 },
    ]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("malformed dyad rows fail extraction instead of being silently skipped", async () => {
  const { repo, year } = await fixture();
  try {
    await writeFile(path.join(year, "CVE-2026-10001.json"), "{}");
    await writeFile(path.join(year, "CVE-2026-10001.dyad"), "malformed:row");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
    await assert.rejects(extract(repo, "7.2"), /Malformed dyad row/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("refuses an uncommitted published-data tree", async () => {
  const { repo, year } = await fixture();
  try {
    await writeFile(path.join(year, "CVE-2026-10001.json"), "{}");
    await writeFile(path.join(year, "CVE-2026-10001.dyad"), "");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
    await writeFile(path.join(year, "CVE-2026-10001.dyad"), "uncommitted");
    await assert.rejects(extract(repo, "7.2"), /Refusing dirty cve\/published tree/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
