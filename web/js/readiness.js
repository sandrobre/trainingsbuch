// App readiness ("Bereitschaft"): an own 0–100 score for watches without Garmin Training Readiness.
// Weights follow the strength of the scientific evidence for each building block (see READINESS_SOURCES);
// they are a reasoned ranking, not a fitted model. After enough data, calibrate() checks per athlete
// which factors actually go along with next-day well-being and suggests adjusted weights.
import { addDays, daysBetween, avg } from './util.js';
import { checkinScore } from './training.js';
import { loadRatio } from './planning.js';

export const READINESS_FACTORS = [
  // key, label, default weight (%), short explanation
  ['checkin', 'Check-in (Befinden)', 30, 'Energie, Schlafgefühl, Muskeln, Stress und Schmerz von heute'],
  ['hrv', 'HRV-Trend', 25, 'Ø der letzten 7 Nächte im Vergleich zu deinem Normalbereich'],
  ['sleep', 'Schlaf letzte Nacht', 15, 'Garmin-Schlafscore, sonst Schlafdauer'],
  ['sleep3', 'Schlaf 3 Nächte', 10, 'Durchschnitt der letzten drei Nächte'],
  ['load', 'Belastung', 10, 'Trainingslast 7 Tage im Vergleich zu 4 Wochen'],
  ['stress', 'Stress 3 Tage', 10, 'Garmin-Stress, Tagesschnitt der letzten drei Tage'],
];
export const DEFAULT_WEIGHTS = Object.fromEntries(READINESS_FACTORS.map(([k, , w]) => [k, w]));

export const READINESS_LEVEL = (s) => (s >= 85 ? 'Sehr bereit' : s >= 70 ? 'Bereit' : s >= 50 ? 'Mittel' : s >= 30 ? 'Eingeschränkt' : 'Erholung');

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const lerp = (x, x0, y0, x1, y1) => y0 + ((clamp(x, Math.min(x0, x1), Math.max(x0, x1)) - x0) / (x1 - x0)) * (y1 - y0);

/** Sleep sub-score: Garmin sleep score if available, else duration (≥ 8 h = 100, 7 h = 85, 6 h = 60, 5 h = 35). */
function sleepNight(d) {
  if (!d) return null;
  if (typeof d.sleepScore === 'number') return clamp(d.sleepScore);
  if (typeof d.sleepH !== 'number') return null;
  const h = d.sleepH;
  if (h >= 8) return 100;
  if (h >= 7) return lerp(h, 7, 85, 8, 100);
  if (h >= 6) return lerp(h, 6, 60, 7, 85);
  if (h >= 5) return lerp(h, 5, 35, 6, 60);
  return lerp(h, 4, 10, 5, 35);
}

/** Check-in sub-score: average of the four 1–5 scales mapped to 0–100, capped by pain and illness. */
function checkinPart(c) {
  const s = checkinScore(c);
  if (s == null && !c?.sick && !c?.pain) return null;
  let v = s == null ? 70 : ((s - 1) / 4) * 100;
  const notes = [];
  if (c.pain > 5) { v = Math.min(v, 20); notes.push(`Schmerz ${c.pain}/10`); } else if (c.pain >= 3) { v -= 15; notes.push(`Schmerz ${c.pain}/10`); }
  if (c.sick) { v = Math.min(v, 10); notes.push('krank'); }
  return { value: clamp(v), detail: `${s != null ? `Ø ${s.toFixed(1)} von 5` : ''}${notes.length ? `${s != null ? ' · ' : ''}${notes.join(', ')}` : ''}` };
}

/**
 * HRV sub-score after Plews et al.: 7-night rolling mean against the individual normal range.
 * Normal range = Garmin's HRV baseline if present, else own 60-day mean ± 0.5 SD (smallest worthwhile change).
 */
function hrvPart(byDate, day) {
  const last7 = Array.from({ length: 7 }, (_, i) => byDate.get(addDays(day, -i))?.hrv).filter((v) => typeof v === 'number');
  if (last7.length < 4) return null;
  const roll = avg(last7);
  const today = byDate.get(day);
  let lo = today?.hrvBaseLow;
  let hi = today?.hrvBaseHigh;
  let src = 'Garmin-Normalbereich';
  if (!(lo && hi)) {
    const hist = Array.from({ length: 60 }, (_, i) => byDate.get(addDays(day, -7 - i))?.hrv).filter((v) => typeof v === 'number');
    if (hist.length < 14) return null;
    const m = avg(hist);
    const sd = Math.sqrt(avg(hist.map((v) => (v - m) ** 2)));
    lo = m - 0.5 * sd; hi = m + 0.5 * sd; src = 'eigener 60-Tage-Bereich';
  }
  const w = Math.max(1, hi - lo);
  let v;
  if (roll >= (lo + hi) / 2) v = 100;
  else if (roll >= lo) v = lerp(roll, lo, 70, (lo + hi) / 2, 100);
  else v = clamp(70 - (70 * (lo - roll)) / w);
  // a single very low night pulls the score down a little more
  const lastNight = byDate.get(day)?.hrv;
  if (typeof lastNight === 'number' && lastNight < lo - w / 2) v -= 10;
  return { value: clamp(v), detail: `7-Tage-Ø ${Math.round(roll)} ms · Bereich ${Math.round(lo)}–${Math.round(hi)} ms (${src})` };
}

function loadPart(acts, day) {
  const r = loadRatio(acts.filter((a) => a.date <= day), day);
  if (!r.reliable || r.ratio == null) return null;
  const x = r.ratio;
  const v = x <= 1.3 ? (x < 0.8 ? 90 : 100) : x <= 1.5 ? lerp(x, 1.3, 100, 1.5, 50) : lerp(x, 1.5, 50, 2, 0);
  return { value: clamp(v), detail: `Faktor ${x.toFixed(2)} (günstig ca. 0.8–1.3)` };
}

function stressPart(byDate, day) {
  const vals = [0, 1, 2].map((i) => byDate.get(addDays(day, -i))?.stress).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  const m = avg(vals);
  return { value: clamp(lerp(m, 25, 100, 75, 0)), detail: `Ø ${Math.round(m)} (Garmin 0–100)` };
}

/**
 * Readiness for one day. Missing factors are left out and the remaining weights scaled up.
 * Needs at least one of check-in / HRV / sleep and 50 % of the total weight.
 */
export function computeReadiness({ day, byDate, checkins = {}, acts = [], weights = DEFAULT_WEIGHTS }) {
  const night = byDate.get(day);
  const s1 = sleepNight(night);
  const s3vals = [0, 1, 2].map((i) => sleepNight(byDate.get(addDays(day, -i)))).filter((v) => v != null);
  const ci = checkins[day] ? checkinPart(checkins[day]) : null;
  const parts = {
    checkin: ci,
    hrv: hrvPart(byDate, day),
    sleep: s1 != null ? { value: s1, detail: typeof night?.sleepScore === 'number' ? `Schlafscore ${night.sleepScore}${night.sleepH ? ` · ${Math.floor(night.sleepH)}:${String(Math.round((night.sleepH % 1) * 60)).padStart(2, '0')} h` : ''}` : `${night.sleepH.toFixed(1)} h (kein Schlafscore)` } : null,
    sleep3: s3vals.length >= 2 ? { value: avg(s3vals), detail: `${s3vals.length} Nächte` } : null,
    load: loadPart(acts, day),
    stress: stressPart(byDate, day),
  };
  const present = READINESS_FACTORS.filter(([k]) => parts[k]);
  const wSum = present.reduce((s, [k]) => s + (weights[k] ?? 0), 0);
  const core = ['checkin', 'hrv', 'sleep'].some((k) => parts[k]);
  const total = READINESS_FACTORS.reduce((s, [k]) => s + (weights[k] ?? 0), 0);
  if (!core || wSum < total * 0.5) return { day, score: null, parts, missing: READINESS_FACTORS.filter(([k]) => !parts[k]).map(([, l]) => l) };
  const score = Math.round(present.reduce((s, [k]) => s + parts[k].value * (weights[k] ?? 0), 0) / wSum);
  return {
    day, score, level: READINESS_LEVEL(score), parts, coverage: Math.round((wSum / total) * 100),
    missing: READINESS_FACTORS.filter(([k]) => !parts[k]).map(([, l]) => l),
  };
}

/** Readiness for a range of days (oldest first). */
export function readinessSeries({ days, daily, checkins, acts, weights }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  return days.map((day) => computeReadiness({ day, byDate, checkins, acts, weights }));
}

const pearson = (xs, ys) => {
  const mx = avg(xs); const my = avg(ys);
  let n = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
};

/**
 * Individual calibration: how strongly does each factor (day d) go along with the next day's
 * well-being (check-in of day d+1, without its own check-in factor)? Needs ≥ 42 day pairs.
 * Suggested weight = default weight × (0.5 + r⁺), renormalised to 100 – i.e. it moves the
 * evidence-based starting point towards what holds for this athlete instead of replacing it.
 */
export function calibrate({ daily, checkins, acts, endDay, lookbackDays = 120 }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const rows = [];
  for (let i = lookbackDays; i >= 1; i--) {
    const day = addDays(endDay, -i);
    const next = checkinScore(checkins[addDays(day, 1)]);
    if (next == null) continue;
    const r = computeReadiness({ day, byDate, checkins, acts });
    rows.push({ parts: r.parts, next });
  }
  const result = READINESS_FACTORS.map(([k, label, w]) => {
    const pairs = rows.filter((x) => x.parts[k]);
    // the check-in can't be calibrated against the next check-in (same measure → circular): it keeps its weight
    const r = k !== 'checkin' && pairs.length >= 20 ? pearson(pairs.map((x) => x.parts[k].value), pairs.map((x) => x.next)) : null;
    return { key: k, label, weight: w, n: pairs.length, r, fixed: k === 'checkin' };
  });
  const enough = rows.length >= 42;
  const fixed = result.filter((x) => x.fixed).reduce((s2, x) => s2 + x.weight, 0);
  const free = result.filter((x) => !x.fixed);
  const raw = free.map((x) => x.weight * (0.5 + Math.max(0, x.r ?? 0.25)));
  const sum = raw.reduce((a, b) => a + b, 0);
  result.forEach((x) => { x.suggested = x.fixed ? x.weight : Math.round((raw[free.indexOf(x)] / sum) * (100 - fixed)); });
  return { enough, days: rows.length, factors: result };
}

export const READINESS_SOURCES = [
  ['Saw, Main & Gastin 2016 (BJSM): Befinden zeigt Trainingsreaktion empfindlicher als Messwerte', 'https://bjsm.bmj.com/content/50/5/281'],
  ['Plews et al. 2013: HRV-Trend (7-Tage-Schnitt) bei Ausdauersportlern', 'https://openrepository.aut.ac.nz/handle/10292/7122'],
  ['Düking et al. 2021 (JSAMS): HRV-gesteuertes Training, Meta-Analyse', 'https://pubmed.ncbi.nlm.nih.gov/34489178/'],
  ['Meta-Analyse 2022 (EJSS): Schlafmangel und Ausdauerleistung', 'https://lida.sport-iat.de/ta/Record/4082963?lng=en'],
  ['Impellizzeri et al. 2020: Kritik an der Belastungs-Ratio (ACWR)', 'https://simplifaster.com/articles/acwr-high-performance-tool/'],
  ['Übersicht 2025: Bereitschaftswerte von Wearables sind kaum validiert', 'https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html'],
];
