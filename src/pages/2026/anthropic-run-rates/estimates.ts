interface RunRatePoint {
  date: string;
  value: number;
}

/** Integrate annualized $B over a UTC calendar quarter to estimate earned $B. */
export function estimateQuarter(runRate: readonly RunRatePoint[], quarterEnd: string) {
  const date = new Date(`${quarterEnd}T00:00:00Z`);
  if (!Number.isFinite(+date)) throw new TypeError("Invalid quarter end.");
  const year = date.getUTCFullYear();
  const month = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = Date.UTC(year, month, 1);
  const end = Date.UTC(year, month + 3, 1);
  const day = 86_400_000;
  if (+date !== end - day) throw new TypeError("Expected a calendar quarter-end date.");
  const points = runRate.map((point) => ({
    time: +new Date(`${point.date}T00:00:00Z`), value: point.value,
  })).sort((a, b) => a.time - b.time);
  if (points.length < 2 || points.some((point, index) =>
    !Number.isFinite(point.time) || !Number.isFinite(point.value) || point.value < 0 ||
    (index > 0 && point.time === points[index - 1]!.time))) {
    throw new TypeError("Expected at least two distinct, valid run-rate milestones.");
  }
  if (start < points[0]!.time) throw new RangeError("Run-rate data must cover the quarter's start.");

  function rateAt(time: number) {
    const right = points.findIndex((point) => point.time >= time);
    // After the last milestone, continue the slope of the final two points.
    const index = right < 0 ? points.length - 1 : Math.max(1, right);
    const a = points[index - 1]!;
    const b = points[index]!;
    return a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
  }

  const boundaries = [start, ...points.filter((point) => point.time > start && point.time < end)
    .map((point) => point.time), end];
  let area = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1]!;
    const b = boundaries[i]!;
    area += (rateAt(a) + rateAt(b)) / 2 * (b - a);
  }
  const yearDuration = Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1);
  return { value: area / yearDuration, extrapolated: end > points.at(-1)!.time };
}
