import assert from "node:assert/strict";
import { it } from "node:test";
import { estimateQuarter } from "../estimates.ts";

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

it("converts constant annual run rates using actual calendar-quarter durations", () => {
  const points = [{ date: "2026-01-01", value: 365 }, { date: "2026-10-01", value: 365 }];
  for (const [end, days] of [["2026-03-31", 90], ["2026-06-30", 91], ["2026-09-30", 92]] as const) {
    const estimate = estimateQuarter(points, end);
    close(estimate.value, days);
    assert.equal(estimate.extrapolated, false);
  }
});

it("integrates every segment, including milestones inside a quarter", () => {
  const points = [
    { date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 365 },
    { date: "2026-04-01", value: 0 },
  ];
  close(estimateQuarter(points, "2026-03-31").value, 45);
  // Interpolate at quarter boundaries rather than rounding to milestone dates.
  close(estimateQuarter([
    { date: "2025-12-31", value: 0 }, { date: "2026-04-02", value: 365 },
  ], "2026-03-31").value, 45);
});

it("uses the final two milestones for linear extrapolation, not a flat carry-forward", () => {
  const points = [{ date: "2026-07-01", value: 365 }, { date: "2026-07-31", value: 730 }];
  const estimate = estimateQuarter(points, "2026-09-30");
  close(estimate.value, 92 + 92 ** 2 / 60);
  assert.equal(estimate.extrapolated, true);
  const reversed = [...points].reverse();
  assert.deepEqual(estimateQuarter(reversed, "2026-09-30"), estimate);
  assert.equal(reversed[0]!.date, "2026-07-31", "do not mutate source order");
});

it("uses the leap-year denominator when applicable", () => {
  close(estimateQuarter([
    { date: "2024-01-01", value: 366 }, { date: "2024-04-01", value: 366 },
  ], "2024-03-31").value, 91);
});

it("rejects invalid boundaries, insufficient coverage, and invalid milestones", () => {
  const points = [{ date: "2026-01-01", value: 1 }, { date: "2026-04-01", value: 2 }];
  for (const date of ["invalid", "2026-03-30"]) {
    assert.throws(() => estimateQuarter(points, date), /quarter.end/);
  }
  for (const invalid of [[], [points[0]!], [points[0]!, points[0]!],
    [points[0]!, { date: "invalid", value: 1 }], [points[0]!, { date: "2026-04-01", value: NaN }]]) {
    assert.throws(() => estimateQuarter(invalid, "2026-03-31"), /milestones/);
  }
  assert.throws(() => estimateQuarter([
    { date: "2026-02-01", value: 1 }, points[1]!,
  ], "2026-03-31"), /cover/);
});
