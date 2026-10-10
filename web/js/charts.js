// Lightweight responsive charts. Bars are HTML (crisp text at any width); lines are an SVG path
// stretched to the plot (non-scaling stroke) with HTML labels, dots and hover targets on top.
import { esc, sportColor } from './util.js';

function niceStep(range, targetTicks = 4) {
  const raw = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
}

/** Stacked (or single) vertical bars. cols: [{label, tip, segments: [{type, value, color?}]}] */
export function bars(cols, { height = 170, unit = '', color } = {}) {
  const totals = cols.map((c) => c.segments.reduce((s, x) => s + x.value, 0));
  const step = niceStep(Math.max(...totals, 1));
  const max = Math.max(step, Math.ceil(Math.max(...totals, 1) / step) * step);
  const ticks = [];
  for (let t = step; t <= max; t += step) ticks.push(t);

  return `<div class="chart bars" style="--h:${height}px">
    <div class="plot">
      ${ticks.map((t) => `<span class="gridline" style="bottom:${(t / max) * 100}%"><em>${t}${unit && t === max ? ` ${unit}` : ''}</em></span>`).join('')}
      <div class="bar-cols">
        ${cols.map((c, i) => `
          <div class="bar-col" tabindex="0" data-tip="${esc(c.tip)}">
            <div class="bar-stack" style="height:${(totals[i] / max) * 100}%">
              ${c.segments.filter((s) => s.value > 0).map((s) => `<i style="flex-grow:${s.value};background:${s.color || color || sportColor(s.type)}"></i>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div class="x-labels">${cols.map((c) => `<span>${esc(c.label)}</span>`).join('')}</div>
  </div>`;
}

/**
 * Line chart. points: [{x:number, y:number, tip:string}] sorted by x.
 * opts.invert draws smaller values higher (e.g. running pace). opts.xLabels: [{x, label}].
 */
export function line(points, { height = 170, color = 'var(--s-run)', yFormat = (v) => v, invert = false, xLabels = [], band, area = true, steps } = {}) {
  if (points.length < 2) return `<p class="empty-chart">Noch zu wenig Daten für einen Verlauf.</p>`;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let lo = Math.min(...ys, band?.lo ?? Infinity);
  let hi = Math.max(...ys, band?.hi ?? -Infinity);
  const step = steps ? steps.find((st) => (hi - lo) / st <= 4) || steps.at(-1) : niceStep(hi - lo || 1, 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;

  const px = (x) => 3 + ((x - x0) / (x1 - x0 || 1)) * 94;
  const py = (y) => { const t = (y - lo) / (hi - lo); return 6 + (invert ? t : 1 - t) * 88; };
  const pts = points.map((p) => [px(p.x), py(p.y)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 10).toFixed(1)} ${(y * 10).toFixed(1)}`).join(' ');
  const areaD = `${d} L${(pts.at(-1)[0] * 10).toFixed(1)} 1000 L${(pts[0][0] * 10).toFixed(1)} 1000 Z`;

  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);

  const hits = pts.map(([x, y], i) => {
    const left = i === 0 ? 0 : (pts[i - 1][0] + x) / 2;
    const right = i === pts.length - 1 ? 100 : (x + pts[i + 1][0]) / 2;
    const w = right - left;
    return `<div class="line-hit" tabindex="0" data-tip="${esc(points[i].tip)}" style="left:${left}%;width:${w}%;--px:${((x - left) / w) * 100}%;--py:${y}%"></div>`;
  }).join('');

  const bandEl = band ? `<div class="line-band" style="top:${Math.min(py(band.lo), py(band.hi))}%;height:${Math.abs(py(band.lo) - py(band.hi))}%"></div>` : '';
  const [lx, ly] = pts.at(-1);

  return `<div class="chart line" style="--h:${height}px;--c:${color}">
    <div class="plot">
      ${ticks.map((t) => `<span class="gridline" style="top:${py(t)}%"><em>${esc(yFormat(t))}</em></span>`).join('')}
      ${bandEl}
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        ${area ? `<path class="line-area" d="${areaD}"/>` : ''}
        <path class="line-path" d="${d}" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="line-dot" style="left:${lx}%;top:${ly}%"></span>
      ${hits}
    </div>
    <div class="x-labels positioned">${xLabels.map((l) => `<span style="left:${px(l.x)}%">${esc(l.label)}</span>`).join('')}</div>
  </div>`;
}

/** Tiny trend line for stat tiles (no axes, no interaction). */
export function sparkline(values, color = 'currentColor') {
  const clean = values.map((v, i) => [i, v]).filter(([, v]) => typeof v === 'number');
  if (clean.length < 2) return '';
  const ys = clean.map(([, v]) => v);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const n = values.length - 1 || 1;
  const pts = clean.map(([i, v]) => [(i / n) * 100, 90 - ((v - lo) / (hi - lo || 1)) * 80]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts.at(-1);
  return `<div class="spark" style="--c:${color}">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>
    <span style="left:${lx}%;top:${ly}%"></span>
  </div>`;
}

/** Circular score (0–100). */
export function ring(score, { label = '', size = 132, color = 'var(--accent)' } = {}) {
  const value = Math.max(0, Math.min(100, Math.round(score ?? 0)));
  return `<div class="ring" style="--p:${value};--size:${size}px;--c:${color}" role="img" aria-label="${esc(label)} ${value} von 100">
    <div class="ring-inner"><strong>${score == null ? '–' : value}</strong><span>${esc(label)}</span></div>
  </div>`;
}

/** Horizontal bars: items [{label, value, display, color}] */
export function hbars(items, { max } = {}) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar" data-tip="${esc(i.tip || `${i.label}: ${i.display}`)}">
      <span class="hbar-label">${esc(i.label)}</span>
      <span class="hbar-track"><i style="width:${(i.value / top) * 100}%;background:${i.color}"></i></span>
      <span class="hbar-value">${esc(i.display)}</span>
    </div>`).join('')}</div>`;
}

export function legend(types, labels) {
  return `<div class="legend">${types.map((t) => `<span><i style="background:${sportColor(t)}"></i>${esc(labels[t])}</span>`).join('')}</div>`;
}
