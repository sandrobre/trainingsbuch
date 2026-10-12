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

export function exerciseBlock(exercise, last) {
  const sets = exercise.sets?.length ? exercise.sets : [{}];
  return `<div class="ex-block" data-ex-id="${esc(exercise.id)}" data-ex-name="${esc(exercise.name)}" data-ex-group="${esc(exercise.group || 'Eigene')}" data-ex-unit="${esc(exercise.unit || '')}">
    <header>
      <div><strong>${esc(exercise.name)}</strong>
      <span class="muted small">${last ? `Letztes Mal (${esc(fmtDate(last.date, { day: 'numeric', month: 'short' }))}): ${esc(fmtSets(last.sets, exercise.unit))}` : esc(exercise.group || '')}</span></div>
      <button type="button" class="icon-btn sm" data-action="ex-remove" aria-label="Übung entfernen">${icon('trash', 16)}</button>
    </header>
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
    sets: [...b.querySelectorAll('.set-row')]
      .map((r) => ({ kg: num(r.querySelector('[data-f=kg]').value), reps: num(r.querySelector('[data-f=reps]').value) }))
      .filter((s) => s.kg || s.reps)
      .map((s) => JSON.parse(JSON.stringify(s))),
  })).filter((e) => e.sets.length);
}

export const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
