// Use the same coordinate systems before and after JavaScript loads. The SVG
// scales within each tier; container queries select the matching static layout.
export const CHART_LAYOUTS = [
  { name: "compact", minWidth: 0, width: 320 },
  { name: "medium", minWidth: 500, width: 560 },
  { name: "wide", minWidth: 760, width: 896 },
];

/** @param {number} availableWidth */
export function chartSize(availableWidth) {
  const layout = CHART_LAYOUTS.findLast((item) => availableWidth >= item.minWidth) ?? CHART_LAYOUTS[0];
  return { width: layout.width, height: Math.max(400, Math.round(layout.width * 0.56)) };
}
