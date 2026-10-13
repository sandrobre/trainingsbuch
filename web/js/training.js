// Strength exercises, goals and nutrition options shared by the forms, detail views and trends.
import { esc, icon, fmtDate, fmtNum } from './util.js';

export const MUSCLE_GROUPS = ['Beine', 'Gesäss & Hüfte', 'Brust', 'Rücken', 'Schultern', 'Arme', 'Rumpf', 'Prävention & Sprung', 'Eigene'];

// unit 's' = timed exercise (seconds instead of repetitions); bw = usually bodyweight
const ex = (id, name, group, extra = {}) => ({ id, name, group, ...extra });
export const EXERCISES = [
  ex('squat', 'Kniebeuge (Langhantel)', 'Beine'),
  ex('front_squat', 'Frontkniebeuge', 'Beine'),
  ex('goblet_squat', 'Goblet Squat', 'Beine'),
  ex('leg_press', 'Beinpresse', 'Beine'),
  ex('lunge', 'Ausfallschritte', 'Beine'),
  ex('bulgarian_split_squat', 'Bulgarian Split Squat', 'Beine'),
  ex('step_up', 'Step-ups', 'Beine'),
  ex('leg_extension', 'Beinstrecker (Maschine)', 'Beine'),
  ex('leg_curl', 'Beinbeuger (Maschine)', 'Beine'),
  ex('calf_raise', 'Wadenheben', 'Beine'),
  ex('deadlift', 'Kreuzheben', 'Gesäss & Hüfte'),
  ex('romanian_deadlift', 'Rumänisches Kreuzheben', 'Gesäss & Hüfte'),
  ex('hip_thrust', 'Hip Thrust', 'Gesäss & Hüfte'),
  ex('glute_bridge', 'Glute Bridge', 'Gesäss & Hüfte', { bw: true }),
  ex('kettlebell_swing', 'Kettlebell Swing', 'Gesäss & Hüfte'),
  ex('good_morning', 'Good Morning', 'Gesäss & Hüfte'),
  ex('hip_adduction', 'Adduktoren (Maschine)', 'Gesäss & Hüfte'),
  ex('hip_abduction', 'Abduktoren (Maschine)', 'Gesäss & Hüfte'),
  ex('bench_press', 'Bankdrücken', 'Brust'),
  ex('incline_bench', 'Schrägbankdrücken', 'Brust'),
  ex('db_bench', 'Kurzhantel-Bankdrücken', 'Brust'),
  ex('push_up', 'Liegestütze', 'Brust', { bw: true }),
  ex('dips', 'Dips', 'Brust', { bw: true }),
  ex('chest_fly', 'Butterfly', 'Brust'),
  ex('pull_up', 'Klimmzüge', 'Rücken', { bw: true }),
  ex('lat_pulldown', 'Latzug', 'Rücken'),
  ex('barbell_row', 'Langhantelrudern', 'Rücken'),
  ex('db_row', 'Kurzhantelrudern', 'Rücken'),
  ex('cable_row', 'Rudern am Kabel', 'Rücken'),
  ex('face_pull', 'Face Pulls', 'Rücken'),
  ex('back_extension', 'Rückenstrecker', 'Rücken', { bw: true }),
  ex('overhead_press', 'Schulterdrücken (Langhantel)', 'Schultern'),
  ex('db_shoulder_press', 'Kurzhantel-Schulterdrücken', 'Schultern'),
  ex('lateral_raise', 'Seitheben', 'Schultern'),
  ex('reverse_fly', 'Reverse Flys', 'Schultern'),
  ex('biceps_curl', 'Bizepscurls', 'Arme'),
  ex('hammer_curl', 'Hammercurls', 'Arme'),
  ex('triceps_pushdown', 'Trizepsdrücken am Kabel', 'Arme'),
  ex('skull_crusher', 'French Press', 'Arme'),
  ex('plank', 'Unterarmstütz (Plank)', 'Rumpf', { unit: 's', bw: true }),
  ex('side_plank', 'Seitstütz', 'Rumpf', { unit: 's', bw: true }),
  ex('dead_bug', 'Dead Bug', 'Rumpf', { bw: true }),
  ex('pallof_press', 'Pallof Press', 'Rumpf'),
  ex('hanging_leg_raise', 'Beinheben hängend', 'Rumpf', { bw: true }),
  ex('ab_wheel', 'Ab Roller', 'Rumpf', { bw: true }),
  ex('russian_twist', 'Russian Twist', 'Rumpf'),
  ex('nordic_curl', 'Nordic Hamstring Curls', 'Prävention & Sprung', { bw: true }),
  ex('copenhagen', 'Copenhagen Plank', 'Prävention & Sprung', { unit: 's', bw: true }),
  ex('eccentric_calf', 'Exzentrisches Wadenheben', 'Prävention & Sprung'),
  ex('single_leg_rdl', 'Einbeiniges Kreuzheben', 'Prävention & Sprung'),
  ex('band_walk', 'Seitgang mit Miniband', 'Prävention & Sprung', { bw: true }),
  ex('single_leg_squat', 'Einbeinige Kniebeuge', 'Prävention & Sprung', { bw: true }),
  ex('box_jump', 'Box Jumps', 'Prävention & Sprung', { bw: true }),
  ex('pogo_jump', 'Pogo Jumps', 'Prävention & Sprung', { bw: true }),
  ex('broad_jump', 'Standweitsprung', 'Prävention & Sprung', { bw: true }),
];

export const FOCUS = {
  endurance: 'Ausdauer',
  speed: 'Schnelligkeit & Sprint',
  strength: 'Maximalkraft',
  hypertrophy: 'Muskelaufbau',
  weight_loss: 'Gewicht reduzieren',
  injury_prevention: 'Verletzungsprävention',
  match_fitness: 'Matchfitness',
  general: 'Allgemeine Fitness',
  race_time: 'Wettkampfzeit Laufen',
  mobility: 'Beweglichkeit',
  swim: 'Schwimmen verbessern',
  health: 'Gesundheit & Wohlbefinden',
  consistency: 'Regelmässig trainieren',
};
/** Sports that can have a weekly session target (units per week). */
export const WEEKLY_SPORTS = ['run', 'strength', 'swim', 'cycle', 'mobility', 'football', 'walk', 'hiit'];
export const CHECKIN = [
  ['energy', 'Energie', 'leer', 'voll'],
  ['sleep', 'Schlaf', 'schlecht', 'sehr gut'],
  ['muscle', 'Muskeln', 'starker Kater', 'frisch'],
  ['stress', 'Stress', 'sehr hoch', 'entspannt'],
];
export const checkinScore = (c) => {
  const v = CHECKIN.map(([k]) => c?.[k]).filter((x) => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export const PHASES = { prep: 'Vorbereitung', season: 'Saison', offseason: 'Pause', none: 'Keine Saison' };
export const DIETS = ['Alles', 'Vegetarisch', 'Vegan', 'Pescetarisch'];

/** Profile with defaults; converts the old free-text goal fields. */
export function normalizeProfile(raw = {}) {
  const p = { ...raw };
  if (typeof p.goals === 'string' || !p.goals) {
    const notes = typeof p.goals === 'string' ? p.goals : '';
    p.goals = { main: '', secondary: [], phase: '', targets: p.raceGoal ? [{ text: p.raceGoal, date: '' }] : [], notes };
  }
  p.goals = { main: '', secondary: [], phase: '', targets: [], notes: '', ...p.goals };
  p.nutrition = { enabled: false, diet: 'Alles', intolerances: '', ...(p.nutrition || {}) };
  p.customExercises ??= [];
  p.templates ??= [];
  p.weekly ??= {};
  return p;
}

export const catalog = (profile) => [...EXERCISES, ...(profile.customExercises || [])];

/** Estimated one-rep max (Epley) – only meaningful for weighted sets up to 12 reps. */
export function e1rm(set) {
  if (!set?.kg || !set?.reps || set.reps > 12) return null;
  return set.kg * (1 + set.reps / 30);
}
export const bestE1rm = (exercise) => Math.max(0, ...exercise.sets.map((s) => e1rm(s) || 0)) || null;
export const volume = (exercises = []) => exercises.reduce((sum, e) => sum + e.sets.reduce((s, x) => s + (x.kg || 0) * (e.unit === 's' ? 0 : x.reps || 0), 0), 0);

/** Compact summary: consecutive identical sets are grouped, e.g. "3 × 5 @ 85 kg · 1 × 3 @ 90 kg". */
export function fmtSets(sets, unit) {
  const groups = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.kg === s.kg && last.reps === s.reps) last.n += 1;
    else groups.push({ ...s, n: 1 });
  }
  return groups.map((g) => {
    const reps = `${g.reps ?? '–'}${unit === 's' ? ' s' : ''}`;
    const kg = g.kg ? ` @ ${fmtNum(g.kg, g.kg % 1 ? 1 : 0)} kg` : unit === 's' ? '' : ' Wdh.';
    return `${g.n} × ${reps}${kg}`;
  }).join(' · ');
}

/** Most recent logged sets of an exercise, skipping the activity being edited. */
export function lastSession(activities, exId, skipId) {
  for (const a of activities) {
    if (a.id === skipId) continue;
    const hit = (a.exercises || []).find((e) => e.id === exId);
    if (hit?.sets?.length) return { date: a.date, sets: hit.sets };
  }
  return null;
}

// ── form fragments ──
export function setRow(set = {}, unit) {
  return `<div class="set-row">
    <span class="set-no"></span>
    <label><input type="number" data-f="kg" inputmode="decimal" step="0.5" min="0" max="500" value="${esc(set.kg ?? '')}" placeholder="${unit === 's' ? '+kg' : 'kg'}" aria-label="Gewicht in kg"><small>kg</small></label>
    <span class="times">×</span>
    <label><input type="number" data-f="reps" inputmode="numeric" min="0" max="600" value="${esc(set.reps ?? '')}" placeholder="${unit === 's' ? 'Sek.' : 'Wdh.'}" aria-label="${unit === 's' ? 'Sekunden' : 'Wiederholungen'}"><small>${unit === 's' ? 's' : 'Wdh.'}</small></label>
    <button type="button" class="icon-btn sm" data-action="set-remove" aria-label="Satz entfernen">${icon('close', 16)}</button>
  </div>`;
}

export function exerciseBlock(exercise, last, plan) {
  const sets = exercise.sets?.length ? exercise.sets : [{}];
  const p = plan ? ` data-plan="${esc(JSON.stringify({ target: plan.target, sugg: plan.sugg, note: plan.note || undefined }))}" data-decision="${esc(plan.decision || '')}"` : '';
  return `<div class="ex-block" data-ex-id="${esc(exercise.id)}" data-ex-name="${esc(exercise.name)}" data-ex-group="${esc(exercise.group || 'Eigene')}" data-ex-unit="${esc(exercise.unit || '')}"${p}>
    <header>
      <div><strong>${esc(exercise.name)}</strong>
      ${plan ? `<span class="muted small">${esc(targetText(plan.target, exercise.unit))}</span>` : ''}
      <span class="muted small">${last ? `${last.eval ? 'Testsatz' : 'Letztes Mal'} (${esc(fmtDate(last.date, { day: 'numeric', month: 'short' }))}): ${esc(fmtSets(last.sets, exercise.unit))}` : esc(exercise.group || '')}</span></div>
      <button type="button" class="icon-btn sm" data-action="ex-remove" aria-label="Übung entfernen">${icon('trash', 16)}</button>
    </header>
    ${plan ? suggBox(plan, exercise.unit) : ''}
    <div class="sets">${sets.map((s) => setRow(s, exercise.unit)).join('')}</div>
    <div class="ex-actions">
      <button type="button" class="btn btn-sm" data-action="set-add">${icon('plus', 14)}Satz</button>
      ${last ? `<button type="button" class="btn btn-sm" data-action="ex-copy-last" data-sets="${esc(JSON.stringify(last.sets))}">Wie letztes Mal</button>` : ''}
    </div>
  </div>`;
}

/** Read the exercise blocks of the activity form. */
export function readExercises(form) {
  const num = (v) => (v === '' ? undefined : Number(v));
  return [...form.querySelectorAll('.ex-block')].map((b) => ({
    id: b.dataset.exId,
    name: b.dataset.exName,
    group: b.dataset.exGroup,
    ...(b.dataset.exUnit ? { unit: b.dataset.exUnit } : {}),
    ...(b.dataset.plan ? { progression: { sugg: JSON.parse(b.dataset.plan).sugg?.type, decision: b.dataset.decision || undefined } } : {}),
    sets: [...b.querySelectorAll('.set-row')]
      .map((r) => ({ kg: num(r.querySelector('[data-f=kg]').value), reps: num(r.querySelector('[data-f=reps]').value) }))
      .filter((s) => s.kg || s.reps)
      .map((s) => JSON.parse(JSON.stringify(s))),
  })).filter((e) => e.sets.length);
}

export const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// ───────────────────────── templates & progression ─────────────────────────
/** Default weight step: dumbbells 2 kg, bodyweight 0, timed exercises 10 s, everything else 2.5 kg. */
export function defaultInc(ex) {
  if (!ex) return 2.5;
  if (ex.unit === 's') return /seit/i.test(ex.name) ? 5 : 10;
  if (ex.bw) return 0;
  if (/kurzhantel|^db_|einbeinig|split/i.test(`${ex.id} ${ex.name}`)) return 2;
  return 2.5;
}
export const targetText = (t, unit) => (unit === 's'
  ? `Zeitübung · Start ${fmtSec(t.startSec || 60)} · +${t.inc ?? 10} s pro Training`
  : `Ziel ${t.sets} × ${t.repMin}${t.repMax !== t.repMin ? `–${t.repMax}` : ''} Wdh.`);
export const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const kgf = (v) => fmtNum(v, v % 1 ? 1 : 0);
const round = (v, step) => Math.round(v / (step || 0.5)) * (step || 0.5);

/** All logged sessions of an exercise, newest first (activities must be sorted newest first). */
export function exerciseHistory(activities, exId, skipId) {
  const out = [];
  for (const a of activities) {
    if (a.id === skipId) continue;
    const hit = (a.exercises || []).find((e) => e.id === exId);
    if (hit?.sets?.length) out.push({ date: a.date, sets: hit.sets, eval: !!a.eval, startKg: hit.startKg, progression: hit.progression || {} });
  }
  return out;
}

/**
 * Double progression: once every working set reaches the top of the rep range at the same weight,
 * suggest the next weight step. Twice in a row below the range → suggest ~10 % less.
 * Timed exercises (unit 's') add `inc` seconds every session. `blocked` (string) suppresses increases.
 */
export function suggestNext(t, ex, hist, blocked) {
  const inc = t.inc ?? defaultInc(ex);
  const last = hist[0];
  if (ex.unit === 's') {
    if (!last) return { type: 'new', to: t.startSec || 60, text: `Erstes Mal: ${fmtSec(t.startSec || 60)} halten. Danach jedes Training +${inc} s.` };
    const from = Math.max(...last.sets.map((x) => x.reps || 0));
    if (blocked) return { type: 'blocked', from, to: from, text: `Heute gleich lang wie letztes Mal (${fmtSec(from)}): ${blocked}.` };
    const to = from + inc;
    return { type: 'time', from, to, text: `Letztes Mal ${fmtSec(from)}. Heute ${fmtSec(to)} (+${inc} s).${to > 180 ? ' Ab etwa 3 Minuten bringt längeres Halten kaum Zusatznutzen – überleg dir eine schwierigere Variante.' : ''}` };
  }
  if (last?.eval && last.startKg) return { type: 'eval', from: last.startKg, to: last.startKg, text: `Startgewicht aus der Einstufung: ${kgf(last.startKg)} kg. Ziel: ${t.repMin} saubere Wiederholungen pro Satz, 2–3 im Tank.` };
  if (!last) return { type: 'new', text: `Erstes Mal: Wähle ein Gewicht, mit dem du ${t.repMin === t.repMax ? t.repMin : `${t.repMin}–${t.repMax}`} saubere Wiederholungen schaffst und noch 1–3 im Tank hast.` };
  const ws = last.sets.filter((x) => x.reps > 0);
  const top = Math.max(0, ...ws.map((x) => x.kg || 0));
  const work = top ? ws.filter((x) => (x.kg || 0) >= top) : ws;
  const allTop = work.length >= t.sets && work.every((x) => x.reps >= t.repMax);
  if (allTop) {
    if (blocked) return { type: 'blocked', from: top, to: top, text: `Steigerung wäre fällig, heute aber beim Gewicht bleiben: ${blocked}.` };
    if (!top || !inc) return { type: 'bw', text: `Alle Sätze mit ${t.repMax}+ Wiederholungen geschafft. Mach die Übung schwerer: schwierigere Variante oder Zusatzgewicht.` };
    let holds = 0;
    for (const h of hist) { if (h.progression?.sugg === 'up' && h.progression?.decision === 'hold') holds += 1; else break; }
    const to = round(top + inc, inc < 1 ? inc : 0.5);
    let text = `Letztes Mal alle Sätze mit ${kgf(top)} kg und mindestens ${t.repMax} Wdh. Steigere auf ${kgf(to)} kg und starte wieder bei ${t.repMin}.`;
    if (holds === 1) text += ' Letztes Mal bist du schon beim Gewicht geblieben – heute ist ein guter Tag zum Steigern.';
    if (holds >= 2) text += ` Du bist ${holds}× in Folge beim Gewicht geblieben, obwohl du bereit warst. Trau dich!`;
    return { type: 'up', from: top, to, holds, text };
  }
  const fail = (sets) => sets.some((x) => x.reps < t.repMin);
  if (fail(work) && hist[1]) {
    const prev = hist[1].sets.filter((x) => x.reps > 0);
    if (Math.max(0, ...prev.map((x) => x.kg || 0)) === top && fail(prev) && top) {
      const to = Math.max(inc || 1, Math.floor((top * 0.9) / (inc || 1)) * (inc || 1));
      return { type: 'down', from: top, to, text: `Zweimal in Folge unter ${t.repMin} Wdh. mit ${kgf(top)} kg. Vorschlag: ${kgf(to)} kg und sauber neu aufbauen.` };
    }
  }
  return { type: 'same', from: top, text: `Gleiches Gewicht wie letztes Mal (${top ? `${kgf(top)} kg` : 'Körpergewicht'}). Ziel: mindestens eine Wiederholung mehr, bis ${t.repMax} in allen Sätzen.` };
}

/** Sets to pre-fill for a template item, following the suggestion and the athlete's decision. */
export function prefillSets(t, ex, hist, sugg, decision) {
  const n = Math.max(1, t.sets || 3);
  const last = hist[0];
  if (ex.unit === 's') {
    const sec = sugg.type === 'time' ? (decision === 'hold' ? sugg.from : sugg.to) : (sugg.to || t.startSec || 60);
    return Array.from({ length: n }, () => ({ reps: sec }));
  }
  const ws = (last?.sets || []).filter((x) => x.reps > 0);
  const top = Math.max(0, ...ws.map((x) => x.kg || 0));
  const work = top ? ws.filter((x) => (x.kg || 0) >= top) : ws;
  return Array.from({ length: n }, (_, i) => {
    const ls = work[i] || work[work.length - 1];
    let kg = ls?.kg; let reps = ls?.reps;
    if ((sugg.type === 'up' && decision === 'up') || (sugg.type === 'down' && decision === 'down') || sugg.type === 'eval') { kg = sugg.to; reps = t.repMin; }
    return { kg, reps };
  });
}

export function suggBox(plan, unit) {
  const s = plan.sugg || {};
  const d = plan.decision;
  const btn = (dec, label) => `<button type="button" class="btn btn-sm${d === dec ? ' btn-primary' : ''}" data-action="ex-decide" data-dec="${dec}">${esc(label)}</button>`;
  let buttons = '';
  if (s.type === 'up') buttons = btn('up', `Auf ${kgf(s.to)} kg steigern`) + btn('hold', `Beim Gewicht bleiben (${kgf(s.from)} kg)`);
  if (s.type === 'time') buttons = btn('up', `${fmtSec(s.to)} halten`) + btn('hold', `Wie letztes Mal (${fmtSec(s.from)})`);
  if (s.type === 'down') buttons = btn('down', `Auf ${kgf(s.to)} kg reduzieren`) + btn('keep', 'Gewicht behalten');
  return `<div class="sugg sugg-${esc(s.type || 'none')}"><p>${esc(s.text || '')}</p>${plan.note ? `<p class="sugg-note">⚠︎ ${esc(plan.note)}</p>` : ''}${buttons ? `<div class="ex-actions">${buttons}</div>` : ''}</div>`;
}

/** Template preset: the runner-friendly strength plan A/B (heavy legs, jumps, single-leg, calves, hips, shoulders). */
export const PRESET_EXERCISES = [
  { id: 'c_wadenheben_sitzend', name: 'Wadenheben sitzend (Knie gebeugt)', group: 'Beine' },
  { id: 'c_liegestuetze_box', name: 'Liegestütze, Füsse auf Box', group: 'Brust', bw: true },
];
const it = (id, sets, repMin, repMax, extra = {}) => ({ id, sets, repMin, repMax, ...extra });
export const PRESET_TEMPLATES = [
  { id: 'tpl_a', name: 'Training A', items: [
    it('pogo_jump', 3, 15, 15), it('squat', 4, 5, 6), it('romanian_deadlift', 3, 6, 8), it('calf_raise', 3, 8, 12),
    it('db_bench', 4, 6, 6), it('db_row', 4, 6, 6), it('db_shoulder_press', 3, 8, 10), it('hanging_leg_raise', 3, 10, 10),
    it('side_plank', 2, 1, 1, { startSec: 30, inc: 5 }), it('plank', 1, 1, 1, { startSec: 150, inc: 10 }),
  ] },
  { id: 'tpl_b', name: 'Training B', items: [
    it('box_jump', 3, 5, 5), it('bulgarian_split_squat', 3, 6, 8), it('single_leg_rdl', 3, 8, 8), it('hip_thrust', 3, 6, 8),
    it('c_wadenheben_sitzend', 3, 10, 15), it('pull_up', 4, 6, 10), it('c_liegestuetze_box', 3, 10, 15),
    it('pallof_press', 3, 10, 10), it('face_pull', 2, 12, 15), it('plank', 1, 1, 1, { startSec: 150, inc: 10 }),
  ] },
];

/** Template that is due next: today's plan wins, otherwise the one after the last template session. */
export function nextTemplate(templates, activities) {
  if (!templates.length) return null;
  const last = activities.find((a) => a.templateId && !a.eval && templates.some((t) => t.id === a.templateId));
  if (!last) return templates[0];
  const i = templates.findIndex((t) => t.id === last.templateId);
  return templates[(i + 1) % templates.length];
}

/** Warm-up sets for a heavy first exercise: ~50 % × 8, ~75 % × 3. */
export function warmupSets(kg, inc = 2.5) {
  if (!kg || kg < 10) return '';
  const r = (v) => kgf(Math.max(inc, Math.round(v / inc) * inc));
  return `Aufwärmsätze: ${r(kg * 0.5)} kg × 8 · ${r(kg * 0.75)} kg × 3, dann die Arbeitssätze`;
}
export const WARMUP = [
  '5 Min. locker: Velo, Rudergerät oder Seilspringen',
  'Beinschwingen vor/zurück und seitlich, je 10 pro Bein',
  'Ausfallschritte mit Oberkörperdrehung, je 5 pro Seite',
  "World's Greatest Stretch, je 3 pro Seite",
  'Kniebeugen ohne Gewicht, 10 Wdh.',
  'Schulterkreisen und Band-Pull-aparts, 15 Wdh.',
];
