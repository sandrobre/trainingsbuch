// Planning logic without UI: limits & traffic light, weekly plan (own + fixed + Garmin), race estimate,
// streaks, swim library, evaluation start weights and calendar (.ics) export.
import { todayISO, addDays, daysBetween, weekStart, parseDay } from './util.js';
import { checkinScore } from './training.js';

// ── limits ──
export const LIMIT_KIND = { injury: 'Verletzt / Schmerzen', ill: 'Krank', tired: 'Erschöpft' };
export const LIMIT_SHORT = { injury: 'Verletzt', ill: 'Krank', tired: 'Erschöpft' };
export const AFFECTS = { run: 'Laufen', swim: 'Schwimmen', liftUpper: 'Kraft Oberkörper', liftLower: 'Kraft Unterkörper', cycle: 'Rad' };
const UPPER = ['Brust', 'Rücken', 'Schultern', 'Arme'];
const LOWER = ['Beine', 'Gesäss & Hüfte', 'Prävention & Sprung'];

export const activeLimits = (limits = [], day = todayISO()) =>
  limits.filter((l) => !l.resolved && l.from <= day && (!l.to || l.to >= day));

/** Which body parts a strength template trains. */
export function templateParts(tpl, catalog) {
  if (!tpl) return { upper: true, lower: true };
  const groups = tpl.items.map((i) => catalog.find((e) => e.id === i.id)?.group);
  return { upper: groups.some((g) => UPPER.includes(g)), lower: groups.some((g) => LOWER.includes(g)) };
}

/** Limits that affect a planned session. */
export function conflicts(item, limits, templates, catalog) {
  return activeLimits(limits, item.date).filter((l) => {
    const a = l.affects || [];
    if (l.kind === 'ill') return true;
    if (item.sport === 'strength') {
      const p = templateParts(templates.find((t) => t.id === item.templateId), catalog);
      return (p.upper && a.includes('liftUpper')) || (p.lower && a.includes('liftLower'));
    }
    return a.includes(item.sport);
  });
}

// ── load & traffic light ──
const sessionLoad = (a) => (a.durationMin || 0) * (a.rpe || 5);

export function loadRatio(acts, day = todayISO()) {
  let acute = 0; let c28 = 0; let first = null;
  for (const a of acts) {
    const d = daysBetween(a.date, day);
    if (d < 0) continue;
    if (d <= 6) acute += sessionLoad(a);
    if (d <= 27) c28 += sessionLoad(a);
    if (!first || a.date < first) first = a.date;
  }
  const chronic = c28 / 4;
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio: chronic > 0 ? acute / chronic : null, reliable: !!first && daysBetween(first, day) >= 21 };
}

export function trainingDayStreak(acts, day = todayISO()) {
  const days = new Set(acts.map((a) => a.date));
  let t = days.has(day) ? day : addDays(day, -1);
  let n = 0;
  while (days.has(addDays(t, -n)) && n < 60) n += 1;
  return n;
}

export function badCheckinStreak(checkins, day = todayISO()) {
  let t = checkins[day] ? day : addDays(day, -1);
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const s = checkinScore(checkins[addDays(t, -i)]);
    if (s != null && s < 2.5) n += 1; else break;
  }
  return n;
}

/**
 * Traffic light for today: green = ready, yellow = careful, red = recover.
 * Uses limits, check-ins (incl. pain, sick), own session-RPE load (or Garmin ACWR) and consecutive training days.
 */
export function trafficLight({ limits = [], checkins = {}, acts = [], snapshot = {}, day = todayISO() }) {
  const reasons = [];
  let lvl = 0;
  const set = (l, text) => { lvl = Math.max(lvl, l); reasons.push({ level: l, text }); };
  const lims = activeLimits(limits, day);
  lims.filter((l) => l.kind === 'ill').forEach((l) => set(2, `Krank gemeldet${l.fever ? ' mit Fieber oder Symptomen unterhalb des Halses' : ''}: Erholung hat Vorrang.`));
  lims.filter((l) => l.kind === 'injury').forEach((l) => set(1, `Verletzung${l.area ? ` (${l.area})` : ''}: betroffene Einheiten anpassen.`));
  lims.filter((l) => l.kind === 'tired').forEach(() => set(1, 'Erschöpfung gemeldet: heute nur locker.'));

  const ci = checkins[day] || checkins[addDays(day, -1)];
  if (ci?.sick) set(2, 'Im Check-in als krank markiert.');
  if (ci?.pain > 5) set(2, `Schmerz ${ci.pain}/10${ci.painWhere ? ` (${ci.painWhere})` : ''}: rot nach Schmerzampel, betroffene Belastung pausieren.`);
  else if (ci?.pain >= 3) set(1, `Schmerz ${ci.pain}/10${ci.painWhere ? ` (${ci.painWhere})` : ''}: gelb, Umfang oder Tempo reduzieren.`);
  const score = checkinScore(ci);
  const bad = badCheckinStreak(checkins, day);
  if (bad >= 3) set(2, `${bad} Tage in Folge schlechtes Befinden.`);
  else if (score != null && score < 2) set(2, `Befinden sehr tief (${score.toFixed(1)} von 5).`);
  else if (score != null && score < 2.75) set(1, `Befinden eher tief (${score.toFixed(1)} von 5).`);

  const garminAcwr = snapshot.trainingStatus?.acwr;
  const own = loadRatio(acts, day);
  const ratio = garminAcwr ?? (own.reliable ? own.ratio : null);
  if (ratio != null) {
    if (ratio > 1.5) set(2, `Belastung der letzten 7 Tage ${ratio.toFixed(2)}× so hoch wie der 4-Wochen-Schnitt.`);
    else if (ratio > 1.3) set(1, `Belastung steigt schnell (Faktor ${ratio.toFixed(2)}).`);
  }
  const streak = trainingDayStreak(acts, day);
  if (streak >= 6) set(1, `${streak} Trainingstage am Stück – ein Ruhetag ist fällig.`);
  const rd = snapshot.readiness;
  if (rd?.score != null && rd.score < 30) set(1, `Garmin Readiness tief (${rd.score}).`);

  if (!reasons.length) reasons.push({ level: 0, text: ratio != null ? `Keine Warnsignale, Belastung im grünen Bereich (Faktor ${ratio.toFixed(2)}).` : 'Keine Warnsignale.' });
  return { level: ['green', 'yellow', 'red'][lvl], label: ['Bereit', 'Vorsicht', 'Erholung'][lvl], reasons, ratio, streak };
}

// ── weekly plan: own entries + fixed weekly sessions + Garmin plan, with overrides ──
/**
 * manual.plan entries: {id, date, sport, title, templateId?, swimId?, note?, done?}
 * Overrides of generated entries carry `recurOf` (key of the generated entry) and may be `removed`.
 */
export function planItems({ plan = [], recurring = [], garminPlanned = [], from, to }) {
  const overridden = new Set(plan.filter((p) => p.recurOf).map((p) => p.recurOf));
  const out = plan.filter((p) => !p.removed && p.date >= from && p.date <= to).map((p) => ({ ...p, src: p.src || (p.recurOf?.startsWith('g:') ? 'garmin' : p.recurOf ? 'fix' : 'own') }));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = (parseDay(d).getDay() + 6) % 7; // 0 = Monday
    for (const r of recurring) {
      const key = `r:${r.id}:${d}`;
      if (r.weekday === wd && !overridden.has(key)) out.push({ id: key, key, date: d, sport: r.sport, title: r.title, templateId: r.templateId, src: 'fix' });
    }
  }
  for (const g of garminPlanned) {
    const key = `g:${g.id}`;
    if (g.date >= from && g.date <= to && !overridden.has(key)) {
      out.push({ id: key, key, date: g.date, sport: g.sport === 'other' && g.kind === 'race' ? 'run' : g.sport, title: g.title, durationMin: g.durationMin, distanceKm: g.distanceKm, note: g.description, plan: g.plan, race: g.kind === 'race', src: 'garmin' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.src === 'garmin' ? -1 : 1));
}

/** A planned session counts as done when it is ticked or an activity of that sport exists on that day. */
export const planDone = (item, acts) => !!item.done || acts.some((a) => a.date === item.date && (a.type === item.sport || (item.sport === 'mobility' && a.type === 'mobility')));

// ── race ──
export const HM_KM = 21.0975;
export const RACE_DISTANCES = { 5: '5 km', 10: '10 km', 21.0975: 'Halbmarathon', 42.195: 'Marathon' };

/** Riegel prediction from recent runs (≥ 5 km, last 8 weeks); easy runs are scaled by RPE. */
export function raceEstimate(acts, distanceKm = HM_KM, day = todayISO()) {
  let best = null;
  for (const a of acts) {
    if (a.type !== 'run' || !(a.distanceKm >= 5) || !(a.durationMin > 0)) continue;
    const d = daysBetween(a.date, day);
    if (d < 0 || d > 56) continue;
    // without RPE: guess from title / Garmin training effect (hard sessions are closer to race effort)
    const rpe = a.rpe || (/tempo|schwelle|intervall|threshold|interval/i.test(a.title || '') || a.aerobicTE >= 3.5 ? 8 : 6);
    const f = rpe >= 9 || /wettkampf|race|test/i.test(a.title || '') ? 1 : Math.max(0.88, 1 - Math.max(0, 8.5 - rpe) * 0.025);
    const sec = a.durationMin * 60 * f * (distanceKm / a.distanceKm) ** 1.06;
    if (!best || sec < best.sec) best = { sec, run: a, factor: f, rpe };
  }
  return best;
}

export function racePhase(race, day = todayISO()) {
  if (!race?.date) return null;
  const days = daysBetween(day, race.date);
  if (days < 0) return { days, label: 'Vorbei', text: 'Das Rennen liegt hinter dir – trag ein neues Ziel ein.' };
  if (days === 0) return { days, label: 'Renntag', text: 'Heute ist Renntag. Ruhig starten, die ersten Kilometer nicht schneller als die Zielpace.' };
  if (days <= 7) return { days, label: 'Rennwoche', text: 'Wenig Umfang, kurze Tempoanteile, viel Schlaf. Nichts Neues ausprobieren.' };
  if (days <= 17) return { days, label: 'Tapering', text: 'Umfang um 30–50 % senken, Intensität beibehalten. Keine schweren Beine mehr im Krafttraining.' };
  if (days <= 56) return { days, label: 'Spezifische Phase', text: 'Läufe im Renntempo und lange Läufe sind jetzt am wichtigsten.' };
  return { days, label: 'Aufbau', text: 'Grundlagenausdauer und Kraft aufbauen, Umfang langsam steigern (max. ca. 10 % pro Woche).' };
}

// ── streaks ──
export function weeklyGoalStreak(acts, weekly = {}, day = todayISO()) {
  const goals = Object.entries(weekly).filter(([, n]) => n > 0);
  if (!goals.length) return { current: 0, best: 0 };
  const reached = (wk) => goals.every(([t, n]) => acts.filter((a) => a.type === t && a.date >= wk && a.date < addDays(wk, 7)).length >= n);
  const first = acts.length ? weekStart(acts.reduce((m, a) => (a.date < m ? a.date : m), day)) : weekStart(day);
  let wk = weekStart(day);
  let current = 0;
  if (reached(wk)) current = 1;
  wk = addDays(wk, -7);
  let run = 0; let best = 0; let counting = true;
  for (; wk >= first; wk = addDays(wk, -7)) {
    if (reached(wk)) { run += 1; if (counting) current += 1; } else { counting = false; best = Math.max(best, run); run = 0; }
  }
  return { current, best: Math.max(best, run, current) };
}

export function dayStreak(isDone, day = todayISO()) {
  let t = isDone(day) ? day : addDays(day, -1);
  let n = 0;
  while (isDone(addDays(t, -n)) && n < 400) n += 1;
  return n;
}

// ── swim library (pick depends on the traffic light) ──
export const SWIM = [
  { id: 's1', name: 'Technik Grundlagen', m: 1200, focus: 'Technik, locker', desc: '200 m einschwimmen locker\n6 × 50 m Technik (Abschlagschwimmen, Seitlage), 20 s Pause\n4 × 100 m locker, Fokus Wasserlage und langer Zug, 20 s Pause\n200 m ausschwimmen' },
  { id: 's2', name: 'Lockere Ausdauer', m: 1500, focus: 'Grundlage', desc: '300 m einschwimmen\n3 × 300 m gleichmässig locker, 30 s Pause\n300 m ausschwimmen gemischt' },
  { id: 's3', name: 'Kurze Intervalle', m: 1500, focus: 'Tempo', desc: '300 m einschwimmen\n4 × 50 m Technik\n8 × 50 m zügig (RPE 7–8), 30 s Pause\n200 m locker\n4 × 50 m Beine mit Brett\n200 m ausschwimmen' },
  { id: 's4', name: '100er Intervalle', m: 1800, focus: 'Tempo-Ausdauer', desc: '400 m einschwimmen\n4 × 50 m Technik\n6 × 100 m zügig gleichmässig, 30 s Pause\n300 m Pull Buoy locker\n300 m ausschwimmen' },
  { id: 's5', name: 'Lange Ausdauer', m: 2000, focus: 'Grundlage', desc: '400 m einschwimmen\n3 × 400 m gleichmässig, 30 s Pause\n200 m Beine\n200 m ausschwimmen' },
  { id: 's6', name: 'Erholung', m: 1000, focus: 'Regeneration', desc: '200 m einschwimmen gemischt\n4 × 100 m sehr locker, Kraul und Rücken im Wechsel\n200 m Beine mit Brett locker\n200 m ausschwimmen' },
  { id: 's7', name: 'Pyramide', m: 1800, focus: 'Tempo-Ausdauer', desc: '300 m einschwimmen\n50, 100, 150, 200, 150, 100, 50 m zügig, je 20 s Pause\n4 × 50 m Technik\n300 m locker\n200 m ausschwimmen' },
  { id: 's8', name: 'Technik und Tempo', m: 1600, focus: 'Technik + Tempo', desc: '300 m einschwimmen\n6 × 50 m Technik\n4 × 100 m gleichmässig, 20 s Pause\n4 × 50 m schnell, 45 s Pause\n400 m ausschwimmen locker' },
];
export const swimById = (id) => SWIM.find((s) => s.id === id);
export function pickSwim(level, acts) {
  const recent = acts.filter((a) => a.type === 'swim' && a.swimId).slice(0, 2).map((a) => a.swimId);
  const pool = level === 'red' ? ['s6'] : level === 'yellow' ? ['s1', 's6', 's2'] : ['s3', 's4', 's7', 's8', 's5', 's2', 's1'];
  return SWIM.find((s) => pool.includes(s.id) && !recent.includes(s.id)) || swimById(pool[0]);
}

// ── stretching ──
/** Suggested routine (after running / in the evening) – the athlete replaces it with their own exercises. */
export const STRETCH_SUGGESTION = [
  { name: 'Wade an der Wand (Knie gestreckt)', sec: 30, sides: true },
  { name: 'Wade an der Wand (Knie gebeugt, Soleus)', sec: 30, sides: true },
  { name: 'Hüftbeuger im Ausfallschritt', sec: 40, sides: true },
  { name: 'Oberschenkel hinten (Bein auf Erhöhung)', sec: 40, sides: true },
  { name: 'Oberschenkel vorne im Stand', sec: 30, sides: true },
  { name: 'Gesäss (Figur 4 in Rückenlage)', sec: 40, sides: true },
  { name: 'Brust im Türrahmen', sec: 30, sides: false },
].map((x, i) => ({ id: `st${i + 1}`, ...x }));
export const stretchMinutes = (items) => Math.max(1, Math.round(items.reduce((s, i) => s + (i.sec || 30) * (i.sides ? 2 : 1), 0) / 60));

// ── evaluation (test set → conservative start weight) ──
const epley = (kg, reps) => kg * (1 + Math.min(12, Math.max(1, reps)) / 30);
export function startKg(kg, reps, rir, repMin, inc = 2.5) {
  if (!(kg > 0) || !(reps > 0)) return 0;
  const oneRm = epley(kg, reps + (Number(rir) || 0));
  const w = oneRm / (1 + (repMin + 3) / 30);
  return Math.max(inc, Math.floor(w / inc) * inc);
}

// ── calendar export (.ics) ──
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const icsDate = (iso) => iso.replaceAll('-', '');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** RFC 5545: lines longer than 75 bytes are continued on the next line with a leading space. */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Daily reminders (floating local time) with an alarm, plus optional all-day plan entries. */
export function buildIcs({ reminders = [], plan = [] }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trainingsbuch//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Trainingsbuch'];
  const start = todayISO();
  for (const r of reminders) {
    const [h, m] = r.time.split(':');
    lines.push('BEGIN:VEVENT', `UID:tb-${r.id}@trainingsbuch`, `DTSTAMP:${stamp()}`,
      `DTSTART:${icsDate(start)}T${h}${m}00`, `DURATION:PT${r.minutes || 5}M`, 'RRULE:FREQ=DAILY',
      `SUMMARY:${icsEsc(r.title)}`, `DESCRIPTION:${icsEsc(r.text || '')}`, ...(r.url ? [`URL:${r.url}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(r.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  for (const p of plan) {
    lines.push('BEGIN:VEVENT', `UID:tb-plan-${String(p.id).replace(/[^a-z0-9-]/gi, '')}-${icsDate(p.date)}@trainingsbuch`, `DTSTAMP:${stamp()}`,
      `DTSTART;VALUE=DATE:${icsDate(p.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(p.date, 1))}`,
      `SUMMARY:${icsEsc(p.summary)}`, `DESCRIPTION:${icsEsc(p.description || '')}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
