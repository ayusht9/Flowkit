// Dependency-free SVG charts for the benchmark report. Each SVG carries light and dark palettes
// (prefers-color-scheme), so it reads correctly in GitHub's light and dark themes.
// Palette: validated categorical slots 1-3 (blue, orange, aqua) from the data-viz reference palette.

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const textWidth = (text, size = 12) => String(text).length * size * 0.56;

const style = `<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#8a8984; --grid:#e6e5e0; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --muted:#8f8e86; --grid:#33332f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; } }
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--ink2); }
  .title { font-size: 16px; font-weight: 600; fill: var(--ink); }
  .sub { font-size: 12px; fill: var(--ink2); }
  .label { font-size: 12px; fill: var(--ink); }
  .value { font-size: 11px; fill: var(--ink2); font-variant-numeric: tabular-nums; }
  .axis { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .bg { fill: var(--surface); }
</style>`;

// Bar with a 4px rounded data end and a square baseline end.
function bar(x, y, w, h, color, tip) {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return "";
  const d = `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
  return `<path d="${d}" fill="var(${color})"><title>${escape(tip)}</title></path>`;
}

function legend(items, x, y) {
  let offset = 0;
  return items.map(([name, color]) => {
    const out = `<rect x="${x + offset}" y="${y - 9}" width="10" height="10" rx="2" fill="var(${color})"/><text class="sub" x="${x + offset + 15}" y="${y}">${escape(name)}</text>`;
    offset += 15 + textWidth(name) + 22;
    return out;
  }).join("");
}

function niceMax(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * power).find((m) => m >= value * 1.04);
}

// Tick count that keeps clean steps for the chosen maximum.
function ticks(max) {
  const lead = max / 10 ** Math.floor(Math.log10(max));
  const count = { 1: 5, 1.2: 4, 1.5: 3, 2: 4, 2.5: 5, 3: 3, 4: 4, 5: 5, 6: 3, 8: 4, 10: 5 }[Number(lead.toFixed(1))] || 4;
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/** Horizontal bars; `series` = [[name, colorVar, key]], rows = [{ label, ...values }]. */
export function horizontalBars({ title, subtitle, rows, series, unit = "tokens", width = 880, labelWidth }) {
  const barH = series.length > 1 ? 12 : 16, gap = 2, rowGap = series.length > 1 ? 14 : 10;
  labelWidth ??= Math.min(320, Math.max(...rows.map((r) => textWidth(r.label))) + 16);
  const top = 64 + (series.length > 1 ? 22 : 0), left = labelWidth, right = 70;
  const rowH = series.length * barH + (series.length - 1) * gap + rowGap;
  const height = top + rows.length * rowH + 30;
  const max = niceMax(Math.max(...rows.flatMap((r) => series.map(([, , k]) => r[k] ?? 0))));
  const plotW = width - left - right;
  const scale = (v) => (v / max) * plotW;
  const grid = ticks(max).map((t) => `<line class="grid" x1="${left + scale(t)}" x2="${left + scale(t)}" y1="${top - 6}" y2="${height - 26}"/><text class="axis" x="${left + scale(t)}" y="${height - 10}" text-anchor="middle">${fmt(t)}</text>`).join("");
  const body = rows.map((row, i) => {
    const y = top + i * rowH;
    const label = `<text class="label" x="${left - 10}" y="${y + (series.length * barH + (series.length - 1) * gap) / 2 + 4}" text-anchor="end">${escape(row.label)}</text>`;
    const bars = series.map(([name, color, key], j) => {
      const v = row[key]; if (v == null) return "";
      const by = y + j * (barH + gap), w = Math.max(1, scale(v));
      return bar(left, by, w, barH, color, `${row.label} — ${name}: ${fmt(v)} ${unit}`) +
        `<text class="value" x="${left + w + 6}" y="${by + barH / 2 + 4}">${fmt(v)}</text>`;
    }).join("");
    return label + bars;
  }).join("");
  return svg(width, height, title, subtitle, grid + body + (series.length > 1 ? legend(series.map(([n, c]) => [n, c]), left, 74) : ""));
}

/** Line chart over a shared x scale; `series` = [[name, colorVar, key]]. */
export function lineChart({ title, subtitle, rows, xKey, series, xLabel, unit = "tokens", width = 880, height = 380 }) {
  const top = 86, left = 64, right = 150, bottom = 48;
  const plotW = width - left - right, plotH = height - top - bottom;
  const xMax = Math.max(...rows.map((r) => r[xKey]));
  const yMax = niceMax(Math.max(...rows.flatMap((r) => series.map(([, , k]) => r[k]))));
  const x = (v) => left + (v / xMax) * plotW, y = (v) => top + plotH - (v / yMax) * plotH;
  const grid = ticks(yMax).map((t) => `<line class="grid" x1="${left}" x2="${left + plotW}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${left - 8}" y="${y(t) + 4}" text-anchor="end">${t >= 10000 ? `${t / 1000}K` : fmt(t)}</text>`).join("");
  const xTicks = rows.map((r) => `<text class="axis" x="${x(r[xKey])}" y="${top + plotH + 18}" text-anchor="middle">${r[xKey]}</text>`).join("") +
    `<text class="sub" x="${left + plotW / 2}" y="${height - 8}" text-anchor="middle">${escape(xLabel)}</text>`;
  const ends = series.map(([, , k]) => y(rows.at(-1)[k]));
  // Keep end labels from colliding: push apart to at least 16px.
  const order = ends.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < order.length; i++) if (order[i][0] - order[i - 1][0] < 16) order[i][0] = order[i - 1][0] + 16;
  const labelY = []; order.forEach(([v, i]) => { labelY[i] = v; });
  const lines = series.map(([name, color, key], i) => {
    const points = rows.map((r) => `${x(r[xKey]).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ");
    const dots = rows.map((r) => `<circle cx="${x(r[xKey])}" cy="${y(r[key])}" r="4" fill="var(${color})" stroke="var(--surface)" stroke-width="2"><title>${escape(`${name}, ${r[xKey]} tasks: ${fmt(r[key])} ${unit}`)}</title></circle>`).join("");
    const last = rows.at(-1);
    return `<polyline points="${points}" fill="none" stroke="var(${color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}` +
      `<text class="value" x="${x(last[xKey]) + 10}" y="${labelY[i] + 4}">${escape(name)} · ${fmt(last[key])}</text>`;
  }).join("");
  return svg(width, height, title, subtitle, grid + xTicks + lines + legend(series.map(([n, c]) => [n, c]), left, 74));
}

function svg(width, height, title, subtitle, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${escape(title)}</title><desc id="d">${escape(subtitle || "")}</desc>
${style}
<rect class="bg" width="${width}" height="${height}" rx="10"/>
<text class="title" x="20" y="30">${escape(title)}</text>
${subtitle ? `<text class="sub" x="20" y="50">${escape(subtitle)}</text>` : ""}
${content}
</svg>
`;
}
