---
title: Example chart
date: 2026-10-01
description: A small illustration of inline SVG in Markdown.
---

This chart uses **illustrative values**, not measured data.

<figure>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" role="img" aria-labelledby="chart-title chart-desc">
  <title id="chart-title">Example bar chart</title>
  <desc id="chart-desc">Illustrative values: A is 20, B is 35, and C is 50.</desc>
  <g fill="currentColor" font-family="system-ui, sans-serif" font-size="18">
    <text x="20" y="55">A</text>
    <text x="20" y="120">B</text>
    <text x="20" y="185">C</text>
    <text x="250" y="55">20</text>
    <text x="385" y="120">35</text>
    <text x="520" y="185">50</text>
  </g>
  <g fill="#5489c4">
    <rect x="60" y="30" width="180" height="35" rx="3" />
    <rect x="60" y="95" width="315" height="35" rx="3" />
    <rect x="60" y="160" width="450" height="35" rx="3" />
  </g>
</svg>
<figcaption>Illustrative values for three categories.</figcaption>
</figure>

More Markdown can follow the chart, including [links](https://www.11ty.dev/)
and explanations of the data.
