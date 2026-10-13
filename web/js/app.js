import {
  SPORTS, FEELINGS, RPE_LABELS, sport, sportColor, esc, md, icon, toast, initTooltip,
  todayISO, addDays, parseDay, daysBetween, weekStart, isoWeek, fmtDate, weekdayShort, relDay, relTime,
  fmtNum, fmtDur, fmtPace, fmtClock, fmtHours, avg,
} from './util.js';
import * as store from './store.js';
import { bars, line, sparkline, ring, hbars, legend } from './charts.js';
import {
  MUSCLE_GROUPS, FOCUS, PHASES, DIETS, catalog, normalizeProfile, bestE1rm, volume, fmtSets,
  lastSession, setRow, exerciseBlock, readExercises, slug,
  exerciseHistory, suggestNext, prefillSets, suggBox, defaultInc, nextTemplate, warmupSets, WARMUP,
  PRESET_TEMPLATES, PRESET_EXERCISES, targetText, WEEKLY_SPORTS, CHECKIN, checkinScore,
} from './training.js';
import {
  LIMIT_KIND, LIMIT_SHORT, AFFECTS, activeLimits, conflicts, templateParts, trafficLight, planItems, planDone, sessionHint,
  HM_KM, RACE_DISTANCES, raceEstimate, racePhase, weeklyGoalStreak, dayStreak, SWIM, swimById, pickSwim,
  STRETCH_SUGGESTION, stretchMinutes, startKg, buildIcs,
} from './planning.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');

const state = {
  data: null,
  error: null,
  route: 'heute',
  actFilter: 'all',
  actQuery: '',
  trendWeeks: 12,
  coachTab: 0,
  trendExercise: null,
  trendTab: 'overview',
  ciDraft: null, // check-in being edited on Today
  planView: 'week',
  planWeek: null, // Monday of the shown week (null = current)
  planAdd: null, // day with the open "add session" form
  planMove: null, // plan item being moved
  calMonth: null,
  reviewMonth: null,
  pending: null, // { kind: 'coach' | 'sync', question?, since }
};

const ROUTES = {
  heute: { title: 'Heute', icon: 'home', render: renderToday },
  plan: { title: 'Plan', icon: 'calendar', render: renderPlan },
  aktivitaeten: { title: 'Aktivitäten', icon: 'list', render: renderActivities },
  coach: { title: 'Coach', icon: 'sparkles', render: renderCoach },
  trends: { title: 'Trends', icon: 'chart', render: renderTrends },
  einstellungen: { title: 'Einstellungen', icon: 'settings', render: renderSettings },
};
const SPORT_LABELS = Object.fromEntries(Object.entries(SPORTS).map(([k, v]) => [k, v.label]));
const ZONE_COLORS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const STATUS_TEXT = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' };

/** Tip areas of an analysis: new format `focus: [{area, tips}]`, older analyses had fixed keys. */
function focusAreas(an) {
  if (an?.focus?.length) return an.focus;
  return [['running', '🏃 Laufen'], ['football', '⚽ Fussball'], ['recovery', '😴 Erholung']]
    .filter(([k]) => an?.[k]?.length).map(([k, area]) => ({ area, tips: an[k] }));
}

// ───────────────────────── derived data ─────────────────────────
function activities() {
  const { garmin = {}, manual = {} } = state.data;
  const ann = manual.annotations || {};
  return [...(garmin.activities || []).map((a) => ({ ...a, ...ann[a.id] })), ...(manual.activities || [])]
    .filter((a) => a.date)
    .sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date));
}
const daily = () => [...(state.data.garmin?.daily || [])].sort((a, b) => a.date.localeCompare(b.date));
const analysis = () => state.data.insights?.analysis;
const profile = () => normalizeProfile(state.data?.profile || {});
const snapshot = () => state.data.garmin?.snapshot || {};

function actTitle(a) {
  if (a.title) return a.title;
  if (a.type === 'football') {
    const f = a.football || {};
    return f.kind === 'match' ? `Match${f.opponent ? ` vs. ${f.opponent}` : ''}` : 'Fussballtraining';
  }
  return sport(a.type).label;
}

function minutesBySport(list) {
  const out = {};
  for (const a of list) out[a.type || 'other'] = (out[a.type || 'other'] || 0) + (a.durationMin || 0);
  return out;
}

function sportsIn(list) {
  const present = new Set(list.map((a) => a.type || 'other'));
  return Object.keys(SPORTS).filter((k) => present.has(k));
}

// ───────────────────────── shared fragments ─────────────────────────
function pageHead(title, sub, actions = '') {
  return `<header class="page-head">
    <div><p class="eyebrow">${sub}</p><h1>${title}</h1></div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ''}
  </header>`;
}

function demoBanner() {
  if (state.data.mode !== 'demo') return '';
  return `<div class="banner">
    ${icon('sparkles', 18)}
    <p><strong>Demo-Modus:</strong> Du siehst Beispieldaten. Verbinde dein GitHub-Repo, damit deine Garmin-Daten und Trainings hier erscheinen.</p>
    <a class="btn btn-sm" href="#/einstellungen">Einrichten</a>
  </div>`;
}

function pendingBanner() {
  const p = state.pending;
  if (!p) return '';
  const text = p.kind === 'sync'
    ? 'Garmin-Daten werden synchronisiert …'
    : p.question ? 'Der Coach beantwortet deine Frage …' : 'Der Coach analysiert deine Daten …';
  return `<div class="banner banner-live" role="status"><span class="spinner"></span><p>${text} <span class="muted">Das dauert meist 1–2 Minuten.</span></p></div>`;
}

function actRow(a) {
  const s = sport(a.type);
  const metrics = [
    fmtDur(a.durationMin),
    a.distanceKm && `${fmtNum(a.distanceKm, 1)} km`,
    a.paceSecPerKm && `${fmtPace(a.paceSecPerKm)} /km`,
    a.avgHr && `${a.avgHr} bpm`,
    a.exercises?.length && `${a.exercises.length} Übung${a.exercises.length > 1 ? 'en' : ''}`,
    volume(a.exercises) && `${fmtNum(volume(a.exercises))} kg`,
    a.football?.kind === 'match' && a.football.result,
  ].filter(Boolean);
  const time = a.start?.length > 10 ? ` · ${a.start.slice(11, 16)}` : '';
  return `<button class="act-row" data-action="open-activity" data-id="${esc(a.id)}">
    <span class="act-icon" style="--c:${sportColor(a.type)}">${s.emoji}</span>
    <span class="act-main">
      <span class="act-title">${esc(actTitle(a))}</span>
      <span class="act-sub">${esc(relDay(a.date))}${time} · ${esc(s.label)}${a.source === 'garmin' ? ` <span class="src">${icon('watch', 12)}Garmin</span>` : ''}</span>
    </span>
    <span class="act-metrics">${metrics.map((m) => `<span>${esc(m)}</span>`).join('')}</span>
    ${a.feeling ? `<span class="act-feel" title="Gefühl ${a.feeling}/5">${FEELINGS[a.feeling]}</span>` : ''}
  </button>`;
}

function tipList(tips = []) {
  if (!tips.length) return '<p class="muted">Keine Empfehlungen.</p>';
  return `<ol class="tips">${tips.map((t) => `
    <li class="tip-item prio-${esc(t.priority)}">
      <div class="tip-head"><strong>${esc(t.title)}</strong><span class="prio">${esc(STATUS_TEXT[t.priority] || t.priority)}</span></div>
      <p>${esc(t.detail)}</p>
    </li>`).join('')}</ol>`;
}

function planCard(p) {
  const s = p.type === 'rest' ? { label: 'Ruhetag', emoji: '😴' } : sport(p.type);
  const isToday = p.date === todayISO();
  return `<article class="plan-card${isToday ? ' is-today' : ''}" style="--c:${p.type === 'rest' ? 'var(--ink-3)' : sportColor(p.type)}">
    <header><span class="plan-day">${esc(isToday ? 'Heute' : weekdayShort(p.date))}</span><span class="muted">${esc(fmtDate(p.date, { day: 'numeric', month: 'short' }))}</span></header>
    <div class="plan-type">${s.emoji} ${esc(s.label)}</div>
    <h3>${esc(p.title)}</h3>
    <div class="plan-meta">${p.durationMin ? `<span>${icon('clock', 14)}${fmtDur(p.durationMin)}</span>` : ''}<span class="intensity i-${esc(p.intensity)}">${esc(p.intensity)}</span></div>
    <p>${esc(p.details)}</p>
    ${p.nutrition ? `<p class="plan-food">🍽️ ${esc(p.nutrition)}</p>` : ''}
  </article>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty">${icon('sparkles', 28)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

// ───────────────────────── page: today ─────────────────────────
const KPIS = [
  { key: 'restingHr', label: 'Ruhepuls', icon: 'heart', unit: 'bpm', better: 'lower' },
  { key: 'hrv', label: 'HRV', icon: 'pulse', unit: 'ms', better: 'higher' },
  { key: 'sleepH', label: 'Schlaf', icon: 'moon', unit: 'h', digits: 1, better: 'higher', fmt: fmtHours },
  { key: 'bodyBatteryHigh', label: 'Body Battery', icon: 'battery', unit: '', better: 'higher' },
  { key: 'stress', label: 'Stress', icon: 'gauge', unit: '', better: 'lower' },
  { key: 'steps', label: 'Schritte', icon: 'steps', unit: '', better: 'higher' },
];

function weightTile() {
  const w = Object.entries(weightMap()).sort(([a], [b]) => a.localeCompare(b));
  if (!w.length) return '';
  const [date, kg] = w.at(-1);
  const old = w.filter(([d]) => daysBetween(d, date) >= 25).at(-1);
  return `<article class="kpi">
    <header>${icon('user', 16)}<span>Gewicht</span>${date === todayISO() ? '' : `<span class="kpi-when">${esc(relDay(date))}</span>`}</header>
    <div class="kpi-value">${fmtNum(kg, 1)}<small>kg</small></div>
    ${old ? `<span class="trend">${kg - old[1] > 0 ? '↑' : kg - old[1] < 0 ? '↓' : '→'} ${fmtNum(Math.abs(kg - old[1]), 1)} kg vs. vor 4 Wo.</span>` : ''}
    ${sparkline(w.slice(-30).map(([, v]) => v), 'var(--accent)')}
  </article>`;
}

function kpiTile(k, days) {
  const recent = days.slice(-14);
  const withValue = recent.filter((d) => typeof d[k.key] === 'number');
  const latest = withValue.at(-1);
  if (!latest) return '';
  const base = avg(withValue.slice(-8, -1).map((d) => d[k.key]));
  const delta = base == null ? null : latest[k.key] - base;
  let trend = '';
  if (delta != null && Math.abs(delta) >= (k.digits ? 0.1 : 1)) {
    const good = k.better === 'higher' ? delta > 0 : delta < 0;
    trend = `<span class="trend ${good ? 'good' : 'bad'}">${delta > 0 ? '↑' : '↓'} ${k.fmt ? `${k.fmt(Math.abs(delta))} ${k.unit}` : fmtNum(Math.abs(delta), k.digits || 0)} vs. Ø 7 T.</span>`;
  } else if (delta != null) {
    trend = '<span class="trend">→ wie Ø 7 T.</span>';
  }
  const when = latest.date === todayISO() ? '' : `<span class="kpi-when">${esc(relDay(latest.date))}</span>`;
  return `<article class="kpi">
    <header>${icon(k.icon, 16)}<span>${k.label}</span>${when}</header>
    <div class="kpi-value">${k.fmt ? k.fmt(latest[k.key]) : fmtNum(latest[k.key], k.digits || 0)}<small>${k.unit}</small></div>
    ${trend}
    ${sparkline(recent.map((d) => d[k.key]), 'var(--accent)')}
  </article>`;
}

function weekLoadCard(acts) {
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const cols = days.map((d) => {
    const dayActs = acts.filter((a) => a.date === d);
    const per = minutesBySport(dayActs);
    const lines = Object.entries(per).map(([t, m]) => `${esc(SPORT_LABELS[t] || t)}: ${fmtDur(m)}`);
    return {
      label: d === today ? 'Heute' : weekdayShort(d),
      tip: `<b>${esc(fmtDate(d))}</b><br>${lines.length ? lines.join('<br>') : 'Ruhetag'}`,
      segments: Object.entries(per).map(([type, value]) => ({ type, value })),
    };
  });
  const weekActs = acts.filter((a) => daysBetween(a.date, today) < 7);
  const total = weekActs.reduce((s, a) => s + (a.durationMin || 0), 0);
  const runKm = weekActs.filter((a) => a.type === 'run').reduce((s, a) => s + (a.distanceKm || 0), 0);
  const types = sportsIn(weekActs);
  return `<article class="card">
    <header class="card-head"><h2>Letzte 7 Tage</h2><a class="link" href="#/trends">Trends ${icon('chevron', 14)}</a></header>
    <div class="stat-row">
      <div><strong>${weekActs.length}</strong><span>Einheiten</span></div>
      <div><strong>${fmtDur(total)}</strong><span>Trainingszeit</span></div>
      <div><strong>${fmtNum(runKm, 1)}</strong><span>Lauf-km</span></div>
    </div>
    ${bars(cols, { unit: 'min', height: 150 })}
    ${types.length ? legend(types, SPORT_LABELS) : ''}
  </article>`;
}

function renderToday() {
  const acts = activities();
  const days = daily();
  const an = analysis();
  const snap = snapshot();
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const name = profile().name;
  const score = an?.readiness?.score ?? snap.readiness?.score;
  const upcoming = (an?.plan || []).filter((p) => p.date >= todayISO()).slice(0, 3);

  const readiness = `<article class="card readiness">
    ${ring(score, { label: 'Bereitschaft' })}
    <div>
      <p class="eyebrow">Tagesform</p>
      <h2>${esc(an?.readiness?.label || snap.readiness?.feedback || 'Noch keine Analyse')}</h2>
      <p class="muted">${esc(an?.readiness?.reasoning || 'Sobald der Coach deine Daten analysiert hat, siehst du hier deine Tagesform.')}</p>
      ${snap.readiness?.score != null && an?.readiness ? `<p class="chip-row"><span class="chip">${icon('watch', 14)} Garmin Readiness ${snap.readiness.score}</span>${snap.readiness.recoveryTimeH ? `<span class="chip">${icon('clock', 14)} Erholung ${snap.readiness.recoveryTimeH} h</span>` : ''}</p>` : ''}
    </div>
  </article>`;

  const brief = an ? `<article class="card coach-brief">
    <header class="card-head"><h2>${icon('sparkles', 18)} Coach</h2><span class="muted small">${esc(relTime(state.data.insights.generatedAt))}</span></header>
    <p class="lead">${esc(an.summary)}</p>
    ${(an.warnings || []).map((w) => `<p class="warn">${icon('alert', 16)}${esc(w)}</p>`).join('')}
    <ul class="mini-tips">${focusAreas(an).flatMap((f) => f.tips).filter((t) => t.priority === 'hoch').slice(0, 3)
      .map((t) => `<li><strong>${esc(t.title)}</strong></li>`).join('')}</ul>
    <a class="link" href="#/coach">Ganze Analyse ${icon('chevron', 14)}</a>
  </article>` : `<article class="card coach-brief">${emptyState('Noch keine Coach-Analyse', 'Starte die erste Analyse – Claude wertet dann alle Trainings und Gesundheitsdaten aus.', '<button class="btn btn-primary" data-action="analyze">Analyse starten</button>')}</article>`;

  const vo2 = snap.vo2max ? `<article class="kpi">
    <header>${icon('wind', 16)}<span>VO₂max</span></header>
    <div class="kpi-value">${fmtNum(snap.vo2max, 1)}</div>
    ${snap.fitnessAge ? `<span class="trend">Fitnessalter ${snap.fitnessAge}</span>` : ''}
  </article>` : '';

  return `
    ${pageHead(`${greet}${name ? `, ${esc(name)}` : ''}`, esc(fmtDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })),
      `<button class="btn" data-action="sync">${icon('refresh', 16)}<span>Sync</span></button><button class="btn btn-primary hide-mobile" data-action="add">${icon('plus', 16)}<span>Training</span></button>`)}
    ${demoBanner()}${pendingBanner()}${draftBanner()}
    ${checkinCard()}
    ${recordsBanner()}
    ${todayCard(acts)}
    ${readinessCard()}
    ${raceCard(acts)}
    <section class="grid hero">${readiness}${brief}</section>
    ${weeklyCard(acts)}
    ${stretchCard()}
    <section class="kpis">${KPIS.map((k) => kpiTile(k, days)).join('')}${weightTile()}${vo2}</section>
    ${strengthCard(acts)}
    <section class="grid two">
      ${weekLoadCard(acts)}
      <article class="card">
        <header class="card-head"><h2>Als Nächstes</h2><a class="link" href="#/coach">Wochenplan ${icon('chevron', 14)}</a></header>
        ${upcoming.length ? `<div class="plan-list compact">${upcoming.map(planCard).join('')}</div>` : '<p class="muted">Der Coach erstellt dir nach der ersten Analyse einen Plan für die nächsten 7 Tage.</p>'}
      </article>
    </section>
    <article class="card">
      <header class="card-head"><h2>Letzte Aktivitäten</h2><a class="link" href="#/aktivitaeten">Alle ${icon('chevron', 14)}</a></header>
      <div class="act-list">${acts.slice(0, 5).map(actRow).join('') || '<p class="muted">Noch keine Aktivitäten.</p>'}</div>
    </article>`;
}

// ── daily check-in ──
const checkins = () => state.data?.manual?.checkins || {};
const PAIN_TEXT = (n) => (n <= 2 ? 'grün' : n <= 5 ? 'gelb' : 'rot');

function checkinCard() {
  const today = todayISO();
  const saved = checkins()[today];
  const recent = Object.entries(checkins()).filter(([d]) => d < today && daysBetween(d, today) <= 3)
    .map(([, c]) => checkinScore(c)).filter((x) => x != null);
  if (saved && !state.ciDraft) {
    const score = checkinScore(saved);
    const low = score != null && score < 2.5;
    return `<article class="card checkin done${low ? ' low' : ''}">
      <div class="ci-summary">
        <span class="ci-score" style="--c:${low ? 'var(--bad)' : score >= 3.5 ? 'var(--good)' : 'var(--warn)'}">${score == null ? '–' : fmtNum(score, 1)}</span>
        <div><p class="eyebrow">Check-in heute ✓</p>
          <p class="small">${CHECKIN.filter(([k]) => saved[k]).map(([k, l]) => `${esc(l)} ${saved[k]}/5`).join(' · ')}${manualData().weights?.[today] ? ` · ${fmtNum(manualData().weights[today], 1)} kg` : ''}</p>
          ${saved.pain ? `<p class="small ci-pain p-${PAIN_TEXT(saved.pain)}">${icon('alert', 14)}Schmerz ${saved.pain}/10${saved.painWhere ? ` · ${esc(saved.painWhere)}` : ''}</p>` : ''}
          ${saved.sick ? `<p class="small ci-pain p-rot">${icon('alert', 14)}Krank / Infekt – heute kein intensives Training.</p>` : ''}
          ${low ? '<p class="small muted">Tiefer Wert – heute eher locker oder Ruhetag.</p>' : ''}
        </div>
      </div>
      <button class="btn btn-sm" data-action="ci-edit">${icon('edit', 14)}Ändern</button>
    </article>`;
  }
  const d = state.ciDraft || (state.ciDraft = { ...(saved || {}) });
  return `<article class="card checkin">
    <header class="card-head"><h2>Wie geht's dir heute?</h2><span class="muted small">30 Sekunden · 5 = sehr gut</span></header>
    <div class="ci-scales">${CHECKIN.map(([k, label, lo, hi]) => `<div class="ci-row">
      <span class="ci-label">${esc(label)}</span>
      <div class="ci-btns" role="group" aria-label="${esc(label)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="ci-set" data-k="${k}" data-v="${n}" aria-pressed="${d[k] === n}">${n}</button>`).join('')}</div>
      <span class="ci-hint muted">${esc(lo)} → ${esc(hi)}</span>
    </div>`).join('')}</div>
    <div class="ci-extra">
      <label class="field"><span>Schmerz (0–10)</span><select id="ci-pain">${Array.from({ length: 11 }, (_, n) => `<option value="${n}" ${(d.pain || 0) === n ? 'selected' : ''}>${n === 0 ? 'keiner' : n}</option>`).join('')}</select></label>
      <label class="field grow"><span>Wo? <em>optional</em></span><input id="ci-where" value="${esc(d.painWhere || '')}" placeholder="z.B. Knie links, Achillessehne" maxlength="60"></label>
      <label class="field"><span>Gewicht (kg) <em>optional</em></span><input id="ci-weight" type="number" inputmode="decimal" step="0.1" min="30" max="250" value="${esc(manualData().weights?.[todayISO()] ?? '')}" placeholder="–"></label>
    </div>
    <label class="switch"><input type="checkbox" id="ci-sick" ${d.sick ? 'checked' : ''}><span></span>Krank / Erkältung</label>
    <div class="form-actions">
      ${saved ? '<button class="btn" data-action="ci-cancel">Abbrechen</button>' : ''}
      <button class="btn btn-primary" data-action="ci-save">${icon('check', 16)}Check-in speichern</button>
    </div>
    ${recent.length && avg(recent) < 2.5 ? '<p class="small warn-text">Die letzten Tage waren tief – achte heute besonders auf Erholung.</p>' : ''}
  </article>`;
}

async function saveCheckin() {
  const d = { ...state.ciDraft };
  d.pain = Number($('#ci-pain')?.value || 0) || undefined;
  d.painWhere = d.pain ? ($('#ci-where')?.value.trim() || undefined) : undefined;
  d.sick = $('#ci-sick')?.checked || undefined;
  if (!CHECKIN.some(([k]) => d[k])) { toast('Bitte mindestens einen Wert antippen.', 'error'); return; }
  d.at = new Date().toISOString();
  const clean = JSON.parse(JSON.stringify(d));
  const kg = Number($('#ci-weight')?.value) || null;
  try {
    const day = todayISO();
    const manual = await store.updateManual((m) => {
      m.checkins ??= {};
      m.checkins[day] = clean;
      if (kg) { m.weights ??= {}; m.weights[day] = Math.round(kg * 10) / 10; } else if (m.weights) delete m.weights[day];
      return m;
    }, `Check-in ${day}`);
    state.data.manual = manual || { ...state.data.manual, checkins: { ...checkins(), [day]: clean } };
    state.ciDraft = null;
    toast(clean.pain > 5 || clean.sick ? 'Gespeichert – heute bitte schonen.' : 'Check-in gespeichert');
    render();
  } catch (err) { toast(`Speichern fehlgeschlagen: ${err.message}`, 'error'); }
}

// ── weekly session goals ──
function weeklyCard(acts) {
  const goals = Object.entries(profile().weekly || {}).filter(([, n]) => n > 0);
  if (!goals.length) {
    return `<article class="card weekly empty-weekly"><p class="muted small">${icon('target', 16)} Setze dir Wochenziele (z.B. 2× Laufen, 2× Kraft, 1× Schwimmen) – dann siehst du hier deinen Fortschritt.</p><a class="btn btn-sm" href="#/einstellungen">Ziele setzen</a></article>`;
  }
  const wk = weekStart(todayISO());
  const done = (t) => new Set(acts.filter((a) => a.type === t && a.date >= wk && a.date < addDays(wk, 7)).map((a) => a.id)).size;
  const left = 7 - daysBetween(wk, todayISO()) - 1;
  const items = goals.map(([t, n]) => ({ t, n, d: done(t), label: `${sport(t).emoji} ${sport(t).label}`, color: sportColor(t) }));
  const all = items.every((i) => i.d >= i.n);
  const stLog = stretchLog();
  if (stretchItems().length || Object.keys(stLog).length) {
    items.push({ t: 'stretch', n: 7, d: Array.from({ length: 7 }, (_, i) => addDays(wk, i)).filter((d) => stLog[d]?.complete).length, label: '🧘 Dehnen', color: 'var(--s-mobility)' });
  }
  const streak = weeklyGoalStreak(acts, profile().weekly);
  const stDays = dayStreak((d) => !!stLog[d]?.complete);
  const ciDays = dayStreak((d) => !!checkins()[d]);
  const streaks = [
    streak.current >= 2 && `🔥 ${streak.current} Wochen in Folge alle Ziele${streak.best > streak.current ? ` (Rekord ${streak.best})` : ''}`,
    stDays >= 3 && `🧘 ${stDays} Tage in Folge gedehnt`,
    ciDays >= 3 && `✅ ${ciDays} Tage Check-in am Stück`,
  ].filter(Boolean);
  return `<article class="card weekly">
    <header class="card-head"><h2>Diese Woche</h2><span class="muted small">${all ? '🎉 Alle Wochenziele erreicht' : `noch ${left} Tag${left === 1 ? '' : 'e'}`}</span></header>
    <div class="week-rings">${items.map(({ n, d, label, color }) => `<div class="week-ring${d >= n ? ' reached' : ''}">
      ${ring(Math.min(100, (d / n) * 100), { size: 74, color, label: '' }).replace(/<strong>.*?<\/strong>/, `<strong>${d}/${n}</strong>`)}
      <span>${esc(label)}</span>
    </div>`).join('')}</div>
    ${streaks.length ? `<p class="streaks">${streaks.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''}
  </article>`;
}

// ───────────────────────── Etappe 3: shared helpers ─────────────────────────
const manualData = () => state.data?.manual || {};
const limitsList = () => manualData().limits || [];
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const light = () => trafficLight({ limits: limitsList(), checkins: checkins(), acts: activities(), snapshot: snapshot() });
const stretchItems = () => profile().stretch || [];
const stretchLog = () => manualData().stretch || {};

/** Garmin + manual body weight per day. */
function weightMap() {
  const out = {};
  for (const d of daily()) if (d.weightKg) out[d.date] = d.weightKg;
  return { ...out, ...(manualData().weights || {}) };
}
/** Daily health rows with manual weights merged in (also for days without Garmin data). */
function healthDays() {
  const w = weightMap();
  const map = new Map(daily().map((d) => [d.date, { ...d }]));
  for (const [date, kg] of Object.entries(w)) map.set(date, { ...(map.get(date) || { date }), weightKg: kg });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function saveManual(mutate, message, ok) {
  try {
    const next = await store.updateManual((m) => { mutate(m); return m; }, message);
    if (next) state.data.manual = next;
    if (ok) toast(ok);
    render();
    return true;
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
    return false;
  }
}

function planRange(from, to) {
  const p = profile();
  return planItems({ plan: manualData().plan || [], recurring: p.recurring || [], garminPlanned: state.data?.garmin?.planned || [], from, to });
}
const findPlanItem = (id) => planRange(addDays(todayISO(), -120), addDays(todayISO(), 180)).find((x) => x.id === id);

/** Change a plan entry; generated entries (fixed / Garmin) get an override entry in manual.plan. */
function planPatch(it, patch, message, ok) {
  return saveManual((m) => {
    m.plan ??= [];
    if (!it.key) {
      const i = m.plan.findIndex((x) => x.id === it.id);
      if (i < 0) return;
      if (patch.removed && !m.plan[i].recurOf) m.plan.splice(i, 1);
      else Object.assign(m.plan[i], patch);
    } else {
      const { key, src, ...rest } = it;
      m.plan.push(JSON.parse(JSON.stringify({ ...rest, id: newId('p'), recurOf: key, ...patch })));
    }
  }, message, ok);
}

// ── traffic light + today's sessions ──
function limitChip(l) {
  return `<div class="limit">
    <span class="chip ${l.kind === 'ill' ? 'bad' : 'warn'}">${esc(LIMIT_SHORT[l.kind])}</span>
    <div><strong>${esc(l.area || '')}</strong>
      <span class="muted small">seit ${esc(fmtDate(l.from, { day: 'numeric', month: 'short' }))}${l.to ? ` bis ${esc(fmtDate(l.to, { day: 'numeric', month: 'short' }))}` : ''}${l.affects?.length ? ` · betrifft ${esc(l.affects.map((a) => AFFECTS[a]).join(', '))}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</span></div>
    <button class="btn btn-sm" data-action="limit-resolve" data-id="${esc(l.id)}">Wieder fit</button>
  </div>`;
}

function planRow(it, acts, L, opts = {}) {
  const p = profile();
  const done = planDone(it, acts);
  const conf = conflicts(it, limitsList(), p.templates, catalog(p));
  const sw = it.sport === 'swim' ? (swimById(it.swimId) || (it.date >= todayISO() ? pickSwim(L.level, acts) : null)) : null;
  const tpl = it.sport === 'strength' ? p.templates.find((t) => t.id === it.templateId) : null;
  const badge = { garmin: 'Garmin-Plan', fix: 'Fix' }[it.src];
  const meta = [it.durationMin && fmtDur(it.durationMin), it.distanceKm && `${fmtNum(it.distanceKm, 1)} km`, it.plan, it.movedFrom ? `verschoben vom ${fmtDate(it.movedFrom, { day: 'numeric', month: 'short' })}` : ''].filter(Boolean);
  const longRunNext = it.sport === 'strength' && planRange(addDays(it.date, 1), addDays(it.date, 1)).some((x) => x.sport === 'run' && /lang|long|tempo|intervall/i.test(x.title || ''));
  return `<div class="plan-row${done ? ' done' : ''}" style="--c:${sportColor(it.sport)}">
    <button class="check" data-action="plan-done" data-id="${esc(it.id)}" aria-pressed="${done}" aria-label="Als erledigt markieren">${icon('check', 15)}</button>
    <div class="pr-main">
      <div class="pr-title">${sport(it.sport).emoji} <strong>${esc(it.title || sport(it.sport).label)}</strong>${badge ? ` <span class="chip">${badge}</span>` : ''}${it.race ? ' <span class="chip good">🏁 Wettkampf</span>' : ''}</div>
      ${meta.length ? `<div class="muted small">${esc(meta.join(' · '))}</div>` : ''}
      ${it.note ? `<details><summary class="small">Details</summary><p class="small pre">${esc(it.note)}</p></details>` : ''}
      ${conf.map((l) => `<p class="small warn-text">${icon('alert', 13)} Betroffen: ${esc(LIMIT_SHORT[l.kind])}${l.area ? ` (${esc(l.area)})` : ''} – anpassen oder verschieben</p>`).join('')}
      ${(() => { const lvl = conf.length ? L.level : L.generalLevel; const h = it.date === todayISO() && !done && sessionHint(it, lvl); return h ? `<p class="small tl-hint tl-${lvl}">${icon('alert', 13)} ${esc(h)}</p>` : ''; })()}
      ${longRunNext && tpl && templateParts(tpl, catalog(p)).lower ? '<p class="small warn-text">Am Tag vor einem langen oder harten Lauf: Beine leichter oder Tag tauschen.</p>' : ''}
      ${sw ? `<details class="swim-prog"><summary class="small">🏊 ${esc(sw.name)} · ${fmtNum(sw.m)} m · ${esc(sw.focus)}${it.swimId ? '' : ' (Vorschlag)'}</summary><p class="small pre">${esc(sw.desc)}</p>
        ${opts.edit !== false ? `<select class="mini-select" data-swim-for="${esc(it.id)}" aria-label="Programm wählen">${SWIM.map((s) => `<option value="${s.id}" ${s.id === sw.id ? 'selected' : ''}>${esc(s.name)} (${s.m} m)</option>`).join('')}</select>` : ''}</details>` : ''}
      ${!done && (tpl || sw) ? `<div class="pr-start">${tpl ? `<button class="btn btn-sm btn-primary" data-action="tpl-start" data-id="${esc(tpl.id)}">${esc(tpl.name)} starten</button>` : ''}${sw ? `<button class="btn btn-sm" data-action="swim-log" data-swim="${esc(sw.id)}" data-date="${esc(it.date)}">Schwimmen erfassen</button>` : ''}</div>` : ''}
      ${state.planMove === it.id ? `<div class="move-row"><input type="date" id="move-date" value="${esc(it.date)}" aria-label="Neues Datum"><button class="btn btn-sm btn-primary" data-action="plan-move-ok" data-id="${esc(it.id)}">Verschieben</button><button class="btn btn-sm" data-action="plan-move-cancel">Abbrechen</button></div>` : ''}
    </div>
    ${opts.edit !== false ? `<div class="pr-acts">
      <button class="icon-btn sm" data-action="plan-move" data-id="${esc(it.id)}" aria-label="Verschieben" title="Verschieben">${icon('arrow', 16)}</button>
      <button class="icon-btn sm" data-action="plan-remove" data-id="${esc(it.id)}" aria-label="Aus dem Plan entfernen" title="Entfernen">${icon('close', 16)}</button>
    </div>` : ''}
  </div>`;
}

/** The coach has the last word: show today's coach assessment next to the traffic light. */
function coachToday() {
  const ins = state.data?.insights;
  const an = ins?.analysis;
  if (!an?.readiness || !ins.generatedAt || ins.generatedAt.slice(0, 10) !== todayISO()) {
    return '<p class="muted small">Die Ampel ist eine schnelle Einschätzung der App. Das letzte Wort hat der Coach – starte eine Analyse für seine Einschätzung.</p>';
  }
  return `<p class="coach-word">${icon('sparkles', 14)}<span><strong>Coach (${esc(relTime(ins.generatedAt))}):</strong> ${esc(an.readiness.label || '')}${an.readiness.score != null ? ` · ${an.readiness.score}/100` : ''}. Seine Einschätzung hat Vorrang.</span></p>`;
}

const READY_FACTORS = [['sleep', 'Schlaf letzte Nacht'], ['recovery', 'Erholungszeit'], ['hrv', 'HRV-Status'], ['load', 'Akute Belastung'], ['sleepHistory', 'Schlaf 3 Nächte'], ['stressHistory', 'Stress 3 Tage']];
const READY_FEEDBACK = { VERY_GOOD: 'sehr gut', EXCELLENT: 'sehr gut', GOOD: 'gut', MODERATE: 'mittel', FAIR: 'mittel', POOR: 'schwach', VERY_POOR: 'sehr schwach', LOW: 'tief', HIGH: 'hoch', OPTIMAL: 'optimal' };
const READY_LEVEL = (s) => (s >= 95 ? 'Prime' : s >= 75 ? 'Hoch' : s >= 50 ? 'Mittel' : s >= 25 ? 'Niedrig' : 'Schlecht');

/** Garmin Training Readiness with the six factors behind it. */
function readinessCard() {
  const r = snapshot().readiness;
  if (r?.score == null) return '';
  const color = r.score >= 75 ? 'var(--good)' : r.score >= 50 ? 'var(--s-run)' : r.score >= 25 ? 'var(--warn)' : 'var(--bad)';
  const factors = READY_FACTORS.filter(([k]) => r.factors?.[k]);
  const stale = r.at && r.at.slice(0, 10) !== todayISO();
  return `<article class="card readiness-card">
    <div class="rd-head">
      ${ring(r.score, { size: 96, color, label: READY_LEVEL(r.score) })}
      <div><p class="eyebrow">Garmin Training Readiness${stale ? ` · ${esc(relDay(r.at.slice(0, 10)))}` : ''}</p>
        <h2>${esc(READY_LEVEL(r.score))}${r.morningScore != null && r.morningScore !== r.score ? ` <span class="muted small">(Morgen: ${r.morningScore})</span>` : ''}</h2>
        <p class="muted small">${r.recoveryTimeH ? `Erholungszeit noch ${r.recoveryTimeH} h · ` : ''}Der Wert ändert sich über den Tag – nach einem Training sinkt er.</p></div>
    </div>
    ${factors.length ? `<div class="rd-factors">${factors.map(([k, l]) => {
      const f = r.factors[k];
      return `<div class="rd-f"><span>${esc(l)}</span><span class="rd-bar"><i style="width:${Math.max(3, Math.min(100, f.pct ?? 0))}%"></i></span><span class="muted small">${esc(READY_FEEDBACK[f.feedback] || (f.feedback || '').toLowerCase().replaceAll('_', ' ') || (f.pct != null ? `${f.pct} %` : ''))}</span></div>`;
    }).join('')}</div><p class="muted small">Balken = wie stark der Faktor deine Bereitschaft gerade stützt (100 % = voll).</p>` : ''}
  </article>`;
}

function todayCard(acts) {
  const L = light();
  const today = todayISO();
  const items = planRange(today, today);
  const lims = activeLimits(limitsList());
  return `<article class="card today-card tl-${L.level}">
    <header class="tl-head">
      <span class="tl-lamp" aria-hidden="true"><i></i><i></i><i></i></span>
      <div><p class="eyebrow">Ampel heute</p><h2>${esc(L.label)}</h2></div>
      <button class="btn btn-sm" data-action="limit-new">${icon('alert', 14)}<span>Einschränkung melden</span></button>
    </header>
    <ul class="tl-reasons">${L.reasons.map((r) => `<li class="l${r.level}">${esc(r.text)}</li>`).join('')}</ul>
    ${coachToday()}
    ${lims.length ? `<div class="limits">${lims.map(limitChip).join('')}</div>` : ''}
    <header class="card-head sub-head"><h3>Heute geplant</h3><a class="link" href="#/plan">Wochenplan ${icon('chevron', 14)}</a></header>
    ${items.length ? `<div class="plan-items">${items.map((it) => planRow(it, acts, L)).join('')}</div>`
      : '<p class="muted small">Nichts geplant – Ruhetag oder freie Wahl.</p>'}
  </article>`;
}

// ── stretching (today) ──
let stretchSaveTimer = null;
let stretchTimer = null;
function stretchCard() {
  const items = stretchItems();
  const today = todayISO();
  const log = stretchLog()[today] || { done: [] };
  const done = new Set(log.done || []);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));
  const weekDone = week.filter((d) => stretchLog()[d]?.complete).length;
  const head = `<header class="card-head"><h2>🧘 Dehnen heute</h2><span class="muted small">${log.complete ? 'Erledigt ✓ · ' : items.length ? `${done.size}/${items.length} · ` : ''}${weekDone}/7 diese Woche</span></header>`;
  if (!items.length) {
    return `<article class="card stretch-card">${head}
      <p class="muted small">Noch keine Dehnübungen hinterlegt. Trag deine Übungen unter Einstellungen → Dehnen ein (oder lade dort einen Vorschlag). Bis dahin kannst du die Einheit als Ganzes abhaken.</p>
      <div class="form-actions"><button class="btn ${log.complete ? 'btn-primary' : ''}" data-action="stretch-day" data-date="${today}">${icon('check', 16)}${log.complete ? 'Heute gedehnt ✓' : 'Heute gedehnt'}</button><a class="btn" href="#/einstellungen">Übungen eintragen</a></div>
    </article>`;
  }
  return `<article class="card stretch-card">${head}
    <p class="muted small">ca. ${stretchMinutes(items)} Min. · nach dem Training oder am Abend, nicht vor dem Krafttraining</p>
    <ul class="stretch-list">${items.map((it) => `<li class="${done.has(it.id) ? 'done' : ''}">
      <button class="check" data-action="stretch-item" data-id="${esc(it.id)}" aria-pressed="${done.has(it.id)}" aria-label="${esc(it.name)} erledigt">${icon('check', 15)}</button>
      <div><span>${esc(it.name)}</span><span class="muted small">${it.sec || 30} s${it.sides ? ' pro Seite' : ''}${it.note ? ` · ${esc(it.note)}` : ''}</span></div>
      <button class="btn btn-sm st-timer" data-action="stretch-timer" data-id="${esc(it.id)}" id="stt-${esc(it.id)}">${stretchTimer?.id === it.id ? esc(stretchTimer.label) : 'Start'}</button>
    </li>`).join('')}</ul>
  </article>`;
}

function setStretch(day, mutateLog) {
  const m = state.data.manual ??= {};
  m.stretch ??= {};
  const items = stretchItems();
  const log = { done: [], ...(m.stretch[day] || {}) };
  const was = !!log.complete;
  mutateLog(log);
  log.done = log.done.filter((id) => !items.length || items.some((i) => i.id === id));
  if (items.length) log.complete = log.done.length >= items.length;
  if (!log.complete && !log.done.length) delete m.stretch[day]; else m.stretch[day] = log;
  render();
  if (log.complete && !was) toast('Dehnen erledigt – gut gemacht!');
  // several taps in a row → one commit
  clearTimeout(stretchSaveTimer);
  const snapshotLog = m.stretch[day] ? JSON.parse(JSON.stringify(m.stretch[day])) : null;
  stretchSaveTimer = setTimeout(() => {
    store.updateManual((mm) => {
      mm.stretch ??= {};
      if (snapshotLog) mm.stretch[day] = snapshotLog; else delete mm.stretch[day];
      return mm;
    }, `Dehnen ${day}`).catch((err) => toast(`Speichern fehlgeschlagen: ${err.message}`, 'error'));
  }, 1500);
}

function startStretchTimer(id) {
  const it = stretchItems().find((i) => i.id === id);
  if (!it) return;
  const stop = () => { clearInterval(stretchTimer?.h); stretchTimer = null; };
  if (stretchTimer?.id === id) { stop(); render(); return; }
  stop();
  const per = it.sec || 30;
  const sides = it.sides ? 2 : 1;
  const T = { id, left: per, side: 1, label: '' };
  const lab = () => { T.label = `${sides > 1 ? (T.side === 1 ? 'Links ' : 'Rechts ') : ''}${Math.floor(T.left / 60)}:${String(T.left % 60).padStart(2, '0')}`; };
  lab();
  stretchTimer = T;
  render();
  T.h = setInterval(() => {
    T.left -= 1;
    if (T.left <= 0) {
      if (T.side < sides) { T.side += 1; T.left = per; navigator.vibrate?.(200); toast('Seite wechseln'); } else {
        stop();
        navigator.vibrate?.([200, 100, 200]);
        setStretch(todayISO(), (log) => { if (!log.done.includes(id)) log.done.push(id); });
        return;
      }
    }
    lab();
    const b = document.getElementById(`stt-${id}`);
    if (b) b.textContent = T.label;
  }, 1000);
}

// ── race countdown ──
const fmtRace = (sec) => (sec ? fmtClock(Math.round(sec)) : '–');
function raceCard(acts) {
  const r = profile().race;
  if (!r?.date) return '';
  const ph = racePhase(r);
  if (ph.days < -7) return '';
  const dist = r.distanceKm || HM_KM;
  const est = raceEstimate(acts, dist);
  const garmin = Math.abs(dist - HM_KM) < 0.1 ? snapshot().racePredictions?.half : Math.abs(dist - 10) < 0.1 ? snapshot().racePredictions?.['10k'] : null;
  const diff = (sec) => (r.goalSec && sec ? `<span class="trend ${sec <= r.goalSec ? 'good' : 'bad'}">${sec <= r.goalSec ? '−' : '+'}${fmtClock(Math.abs(Math.round(sec - r.goalSec)))} zum Ziel</span>` : '');
  return `<article class="card race-card">
    <div class="race-count"><strong>${ph.days > 0 ? ph.days : '🏁'}</strong><span>${ph.days > 1 ? 'Tage' : ph.days === 1 ? 'Tag' : ''}</span></div>
    <div class="race-main">
      <p class="eyebrow">${esc(r.name || RACE_DISTANCES[dist] || 'Wettkampf')} · ${esc(fmtDate(r.date, { day: 'numeric', month: 'long' }))}</p>
      <h2>${esc(ph.label)}</h2>
      <p class="muted small">${esc(ph.text)}</p>
      <dl class="stat-grid race-stats">
        ${r.goalSec ? `<div><dt>Ziel</dt><dd>${fmtRace(r.goalSec)}</dd><span class="muted small">${fmtPace(r.goalSec / dist)} /km</span></div>` : ''}
        <div><dt>Prognose aus deinen Läufen</dt><dd>${fmtRace(est?.sec)}</dd>${diff(est?.sec)}</div>
        ${garmin ? `<div><dt>Garmin-Prognose</dt><dd>${fmtRace(garmin)}</dd>${diff(garmin)}</div>` : ''}
      </dl>
      ${est ? `<p class="muted small">Basis: ${esc(actTitle(est.run))} vom ${esc(fmtDate(est.run.date, { day: 'numeric', month: 'short' }))} (${fmtNum(est.run.distanceKm, 1)} km${est.factor < 1 ? `, hochgerechnet mit RPE ${est.rpe}${est.run.rpe ? '' : ' (geschätzt)'}` : ''}).</p>` : '<p class="muted small">Für eine eigene Prognose braucht es einen Lauf ab 5 km in den letzten 8 Wochen.</p>'}
    </div>
  </article>`;
}

// ── unfinished strength session ──
function draftBanner() {
  const d = store.localGet('draft');
  if (!d) return '';
  return `<div class="banner draft-banner">${icon('clock', 18)}
    <p><strong>Angefangenes Training:</strong> ${esc(d.fields?.title || 'Krafttraining')} · ${esc(relTime(d.savedAt))}</p>
    <button class="btn btn-sm btn-primary" data-action="draft-resume">Fortsetzen</button>
    <button class="btn btn-sm" data-action="draft-discard">Verwerfen</button>
  </div>`;
}


function strengthCard(acts) {
  const p = profile();
  if (!p.templates.length || (p.sports?.length && !p.sports.includes('strength'))) return '';
  const next = nextTemplate(p.templates, acts);
  const cat = catalog(p);
  const untested = next.items.filter((i) => { const ex = cat.find((e) => e.id === i.id); return ex && ex.unit !== 's' && !ex.bw && !exerciseHistory(acts, i.id).length; });
  return `<article class="card strength-next">${untested.length >= 3 ? `<p class="small eval-hint">${icon('target', 14)} Für ${untested.length} Übungen gibt es noch keine Werte. Mit der <button class="link" data-action="eval-start">Einstufung</button> bekommst du passende Startgewichte.</p>` : ''}
    <div><p class="eyebrow">Krafttraining</p><h2>Als Nächstes: ${esc(next.name)}</h2>
    <p class="muted small">${esc(next.items.map((i) => catalog(p).find((e) => e.id === i.id)?.name || i.id).join(' · '))}</p></div>
    <div class="ex-actions">
      <button class="btn btn-primary" data-action="tpl-start" data-id="${esc(next.id)}">${icon('plus', 16)}${esc(next.name)} starten</button>
      ${p.templates.filter((t) => t.id !== next.id).map((t) => `<button class="btn" data-action="tpl-start" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
    </div>
  </article>`;
}

// ───────────────────────── page: plan ─────────────────────────
const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const PLAN_SPORTS = () => {
  const p = profile();
  const active = p.sports?.length ? p.sports : Object.keys(SPORTS);
  return Object.keys(SPORTS).filter((k) => active.includes(k) || k === 'other');
};

function renderPlan() {
  const view = state.planView;
  return `${pageHead('Plan', 'Woche, feste Termine & Kalender', `
      <div class="segmented" role="group" aria-label="Ansicht">${[['week', 'Woche'], ['month', 'Kalender']].map(([k, l]) => `<button data-action="plan-view" data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>
      <a class="btn" href="#/aktivitaeten">${icon('list', 16)}<span>Aktivitäten</span></a>`)}
    ${demoBanner()}
    ${view === 'month' ? calendarView() : weekView()}`;
}

function weekView() {
  const acts = activities();
  const L = light();
  const today = todayISO();
  const wk = state.planWeek || weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const items = planRange(wk, addDays(wk, 6));
  const stretchOn = stretchItems().length || Object.keys(stretchLog()).length;
  const done = items.filter((it) => planDone(it, acts)).length;
  const p = profile();
  const an = analysis();
  const suggestions = (an?.plan || []).filter((x) => x.type !== 'rest' && x.date >= today);
  const own = manualData().plan || [];
  const taken = (x) => own.some((o) => o.date === x.date && o.sport === x.type && o.title === x.title);

  const dayHtml = (d) => {
    const its = items.filter((x) => x.date === d);
    const logged = acts.filter((a) => a.date === d);
    const lims = activeLimits(limitsList(), d).filter((l) => d <= today || l.to);
    const st = stretchLog()[d];
    return `<section class="pw-day${d === today ? ' is-today' : ''}${d < today ? ' past' : ''}">
      <header><div><strong>${d === today ? 'Heute' : WEEKDAYS_LONG[(parseDay(d).getDay() + 6) % 7]}</strong> <span class="muted small">${esc(fmtDate(d, { day: 'numeric', month: 'short' }))}</span></div>
        ${lims.length ? `<span class="chip warn">${esc(lims.map((l) => LIMIT_SHORT[l.kind]).join(', '))}</span>` : ''}</header>
      ${its.length ? its.map((it) => planRow(it, acts, L)).join('') : '<p class="muted small rest">Ruhetag</p>'}
      ${logged.length ? `<p class="small logged">${icon('check', 13)} Erfasst: ${logged.map((a) => `<button class="link" data-action="open-activity" data-id="${esc(a.id)}">${sport(a.type).emoji} ${esc(actTitle(a))}</button>`).join(' · ')}</p>` : ''}
      <div class="day-foot">
        ${stretchOn ? `<button class="chip-toggle${st?.complete ? ' on' : ''}" data-action="stretch-day" data-date="${d}" aria-pressed="${!!st?.complete}">🧘 Dehnen${st?.complete ? ' ✓' : ''}</button>` : ''}
        <button class="link small" data-action="plan-add" data-date="${d}">${icon('plus', 13)} Einheit</button>
      </div>
      ${state.planAdd === d ? planAddForm(d) : ''}
    </section>`;
  };

  return `<div class="week-nav">
      <button class="icon-btn" data-action="plan-week" data-step="-1" aria-label="Vorherige Woche">‹</button>
      <div><strong>KW ${isoWeek(wk)}</strong> <span class="muted small">${esc(fmtDate(wk, { day: 'numeric', month: 'short' }))} – ${esc(fmtDate(addDays(wk, 6), { day: 'numeric', month: 'short' }))}</span></div>
      <button class="icon-btn" data-action="plan-week" data-step="1" aria-label="Nächste Woche">›</button>
      ${wk !== weekStart(today) ? '<button class="btn btn-sm" data-action="plan-week" data-step="0">Heute</button>' : ''}
      <span class="muted small week-done">${done}/${items.length} erledigt</span>
    </div>
    <div class="plan-week">${days.map(dayHtml).join('')}</div>
    <section class="grid two">
      ${suggestions.length ? `<article class="card">
        <header class="card-head"><h2>${icon('sparkles', 18)} Vorschlag vom Coach</h2>${suggestions.some((x) => !taken(x)) ? '<button class="btn btn-sm" data-action="plan-take-all">Alle übernehmen</button>' : ''}</header>
        <div class="sugg-list">${suggestions.map((x, i) => `<div class="sugg-item">
          <div><strong>${esc(weekdayShort(x.date))} ${esc(fmtDate(x.date, { day: 'numeric', month: 'short' }))} · ${sport(x.type).emoji} ${esc(x.title)}</strong><p class="muted small">${esc(x.details || '')}</p></div>
          ${taken(x) ? '<span class="chip good">im Plan</span>' : `<button class="btn btn-sm" data-action="plan-take" data-i="${(an.plan || []).indexOf(x)}">Übernehmen</button>`}
        </div>`).join('')}</div>
      </article>` : ''}
      ${recurringCard(p)}
      <article class="card">
        <header class="card-head"><h2>${icon('calendar', 18)} In die Kalender-App</h2></header>
        <p class="muted small">Lädt eine Kalender-Datei mit deinem Plan der nächsten 4 Wochen (ganztägige Einträge). Auf dem iPhone öffnen und «Alle hinzufügen» tippen. Das ist eine Momentaufnahme – nach Änderungen erneut laden.</p>
        <div class="form-actions"><button class="btn" data-action="ics-plan">${icon('download', 16)}Plan als Kalender-Datei</button></div>
      </article>
    </section>`;
}

function planAddForm(d) {
  const p = profile();
  return `<form class="form plan-add" data-date="${d}">
    <div class="row">
      <label class="field"><span>Sportart</span><select name="sport">${PLAN_SPORTS().map((k) => `<option value="${k}">${SPORTS[k].emoji} ${esc(SPORTS[k].label)}</option>`).join('')}</select></label>
      <label class="field grow"><span>Titel</span><input name="title" placeholder="z.B. Lockerer Lauf 45′" maxlength="80"></label>
    </div>
    ${p.templates.length ? `<label class="field"><span>Kraft-Vorlage <em>optional</em></span><select name="templateId"><option value="">–</option>${p.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
    <div class="form-actions"><button type="button" class="btn btn-sm" data-action="plan-add-cancel">Abbrechen</button><button class="btn btn-sm btn-primary" type="submit">${icon('check', 14)}Eintragen</button></div>
  </form>`;
}

function recurringCard(p) {
  const rec = p.recurring || [];
  return `<article class="card">
    <header class="card-head"><h2>📌 Feste Termine</h2><span class="muted small">jede Woche automatisch im Plan</span></header>
    ${rec.length ? `<ul class="custom-ex">${rec.map((r) => `<li><span>${esc(WEEKDAYS_LONG[r.weekday])} · ${sport(r.sport).emoji} ${esc(r.title || SPORTS[r.sport]?.label)}</span>
      <button class="icon-btn sm" data-action="rec-remove" data-id="${esc(r.id)}" aria-label="Termin entfernen">${icon('trash', 16)}</button></li>`).join('')}</ul>`
      : '<p class="muted small">Noch keine festen Termine.</p>'}
    <form id="rec-form" class="form" style="margin-top:12px">
      <div class="row">
        <label class="field"><span>Tag</span><select name="weekday">${WEEKDAYS_LONG.map((w, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="field"><span>Sportart</span><select name="sport">${PLAN_SPORTS().map((k) => `<option value="${k}" ${k === 'swim' ? 'selected' : ''}>${SPORTS[k].emoji} ${esc(SPORTS[k].label)}</option>`).join('')}</select></label>
        <label class="field grow"><span>Titel</span><input name="title" placeholder="z.B. Schwimmen" maxlength="60"></label>
      </div>
      ${p.templates.length ? `<label class="field"><span>Kraft-Vorlage <em>optional</em></span><select name="templateId"><option value="">–</option>${p.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
      <div class="form-actions"><button class="btn" type="submit">${icon('plus', 16)}Festen Termin hinzufügen</button></div>
    </form>
    <p class="muted small">Einzelne Termine kannst du im Wochenplan trotzdem verschieben oder streichen – die Regel bleibt.</p>
  </article>`;
}

function calendarView() {
  const today = todayISO();
  const month = state.calMonth || today.slice(0, 7);
  const first = `${month}-01`;
  const start = weekStart(first);
  const nextMonth = todayISO(new Date(parseDay(first).getFullYear(), parseDay(first).getMonth() + 1, 1));
  const end = addDays(weekStart(addDays(nextMonth, -1)), 6);
  const acts = activities();
  const items = planRange(start, end);
  const ci = checkins();
  const st = stretchLog();
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const da = acts.filter((a) => a.date === d);
    const open = items.filter((x) => x.date === d && !planDone(x, acts));
    const score = checkinScore(ci[d]);
    const lim = activeLimits(limitsList(), d).filter((l) => d <= today || l.to).length;
    cells.push(`<button class="cal-day${d.slice(0, 7) !== month ? ' other' : ''}${d === today ? ' today' : ''}${lim ? ' limited' : ''}" data-action="cal-day" data-date="${d}"
      aria-label="${esc(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}: ${da.length} Aktivitäten, ${open.length} geplant">
      <span class="cal-num">${parseDay(d).getDate()}</span>
      <span class="cal-dots">${da.map((a) => `<i style="background:${sportColor(a.type)}" title="${esc(actTitle(a))}"></i>`).join('')}${open.map((x) => `<i class="planned" style="--c:${sportColor(x.sport)}" title="geplant: ${esc(x.title || '')}"></i>`).join('')}</span>
      <span class="cal-meta">${score != null ? `<b class="ci-${score >= 3.5 ? 'g' : score >= 2.5 ? 'y' : 'r'}"></b>` : ''}${st[d]?.complete ? '🧘' : ''}</span>
    </button>`);
  }
  const monthActs = acts.filter((a) => a.date.startsWith(month));
  const label = parseDay(first).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  const shift = (n) => { const d = parseDay(first); d.setMonth(d.getMonth() + n); return todayISO(d).slice(0, 7); };
  return `<article class="card calendar">
    <div class="week-nav">
      <button class="icon-btn" data-action="cal-month" data-month="${shift(-1)}" aria-label="Vorheriger Monat">‹</button>
      <div><strong>${esc(label)}</strong> <span class="muted small">${monthActs.length} Einheiten · ${fmtDur(monthActs.reduce((s, a) => s + (a.durationMin || 0), 0))}</span></div>
      <button class="icon-btn" data-action="cal-month" data-month="${shift(1)}" aria-label="Nächster Monat">›</button>
      ${month !== today.slice(0, 7) ? `<button class="btn btn-sm" data-action="cal-month" data-month="${today.slice(0, 7)}">Heute</button>` : ''}
    </div>
    <div class="cal-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}${cells.join('')}</div>
    <div class="legend cal-legend">${sportsIn(monthActs).map((t) => `<span><i style="background:${sportColor(t)}"></i>${esc(SPORT_LABELS[t])}</span>`).join('')}
      <span><i class="planned-i"></i>geplant</span><span><i class="ci-g-i"></i>Check-in gut</span><span><i class="ci-r-i"></i>tief</span><span>🧘 gedehnt</span></div>
    <p class="muted small">Tipp: Tag antippen öffnet die Woche.</p>
  </article>`;
}

// ── limits (sheet) ──
function openLimitForm() {
  openSheet(`<form id="limit-form" class="sheet-body form" novalidate>
    <header class="sheet-head"><div><h2>Einschränkung melden</h2><p class="muted">Plan, Ampel und Coach passen sich an.</p></div>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Schliessen">${icon('close')}</button></header>
    <div class="segmented lim-kind">${Object.entries(LIMIT_KIND).map(([k, l], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>
    <label class="field"><span>Körperstelle oder Beschreibung</span><input name="area" placeholder="z.B. rechtes Knie, Erkältung" maxlength="60"></label>
    <div class="row">
      <label class="field"><span>Von</span><input type="date" name="from" value="${todayISO()}"></label>
      <label class="field"><span>Bis <em>optional</em></span><input type="date" name="to"></label>
    </div>
    <fieldset class="chip-checks"><legend>Was ist betroffen?</legend>
      ${Object.entries(AFFECTS).map(([k, l]) => `<label><input type="checkbox" name="affects" value="${k}">${esc(l)}</label>`).join('')}</fieldset>
    <label class="switch ill-only"><input type="checkbox" name="fever"><span></span>Fieber oder Symptome unterhalb des Halses (Husten, Brust, Magen)</label>
    <label class="field"><span>Notiz</span><input name="note" placeholder="z.B. Schmerz 3/10 beim Laufen, nicht in Ruhe" maxlength="120"></label>
    <p class="muted small">Bei starken, zunehmenden oder unklaren Beschwerden ärztlich abklären lassen.</p>
    <footer class="sheet-actions"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button><button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern</button></footer>
  </form>`);
}

async function submitLimit(form) {
  const fd = new FormData(form);
  const kind = fd.get('kind');
  const rec = JSON.parse(JSON.stringify({
    id: newId('l'), kind, area: fd.get('area').trim() || undefined, from: fd.get('from') || todayISO(), to: fd.get('to') || undefined,
    affects: kind === 'ill' ? Object.keys(AFFECTS) : fd.getAll('affects'), fever: kind === 'ill' && fd.get('fever') === 'on' ? true : undefined,
    note: fd.get('note').trim() || undefined, created: new Date().toISOString(),
  }));
  sheet.close();
  await saveManual((m) => { m.limits = [rec, ...(m.limits || [])]; }, `Einschränkung: ${LIMIT_SHORT[kind]}`, 'Einschränkung gespeichert');
}

// ── evaluation (Einstufung) ──
function evalExercises() {
  const p = profile();
  const cat = catalog(p);
  const seen = new Map();
  for (const t of p.templates) {
    for (const i of t.items) {
      const ex = cat.find((e) => e.id === i.id);
      if (!ex || seen.has(ex.id)) continue;
      seen.set(ex.id, { ex, item: { ...i, inc: i.inc ?? defaultInc(ex) }, skip: ex.unit === 's' || ex.bw || !(i.inc ?? defaultInc(ex)) });
    }
  }
  return [...seen.values()];
}

function openEval() {
  const list = evalExercises();
  if (!list.length) { toast('Lege zuerst Trainingsvorlagen an (Einstellungen → Trainingsvorlagen).', 'error'); return; }
  openSheet(`<form id="eval-form" class="sheet-body form" novalidate>
    <header class="sheet-head"><div><h2>Einstufung</h2><p class="muted">Testtraining für deine Startgewichte</p></div>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Schliessen">${icon('close')}</button></header>
    <div class="banner"><p><strong>So gehst du vor:</strong> Kurz aufwärmen. Pro Übung 1–2 leichte Aufwärmsätze, dann das Gewicht in Stufen erhöhen. Für den Testsatz ein Gewicht wählen, das du etwa 6–10 Mal schaffst, und aufhören, wenn noch etwa 2 Wiederholungen gingen. Nie bis zum Muskelversagen, keine Maximalversuche. Mehr als 12 Wiederholungen → beim nächsten Versuch mehr Gewicht (höchstens 3–4 Versuche, 2–3 Min. Pause). Bei Kurzhanteln gilt das Gewicht pro Hand. Die App rechnet ein eher vorsichtiges Startgewicht für die ersten zwei Wochen.</p></div>
    <div class="eval-list">${list.map(({ ex, item, skip }) => skip
      ? `<div class="eval-row skip"><strong>${esc(ex.name)}</strong><span class="muted small">${ex.unit === 's' ? 'Zeitübung: startet mit der Zeit aus der Vorlage.' : 'Körpergewicht: kein Test nötig – im ersten Training eintragen, was sauber geht.'}</span></div>`
      : `<div class="eval-row" data-ex-id="${esc(ex.id)}" data-rep-min="${item.repMin}" data-inc="${item.inc}">
        <div><strong>${esc(ex.name)}</strong><span class="muted small">Ziel im Training: ${item.sets} × ${item.repMin}${item.repMax !== item.repMin ? `–${item.repMax}` : ''}</span></div>
        <div class="eval-inputs">
          <label class="field"><span>kg</span><input type="number" inputmode="decimal" step="0.5" min="0" name="kg"></label>
          <label class="field"><span>Wdh.</span><input type="number" inputmode="numeric" min="1" max="30" name="reps"></label>
          <label class="field"><span>Reserve</span><select name="rir">${[0, 1, 2, 3, 4].map((n) => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <output class="eval-out">–</output>
        </div>
      </div>`).join('')}</div>
    <label class="field"><span>Dauer (min)</span><input type="number" name="durationMin" inputmode="numeric" min="1" value="60"></label>
    <footer class="sheet-actions"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button><button type="submit" class="btn btn-primary">${icon('check', 16)}Startgewichte speichern</button></footer>
  </form>`);
}

function evalRowResult(row) {
  const v = (n) => Number(row.querySelector(`[name=${n}]`).value);
  return startKg(v('kg'), v('reps'), v('rir'), Number(row.dataset.repMin), Number(row.dataset.inc) || 2.5);
}

async function submitEval(form) {
  const cat = catalog(profile());
  const rows = [...form.querySelectorAll('.eval-row:not(.skip)')].filter((r) => evalRowResult(r) > 0);
  if (!rows.length) { toast('Trag mindestens einen Testsatz ein (kg und Wiederholungen).', 'error'); return; }
  const exercises = rows.map((r) => {
    const ex = cat.find((e) => e.id === r.dataset.exId);
    return { id: ex.id, name: ex.name, group: ex.group, sets: [{ kg: Number(r.querySelector('[name=kg]').value), reps: Number(r.querySelector('[name=reps]').value) }], startKg: evalRowResult(r) };
  });
  const now = new Date();
  const activity = {
    id: newId('m'), source: 'manual', type: 'strength', eval: true, title: 'Einstufung', date: todayISO(),
    start: `${todayISO()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`,
    durationMin: Number(new FormData(form).get('durationMin')) || 60, exercises,
  };
  try {
    await store.saveActivity(activity);
    sheet.close();
    toast(`Startgewichte gespeichert: ${exercises.map((e) => `${e.name} ${fmtNum(e.startKg, 1)} kg`).join(', ')}`, 'ok', 8000);
    await reload();
  } catch (err) { toast(`Speichern fehlgeschlagen: ${err.message}`, 'error'); }
}

// ── draft of an unfinished strength session (per device) ──
let draftTimer = null;
function saveDraftSoon(form) {
  if (form?.dataset.mode !== 'new') return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!form.isConnected) return;
    const fd = new FormData(form);
    if (fd.get('type') !== 'strength') return;
    const blocks = [...form.querySelectorAll('.ex-block')].map((b) => ({
      id: b.dataset.exId, name: b.dataset.exName, group: b.dataset.exGroup, unit: b.dataset.exUnit || undefined,
      plan: b.dataset.plan ? JSON.parse(b.dataset.plan) : null, decision: b.dataset.decision || '',
      sets: [...b.querySelectorAll('.set-row')].map((r) => ({ kg: r.querySelector('[data-f=kg]').value, reps: r.querySelector('[data-f=reps]').value })),
    }));
    if (!blocks.some((b) => b.sets.some((s) => s.kg || s.reps))) return;
    const fields = Object.fromEntries(['title', 'date', 'time', 'durationMin', 'avgHr', 'rpe', 'feeling', 'notes', 'templateId'].map((k) => [k, fd.get(k) ?? '']));
    store.localSet('draft', {
      fields, blocks, warm: fd.getAll('warm').length, started: form.dataset.started, step: form.dataset.step,
      gym: form.classList.contains('gym-on'), newExercises: form.dataset.newExercises, savedAt: new Date().toISOString(),
    });
  }, 600);
}

function resumeDraft() {
  const d = store.localGet('draft');
  if (!d) return;
  openForm({ type: 'strength', date: d.fields.date || todayISO(), title: d.fields.title, rpe: Number(d.fields.rpe) || undefined, feeling: Number(d.fields.feeling) || undefined, notes: d.fields.notes, templateId: d.fields.templateId, durationMin: d.fields.durationMin || undefined, avgHr: d.fields.avgHr || undefined }, { draft: true });
  const form = $('#act-form');
  form.dataset.mode = 'new';
  form.dataset.id = '';
  if (d.newExercises) form.dataset.newExercises = d.newExercises;
  if (d.fields.time) form.elements.time.value = d.fields.time;
  const all = activities();
  form.querySelector('.ex-list').innerHTML = d.blocks.map((b) => {
    const hist = exerciseHistory(all, b.id);
    return exerciseBlock({ id: b.id, name: b.name, group: b.group, unit: b.unit, sets: b.sets }, hist[0], b.plan ? { ...b.plan, decision: b.decision } : undefined);
  }).join('');
  form.querySelectorAll('[name=warm]').forEach((c, i) => { c.checked = i < (d.warm || 0); });
  if (d.started) form.dataset.started = d.started;
  if (d.gym) { form.dataset.step = d.step || '0'; gymStart(form); }
}

// ── settings: race, stretching, reminders ──
function raceSettingsCard(p) {
  const r = p.race || {};
  const g = r.goalSec ? fmtClock(r.goalSec) : '';
  return `<article class="card">
    <header class="card-head"><h2>🏁 Wettkampf</h2>${r.date ? `<span class="muted small">in ${Math.max(0, daysBetween(todayISO(), r.date))} Tagen</span>` : ''}</header>
    <form id="race-form" class="form">
      <div class="row">
        <label class="field grow"><span>Name</span><input name="name" value="${esc(r.name || '')}" placeholder="z.B. Zürich Halbmarathon" maxlength="60"></label>
        <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(r.date || '')}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Distanz</span><select name="distanceKm">${Object.entries(RACE_DISTANCES).map(([k, l]) => `<option value="${k}" ${Number(k) === (r.distanceKm || HM_KM) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Zielzeit (h:mm:ss)</span><input name="goal" value="${esc(g)}" placeholder="1:45:00" inputmode="numeric" pattern="[0-9:]*"></label>
      </div>
      <p class="muted small">Ohne Datum zeigt die App nur Zielpace und Prognose. Mit Datum gibt es Countdown und Phasen (Aufbau, spezifisch, Tapering), und der Coach plant darauf hin.</p>
      <div class="form-actions">${r.date || r.goalSec ? '<button type="button" class="btn btn-danger" data-action="race-clear">Entfernen</button>' : ''}<button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern</button></div>
    </form>
  </article>`;
}

function parseClock(v) {
  const parts = String(v || '').trim().split(':').map(Number);
  if (!parts.length || parts.some((x) => Number.isNaN(x))) return 0;
  return parts.reduce((s, x) => s * 60 + x, 0) * (parts.length === 2 ? 60 : 1);
}

function stretchSettingsCard(p) {
  const items = p.stretch || [];
  return `<article class="card">
    <header class="card-head"><h2>🧘 Dehnen</h2><span class="muted small">${items.length ? `${items.length} Übungen · ca. ${stretchMinutes(items)} Min.` : 'noch leer'}</span></header>
    <form id="stretch-form" class="form">
      <div class="st-rows">${(items.length ? items : [{ id: '', name: '', sec: 30 }]).map(stretchRow).join('')}</div>
      <div class="form-actions">
        <button type="button" class="btn btn-sm" data-action="st-row-add">${icon('plus', 14)}Übung</button>
        ${!items.length ? '<button type="button" class="btn btn-sm" data-action="st-suggest">Vorschlag laden</button>' : ''}
        <button type="submit" class="btn btn-sm btn-primary">${icon('check', 14)}Dehnroutine speichern</button>
      </div>
    </form>
    <p class="muted small">Statisch gehalten, ruhig atmen, kein Schmerz. Am besten nach dem Training oder am Abend – nicht direkt vor dem Krafttraining.</p>
  </article>`;
}
const stretchRow = (it) => `<div class="st-row" data-id="${esc(it.id || '')}">
  <label class="field grow"><span>Übung</span><input name="st-name" value="${esc(it.name || '')}" placeholder="z.B. Hüftbeuger im Ausfallschritt" maxlength="60"></label>
  <label class="field"><span>Sek.</span><input name="st-sec" type="number" min="5" step="5" inputmode="numeric" value="${esc(it.sec ?? 30)}"></label>
  <label class="switch sm"><input type="checkbox" name="st-sides" ${it.sides ? 'checked' : ''}><span></span>je Seite</label>
  <button type="button" class="icon-btn sm" data-action="st-row-remove" aria-label="Übung entfernen">${icon('trash', 16)}</button>
</div>`;

function submitStretch(form) {
  const items = [...form.querySelectorAll('.st-row')].map((r) => ({
    id: r.dataset.id || newId('st'), name: r.querySelector('[name=st-name]').value.trim(),
    sec: Number(r.querySelector('[name=st-sec]').value) || 30, sides: r.querySelector('[name=st-sides]').checked || undefined,
  })).filter((i) => i.name);
  return saveProfile((p) => ({ ...p, stretch: items }), items.length ? 'Dehnroutine gespeichert' : 'Dehnroutine geleert');
}

function remindersCard(p) {
  const r = { checkin: '07:30', stretch: '21:00', checkinOn: true, stretchOn: true, ...(p.reminders || {}) };
  return `<article class="card">
    <header class="card-head"><h2>${icon('bell', 18)} Erinnerungen</h2></header>
    <p class="muted small">Web-Apps dürfen auf dem iPhone nicht zuverlässig selbst erinnern. Deshalb erstellt die App eine Kalender-Datei mit täglichen Terminen inkl. Hinweis – die Kalender-App meldet sich dann pünktlich.</p>
    <form id="reminder-form" class="form">
      <div class="row">
        <label class="switch"><input type="checkbox" name="checkinOn" ${r.checkinOn ? 'checked' : ''}><span></span>Check-in</label>
        <label class="field"><span>um</span><input type="time" name="checkin" value="${esc(r.checkin)}"></label>
      </div>
      <div class="row">
        <label class="switch"><input type="checkbox" name="stretchOn" ${r.stretchOn ? 'checked' : ''}><span></span>Dehnen</label>
        <label class="field"><span>um</span><input type="time" name="stretch" value="${esc(r.stretch)}"></label>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('download', 16)}Speichern & Kalender-Datei laden</button></div>
    </form>
    <details class="small"><summary>So geht's auf dem iPhone</summary>
      <ol class="howto"><li>Auf «Kalender-Datei laden» tippen.</li><li>Falls eine Vorschau erscheint: «Alle hinzufügen» bzw. «Zum Kalender hinzufügen» wählen.</li><li>Klappt es in der Web-App nicht, die App-Adresse in Safari öffnen und dort laden.</li><li>Zeit ändern: neue Datei laden und den alten Termin im Kalender löschen.</li></ol></details>
  </article>`;
}

function downloadText(name, text, type) {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function submitReminders(form) {
  const fd = new FormData(form);
  const r = { checkin: fd.get('checkin') || '07:30', stretch: fd.get('stretch') || '21:00', checkinOn: fd.get('checkinOn') === 'on', stretchOn: fd.get('stretchOn') === 'on' };
  const url = location.href.split('#')[0];
  const reminders = [
    r.checkinOn && { id: 'checkin', time: r.checkin, title: 'Trainingsbuch: Check-in', text: 'Wie geht\'s dir heute? 30 Sekunden im Trainingsbuch.', url: `${url}#/heute` },
    r.stretchOn && { id: 'stretch', time: r.stretch, minutes: Math.max(5, stretchMinutes(stretchItems())), title: 'Trainingsbuch: Dehnen', text: stretchItems().map((i) => i.name).join(', ') || 'Tägliche Dehneinheit', url: `${url}#/heute` },
  ].filter(Boolean);
  if (reminders.length) downloadText('trainingsbuch-erinnerungen.ics', buildIcs({ reminders }), 'text/calendar');
  return saveProfile((p) => ({ ...p, reminders: r }), reminders.length ? 'Kalender-Datei geladen – öffnen und hinzufügen' : 'Erinnerungen ausgeschaltet');
}

function exportPlanIcs() {
  const today = todayISO();
  const items = planRange(today, addDays(today, 27));
  if (!items.length) { toast('In den nächsten 4 Wochen ist nichts geplant.'); return; }
  downloadText('trainingsbuch-plan.ics', buildIcs({
    plan: items.map((it) => ({ id: it.id, date: it.date, summary: `${sport(it.sport).emoji} ${it.title || sport(it.sport).label}`, description: [it.note, it.src === 'garmin' ? 'aus dem Garmin-Plan' : ''].filter(Boolean).join('\n') })),
  }), 'text/calendar');
  toast(`${items.length} Einheiten als Kalender-Datei geladen`);
}

// ── monthly review (Coach page) ──
function monthStats(month) {
  const acts = activities().filter((a) => a.date.startsWith(month) && !a.eval);
  const days = healthDays().filter((d) => d.date.startsWith(month));
  const avgOf = (k) => avg(days.map((d) => d[k]).filter((v) => typeof v === 'number'));
  const w = days.filter((d) => d.weightKg);
  const ci = Object.entries(checkins()).filter(([d]) => d.startsWith(month)).map(([, c]) => checkinScore(c)).filter((x) => x != null);
  const sum = (f) => acts.reduce((s, a) => s + (f(a) || 0), 0);
  return {
    units: acts.length,
    hours: sum((a) => a.durationMin) / 60,
    run: acts.filter((a) => a.type === 'run').length,
    runKm: sum((a) => (a.type === 'run' ? a.distanceKm : 0)),
    strength: acts.filter((a) => a.type === 'strength').length,
    swimM: sum((a) => (a.type === 'swim' ? a.distanceKm * 1000 : 0)),
    stretch: Object.entries(stretchLog()).filter(([d, v]) => d.startsWith(month) && v.complete).length,
    sleep: avgOf('sleepH'), rhr: avgOf('restingHr'), hrv: avgOf('hrv'),
    weight: w.length ? w.at(-1).weightKg : null,
    checkin: ci.length ? avg(ci) : null,
  };
}

function reviewCard() {
  const ins = state.data.insights || {};
  const today = todayISO();
  const last = todayISO(new Date(parseDay(today).getFullYear(), parseDay(today).getMonth() - 1, 1)).slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => todayISO(new Date(parseDay(today).getFullYear(), parseDay(today).getMonth() - i, 1)).slice(0, 7));
  const month = state.reviewMonth || last;
  const prevMonth = todayISO(new Date(parseDay(`${month}-01`).getFullYear(), parseDay(`${month}-01`).getMonth() - 1, 1)).slice(0, 7);
  const a = monthStats(month);
  const b = monthStats(prevMonth);
  const label = (m) => parseDay(`${m}-01`).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  const rows = [
    ['Einheiten', a.units, b.units, (v) => fmtNum(v), 1],
    ['Trainingszeit', a.hours, b.hours, (v) => `${fmtNum(v, 1)} h`, 1],
    ['Läufe', a.run, b.run, (v) => fmtNum(v), 1],
    ['Lauf-km', a.runKm, b.runKm, (v) => fmtNum(v, 1), 1],
    ['Krafttrainings', a.strength, b.strength, (v) => fmtNum(v), 1],
    ['Schwimm-Meter', a.swimM, b.swimM, (v) => fmtNum(v), 1],
    ['Dehn-Tage', a.stretch, b.stretch, (v) => fmtNum(v), 1],
    ['Ø Schlaf', a.sleep, b.sleep, (v) => `${fmtHours(v)} h`, 1],
    ['Ø Ruhepuls', a.rhr, b.rhr, (v) => `${fmtNum(v)} bpm`, -1],
    ['Ø HRV', a.hrv, b.hrv, (v) => `${fmtNum(v)} ms`, 1],
    ['Gewicht (Monatsende)', a.weight, b.weight, (v) => `${fmtNum(v, 1)} kg`, 0],
    ['Ø Check-in', a.checkin, b.checkin, (v) => `${fmtNum(v, 1)}/5`, 1],
  ].filter(([, x, y]) => x || y);
  const delta = (x, y, f, better) => {
    if (x == null || y == null || !y) return '';
    const d = x - y;
    if (Math.abs(d) < 1e-9) return '<span class="trend">→</span>';
    const cls = better === 0 ? '' : (d > 0) === (better > 0) ? 'good' : 'bad';
    return `<span class="trend ${cls}">${d > 0 ? '↑' : '↓'} ${f(Math.abs(d)).replace(/^(\d)/, '$1')}</span>`;
  };
  const review = ins.reviews?.[month];
  return `<article class="card review-card">
    <header class="card-head"><h2>📅 Monatsrückblick</h2>
      <select id="review-month" class="mini-select" aria-label="Monat wählen">${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(label(m))}</option>`).join('')}</select></header>
    ${rows.length ? `<table class="review-table"><thead><tr><th></th><th>${esc(label(month).split(' ')[0])}</th><th>${esc(label(prevMonth).split(' ')[0])}</th><th></th></tr></thead>
      <tbody>${rows.map(([l, x, y, f, better]) => `<tr><td>${esc(l)}</td><td>${x != null ? f(x) : '–'}</td><td class="muted">${y != null ? f(y) : '–'}</td><td>${delta(x, y, f, better)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Für diesen Monat gibt es noch keine Daten.</p>'}
    ${review ? `<h3 class="sub">Der Coach meint</h3><div class="prose">${md(review.text)}</div><p class="muted small">${esc(relTime(review.at))}</p>`
      : month === last ? `<p class="muted small" style="margin-top:12px">Der Coach schreibt den Rückblick automatisch am 1. jedes Monats (wenn der Claude-Schlüssel hinterlegt ist) – oder jetzt auf Knopfdruck.</p>
        <div class="form-actions"><button class="btn" data-action="review-run" ${state.pending ? 'disabled' : ''}>${icon('sparkles', 16)}Rückblick schreiben lassen</button></div>` : ''}
  </article>`;
}

// ───────────────────────── page: activities ─────────────────────────
function renderActivities() {
  const all = activities();
  const q = state.actQuery.trim().toLowerCase();
  const list = all.filter((a) => (state.actFilter === 'all' || a.type === state.actFilter)
    && (!q || `${actTitle(a)} ${a.notes || ''} ${a.football?.opponent || ''}`.toLowerCase().includes(q)));

  const groups = new Map();
  for (const a of list) {
    const wk = weekStart(a.date);
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk).push(a);
  }
  const thisWeek = weekStart(todayISO());
  const weekTitle = (wk) => {
    if (wk === thisWeek) return 'Diese Woche';
    if (wk === addDays(thisWeek, -7)) return 'Letzte Woche';
    return `KW ${isoWeek(wk)} · ${fmtDate(wk, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(wk, 6), { day: 'numeric', month: 'short' })}`;
  };

  const chips = ['all', ...sportsIn(all)].map((t) => `<button class="chip-btn${state.actFilter === t ? ' active' : ''}" data-action="filter" data-type="${t}" aria-pressed="${state.actFilter === t}">
    ${t === 'all' ? 'Alle' : `${sport(t).emoji} ${esc(sport(t).label)}`}</button>`).join('');

  return `
    ${pageHead('Aktivitäten', `${all.length} Einträge · Garmin & manuell`, `<button class="btn btn-primary" data-action="add">${icon('plus', 16)}<span>Training erfassen</span></button>`)}
    ${demoBanner()}
    <div class="toolbar">
      <label class="search">${icon('search', 16)}<input type="search" id="act-search" placeholder="Suchen (Titel, Gegner, Notizen)" value="${esc(state.actQuery)}"></label>
      <div class="chips" role="group" aria-label="Sportart filtern">${chips}</div>
    </div>
    ${[...groups].map(([wk, items]) => {
      const mins = items.reduce((s, a) => s + (a.durationMin || 0), 0);
      const km = items.filter((a) => a.type === 'run').reduce((s, a) => s + (a.distanceKm || 0), 0);
      return `<section class="week-group">
        <header><h2>${esc(weekTitle(wk))}</h2><span class="muted small">${items.length} Einheiten · ${fmtDur(mins)}${km ? ` · ${fmtNum(km, 1)} km Laufen` : ''}</span></header>
        <div class="card act-list">${items.map(actRow).join('')}</div>
      </section>`;
    }).join('') || emptyState('Nichts gefunden', 'Passe den Filter an oder erfasse ein neues Training.')}`;
}

// ───────────────────────── activity detail & form (dialog) ─────────────────────────
function openSheet(html) {
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
}

function openActivity(id) {
  const a = activities().find((x) => x.id === id);
  if (!a) return;
  const s = sport(a.type);
  const f = a.football || {};
  const stats = [
    ['Dauer', fmtDur(a.durationMin)],
    ['Distanz', a.distanceKm && `${fmtNum(a.distanceKm, 2)} km`],
    ['Pace', a.paceSecPerKm && `${fmtPace(a.paceSecPerKm)} /km`],
    ['Ø Puls', a.avgHr && `${a.avgHr} bpm`],
    ['Max. Puls', a.maxHr && `${a.maxHr} bpm`],
    ['Kalorien', a.calories && `${a.calories} kcal`],
    ['Training Load', a.trainingLoad],
    ['Aerober TE', a.aerobicTE],
    ['Anaerober TE', a.anaerobicTE],
    ['Höhenmeter', a.elevationGain && `${a.elevationGain} m${a.elevationLoss ? ` / −${a.elevationLoss} m` : ''}`],
    ['Bewegungszeit', a.movingMin && a.movingMin < (a.durationMin || 0) - 0.5 && fmtDur(a.movingMin)],
    ['Ø Tempo', a.avgSpeedKmh && ['cycle', 'other', 'walk'].includes(a.type) && `${fmtNum(a.avgSpeedKmh, 1)} km/h`],
    ['Max. Tempo', a.maxSpeedKmh && a.type === 'cycle' && `${fmtNum(a.maxSpeedKmh, 1)} km/h`],
    ['Kadenz', a.cadence && `${a.cadence} spm`],
    ['Schrittlänge', a.strideCm && `${fmtNum(a.strideCm / 100, 2)} m`],
    ['Bodenkontakt', a.groundContactMs && `${a.groundContactMs} ms`],
    ['Vert. Oszillation', a.verticalOscillationCm && `${fmtNum(a.verticalOscillationCm, 1)} cm`],
    ['Vert. Verhältnis', a.verticalRatio && `${fmtNum(a.verticalRatio, 1)} %`],
    ['Ø Leistung', a.avgPower && `${a.avgPower} W${a.normPower ? ` (NP ${a.normPower} W)` : ''}`],
    ['Trittfrequenz', a.bikeCadence && `${a.bikeCadence} U/min`],
    ['Pace /100 m', a.paceSecPer100m && `${fmtPace(a.paceSecPer100m)} /100 m`],
    ['Becken', a.poolLengthM && `${fmtNum(a.poolLengthM)} m`],
    ['Bahnen', a.lengths],
    ['SWOLF', a.swolf],
    ['Züge', a.strokes && `${a.strokes}${a.avgStrokesPerLength ? ` (Ø ${fmtNum(a.avgStrokesPerLength, 1)} / Bahn)` : ''}`],
    ['Zugrate', a.strokeRate && `${a.strokeRate} /min`],
    ['Distanz pro Zug', a.strokeDistanceM && `${fmtNum(a.strokeDistanceM, 2)} m`],
    ['Sätze (Uhr)', a.activeSets && `${a.activeSets}${a.totalReps ? ` · ${a.totalReps} Wdh.` : ''}`],
    ['Schritte', a.steps && fmtNum(a.steps)],
    ['Ø Atmung', a.avgRespiration && `${fmtNum(a.avgRespiration, 1)} /min`],
    ['Temperatur', a.maxTempC != null && a.minTempC != null && `${fmtNum(a.minTempC)}–${fmtNum(a.maxTempC)} °C`],
    ['Intensitätsminuten', (a.moderateMin || a.vigorousMin) && `${(a.moderateMin || 0) + 2 * (a.vigorousMin || 0)}`],
    ['Body Battery', a.bodyBatteryImpact && `${a.bodyBatteryImpact > 0 ? '+' : ''}${a.bodyBatteryImpact}`],
    ['Schweiss (geschätzt)', a.sweatMl && `${fmtNum(a.sweatMl)} ml`],
    ['Ort', a.location],
    ['RPE', a.rpe && `${a.rpe}/10 · ${RPE_LABELS[a.rpe]}`],
    ['Gefühl', a.feeling && `${FEELINGS[a.feeling]} ${a.feeling}/5`],
  ].filter(([, v]) => v);
  const footballStats = a.type === 'football' ? [
    ['Art', f.kind === 'match' ? 'Match' : 'Training'],
    ['Gegner', f.opponent], ['Resultat', f.result], ['Spielminuten', f.minutesPlayed],
    ['Tore', f.goals], ['Assists', f.assists],
  ].filter(([, v]) => v || v === 0) : [];
  const earlier = activities().filter((x) => (x.start || x.date) < (a.start || a.date));
  const exercisesHtml = a.exercises?.length ? `<h3 class="sub">Übungen</h3><div class="ex-summary">${a.exercises.map((e) => {
    const best = bestE1rm(e);
    const previous = earlier.flatMap((x) => (x.exercises || []).filter((y) => y.id === e.id)).map(bestE1rm).filter(Boolean);
    const record = best && previous.length && best > Math.max(...previous);
    return `<div class="ex-line">
      <div><strong>${esc(e.name)}</strong>${record ? ' <span class="chip good">🏆 Rekord</span>' : ''}</div>
      <span>${esc(fmtSets(e.sets, e.unit))}</span>
      ${best ? `<span class="muted small">≈ 1RM ${fmtNum(best)} kg</span>` : ''}
    </div>`;
  }).join('')}</div>` : '';
  if (volume(a.exercises)) stats.push(['Volumen', `${fmtNum(volume(a.exercises))} kg`]);
  const zones = a.hrZonesMin?.some(Boolean) ? hbars(a.hrZonesMin.map((m, i) => ({
    label: `Zone ${i + 1}`, value: m || 0, display: fmtDur(m), color: ZONE_COLORS[i],
  }))) : '';

  openSheet(`<div class="sheet-body">
    <header class="sheet-head">
      <span class="act-icon lg" style="--c:${sportColor(a.type)}">${s.emoji}</span>
      <div><h2>${esc(actTitle(a))}</h2><p class="muted">${esc(fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${a.start?.length > 10 ? ` · ${a.start.slice(11, 16)}` : ''} · ${a.source === 'garmin' ? 'Garmin' : 'Manuell'}</p></div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Schliessen">${icon('close')}</button>
    </header>
    <dl class="stat-grid">${[...stats, ...footballStats].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${exercisesHtml}
    ${a.trainingEffectLabel ? `<p class="small muted te-label">Trainingseffekt laut Garmin: <strong>${esc(TE_LABELS[a.trainingEffectLabel] || a.trainingEffectLabel.toLowerCase().replaceAll('_', ' '))}</strong></p>` : ''}
    ${lapsTable(a)}
    ${garminSetsBlock(a)}
    ${zones ? `<h3 class="sub">Herzfrequenzzonen</h3>${zones}` : ''}
    ${a.notes ? `<h3 class="sub">Notizen</h3><p>${esc(a.notes)}</p>` : ''}
    <footer class="sheet-actions">
      ${a.source === 'garmin'
        ? `<button class="btn" data-action="edit-activity" data-id="${esc(a.id)}">${icon('edit', 16)}Ergänzen (Übungen, RPE, Notizen)</button>`
        : `<button class="btn btn-danger" data-action="delete-activity" data-id="${esc(a.id)}">${icon('trash', 16)}Löschen</button>
           <button class="btn btn-primary" data-action="edit-activity" data-id="${esc(a.id)}">${icon('edit', 16)}Bearbeiten</button>`}
    </footer>
  </div>`);
}

const TE_LABELS = {
  RECOVERY: 'Erholung', BASE: 'Grundlage', AEROBIC_BASE: 'Grundlage', TEMPO: 'Tempo', THRESHOLD: 'Schwelle', LACTATE_THRESHOLD: 'Schwelle',
  VO2MAX: 'VO₂max', ANAEROBIC_CAPACITY: 'Anaerob', SPEED: 'Schnelligkeit', SPRINT: 'Sprint', NO_BENEFIT: 'kein Trainingseffekt', ANAEROBIC: 'Anaerob',
};
const STROKES = { FREESTYLE: 'Kraul', BACKSTROKE: 'Rücken', BREASTSTROKE: 'Brust', BUTTERFLY: 'Delfin', MIXED: 'Gemischt', IM: 'Lagen', DRILL: 'Technik' };

function lapsTable(a) {
  const laps = a.lapsDetail || [];
  if (!laps.length) return '';
  if (a.type === 'swim') {
    let n = 0;
    return `<h3 class="sub">Intervalle</h3><div class="table-wrap"><table class="laps"><thead><tr><th>#</th><th>Distanz</th><th>Zeit</th><th>/100 m</th><th>Lage</th><th>SWOLF</th><th>Züge</th></tr></thead><tbody>
      ${laps.map((l) => (l.rest ? `<tr class="rest"><td></td><td colspan="6">Pause ${fmtClock(l.sec)}</td></tr>`
        : `<tr><td>${n += 1}</td><td>${fmtNum((l.km || 0) * 1000)} m</td><td>${fmtClock(l.sec)}</td><td>${l.pace100 ? fmtPace(l.pace100) : '–'}</td><td>${esc(STROKES[l.stroke] || l.stroke || '–')}</td><td>${l.swolf ?? '–'}</td><td>${l.strokes ?? '–'}</td></tr>`)).join('')}
    </tbody></table></div>`;
  }
  const hasPace = laps.some((l) => l.pace);
  return `<h3 class="sub">Runden</h3><div class="table-wrap"><table class="laps"><thead><tr><th>#</th><th>Distanz</th><th>Zeit</th>${hasPace ? '<th>Pace</th>' : ''}<th>Ø Puls</th>${laps.some((l) => l.cadence) ? '<th>Kadenz</th>' : ''}${laps.some((l) => l.power) ? '<th>Watt</th>' : ''}${laps.some((l) => l.elev) ? '<th>Hm</th>' : ''}</tr></thead><tbody>
    ${laps.map((l, i) => `<tr><td>${i + 1}</td><td>${l.km ? `${fmtNum(l.km, 2)} km` : '–'}</td><td>${fmtClock(l.sec)}</td>${hasPace ? `<td>${l.pace ? fmtPace(l.pace) : '–'}</td>` : ''}<td>${l.hr ?? '–'}</td>${laps.some((x) => x.cadence) ? `<td>${l.cadence ?? '–'}</td>` : ''}${laps.some((x) => x.power) ? `<td>${l.power ?? '–'}</td>` : ''}${laps.some((x) => x.elev) ? `<td>${l.elev ?? '–'}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>`;
}

// Garmin strength sets → app exercises (best effort by name; unknown ones become own exercises)
const GARMIN_EX = [
  [/front_squat/, 'front_squat'], [/goblet/, 'goblet_squat'], [/leg_press/, 'leg_press'], [/split_squat|bulgarian/, 'bulgarian_split_squat'],
  [/single_leg_squat|pistol/, 'single_leg_squat'], [/squat/, 'squat'], [/lunge/, 'lunge'], [/step_up/, 'step_up'],
  [/leg_extension/, 'leg_extension'], [/nordic/, 'nordic_curl'], [/leg_curl/, 'leg_curl'], [/seated_calf/, 'c_wadenheben_sitzend'], [/calf/, 'calf_raise'],
  [/single_leg.*(deadlift|rdl)/, 'single_leg_rdl'], [/romanian|rdl|stiff_leg/, 'romanian_deadlift'], [/deadlift/, 'deadlift'],
  [/hip_thrust/, 'hip_thrust'], [/glute_bridge|hip_raise/, 'glute_bridge'], [/swing/, 'kettlebell_swing'], [/good_morning/, 'good_morning'],
  [/incline.*bench|incline.*press/, 'incline_bench'], [/dumbbell.*bench|db_bench/, 'db_bench'], [/bench_press/, 'bench_press'],
  [/push_up/, 'push_up'], [/dip/, 'dips'], [/fly/, 'chest_fly'], [/pull_up|chin_up/, 'pull_up'], [/pulldown/, 'lat_pulldown'],
  [/face_pull/, 'face_pull'], [/(one_arm|dumbbell).*row/, 'db_row'], [/cable.*row|seated_row/, 'cable_row'], [/row/, 'barbell_row'],
  [/back_extension|hyperextension/, 'back_extension'], [/dumbbell.*shoulder_press|dumbbell.*overhead/, 'db_shoulder_press'],
  [/shoulder_press|overhead_press|military/, 'overhead_press'], [/lateral_raise/, 'lateral_raise'], [/reverse_fly|rear_delt/, 'reverse_fly'],
  [/hammer_curl/, 'hammer_curl'], [/curl/, 'biceps_curl'], [/triceps|pushdown|skull/, 'triceps_pushdown'],
  [/side_plank/, 'side_plank'], [/copenhagen/, 'copenhagen'], [/plank/, 'plank'], [/dead_bug/, 'dead_bug'], [/pallof/, 'pallof_press'],
  [/hanging.*leg_raise|leg_raise/, 'hanging_leg_raise'], [/ab_wheel|rollout/, 'ab_wheel'], [/russian_twist/, 'russian_twist'],
  [/box_jump/, 'box_jump'], [/broad_jump/, 'broad_jump'], [/jump/, 'pogo_jump'],
];
const prettyGarmin = (s) => String(s || 'Übung').toLowerCase().split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

function garminSetsToExercises(sets) {
  const cat = catalog(profile());
  const out = [];
  for (const st of sets) {
    const key = `${st.category || ''} ${st.name || ''}`.toLowerCase();
    const hit = GARMIN_EX.find(([re]) => re.test(key));
    let ex = hit && cat.find((e) => e.id === hit[1]);
    if (!ex) ex = { id: `c_${slug(prettyGarmin(st.name || st.category))}`, name: prettyGarmin(st.name || st.category), group: 'Eigene' };
    const timed = ex.unit === 's';
    const set = timed ? { reps: st.sec || st.reps } : { kg: st.kg || undefined, reps: st.reps };
    const last = out.at(-1);
    if (last?.id === ex.id) last.sets.push(set); else out.push({ id: ex.id, name: ex.name, group: ex.group, ...(timed ? { unit: 's' } : {}), sets: [set] });
  }
  return out;
}

function garminSetsBlock(a) {
  if (!a.garminSets?.length) return '';
  const ex = garminSetsToExercises(a.garminSets);
  return `<h3 class="sub">Sätze von der Uhr</h3>
    <div class="ex-summary">${ex.map((e) => `<div class="ex-line"><div><strong>${esc(e.name)}</strong></div><span>${esc(fmtSets(e.sets, e.unit))}</span></div>`).join('')}</div>
    ${a.exercises?.length ? '' : `<div class="form-actions"><button class="btn btn-sm" data-action="garmin-sets-take" data-id="${esc(a.id)}">${icon('check', 14)}Als Übungen übernehmen</button></div>`}
    <p class="muted small">Garmin erkennt Übungen automatisch – nicht immer richtig. Nach dem Übernehmen kannst du sie unter «Ergänzen» korrigieren.</p>`;
}

function openForm(existing, opts = {}) {
  const mode = !existing || opts.draft ? 'new' : existing.source === 'garmin' ? 'garmin' : 'edit';
  const prof0 = profile();
  const defType = opts.templateId ? 'strength' : opts.type || (!prof0.sports?.length || prof0.sports.includes('football') ? 'football' : prof0.sports[0]);
  const a = existing || { type: defType, date: opts.date || todayISO(), football: { kind: 'training' }, swimId: opts.swimId };
  const f = a.football || { kind: 'training' };
  const now = new Date();
  const time = a.start?.slice(11, 16) || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const heading = { new: 'Training erfassen', edit: 'Training bearbeiten', garmin: 'Garmin-Aktivität ergänzen' }[mode];
  const p = profile();
  const active = p.sports?.length ? p.sports : Object.keys(SPORTS);
  const types = Object.keys(SPORTS).filter((k) => active.includes(k) || k === 'other' || k === a.type);
  const all = activities();

  openSheet(`<form id="act-form" class="sheet-body form" data-mode="${mode}" data-id="${esc(a.id || '')}" novalidate>
    <header class="sheet-head">
      <div><h2>${heading}</h2>${mode === 'garmin' ? '<p class="muted">Messwerte kommen von der Uhr – ergänze, wie es sich angefühlt hat.</p>' : ''}</div>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Schliessen">${icon('close')}</button>
    </header>

    <fieldset class="type-picker">
      <legend>Sportart</legend>
      ${types.map((k) => `<label style="--c:${sportColor(k)}"><input type="radio" name="type" value="${k}" ${a.type === k ? 'checked' : ''}><span>${SPORTS[k].emoji}</span>${esc(SPORTS[k].label)}</label>`).join('')}
    </fieldset>

    <label class="field"><span>Titel <em>optional</em></span><input name="title" value="${esc(a.title || '')}" placeholder="z.B. Abschlusstraining, Intervalle 6×800 m" maxlength="80"></label>

    <div class="row no-garmin">
      <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(a.date)}" max="${addDays(todayISO(), 30)}" required></label>
      <label class="field"><span>Uhrzeit</span><input type="time" name="time" value="${esc(time)}"></label>
    </div>
    <div class="row no-garmin gym-end">
      <label class="field"><span>Dauer (min)</span><input type="number" name="durationMin" inputmode="numeric" min="1" max="600" value="${esc(a.durationMin ?? '')}" required placeholder="60"></label>
      <label class="field distance-field"><span>Distanz (km)</span><input type="number" name="distanceKm" inputmode="decimal" step="0.01" min="0" value="${esc(a.distanceKm ?? '')}" placeholder="optional"></label>
      <label class="field"><span>Ø Puls</span><input type="number" name="avgHr" inputmode="numeric" min="40" max="230" value="${esc(a.avgHr ?? '')}" placeholder="optional"></label>
    </div>
    <p id="pace-hint" class="muted small pace-hint" aria-live="polite"></p>
    <label class="field swim-only"><span>Schwimmprogramm <em>optional</em></span><select name="swimId"><option value="">–</option>${SWIM.map((x) => `<option value="${x.id}" ${a.swimId === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.m} m · ${esc(x.focus)}</option>`).join('')}</select></label>

    <fieldset class="football-fields">
      <legend>Fussball</legend>
      <div class="segmented">
        <label><input type="radio" name="fkind" value="training" ${f.kind !== 'match' ? 'checked' : ''}>Training</label>
        <label><input type="radio" name="fkind" value="match" ${f.kind === 'match' ? 'checked' : ''}>Match</label>
      </div>
      <div class="row match-only">
        <label class="field grow"><span>Gegner</span><input name="opponent" value="${esc(f.opponent || '')}" placeholder="FC Beispiel"></label>
        <label class="field"><span>Resultat</span><input name="result" value="${esc(f.result || '')}" placeholder="2:1"></label>
      </div>
      <div class="row match-only">
        <label class="field"><span>Spielminuten</span><input type="number" name="minutesPlayed" inputmode="numeric" min="0" max="130" value="${esc(f.minutesPlayed ?? '')}"></label>
        <label class="field"><span>Tore</span><input type="number" name="goals" inputmode="numeric" min="0" max="20" value="${esc(f.goals ?? '')}"></label>
        <label class="field"><span>Assists</span><input type="number" name="assists" inputmode="numeric" min="0" max="20" value="${esc(f.assists ?? '')}"></label>
      </div>
    </fieldset>

    <fieldset class="strength-fields">
      <legend>Übungen</legend>
      <input type="hidden" name="templateId" value="${esc(a.templateId || '')}">
      ${mode !== 'garmin' ? `<button type="button" class="btn btn-sm gym-toggle" data-action="gym-toggle">${icon('pulse', 14)}Gym-Modus: eine Übung pro Seite</button>` : ''}
      ${p.templates.length ? `<div class="tpl-pick"><span class="muted small">Vorlage laden:</span>${p.templates.map((t) => `<button type="button" class="btn btn-sm${t.id === a.templateId ? ' btn-primary' : ''}" data-action="tpl-load" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>`
        : '<p class="muted small">Tipp: Unter Einstellungen → Trainingsvorlagen legst du Vorlagen (z. B. Training A/B) an. Dann sind Gewichte vom letzten Mal schon eingetragen und Steigerungen werden vorgeschlagen.</p>'}
      ${mode === 'new' ? `<details class="warmup"><summary>Aufwärmen <span class="muted small">ca. 8 Min.</span></summary><ul>${WARMUP.map((w) => `<li><label><input type="checkbox" name="warm" value="1">${esc(w)}</label></li>`).join('')}</ul><p class="muted small">Keine langen statischen Dehnungen vor dem Krafttraining.</p></details>` : ''}
      <div class="ex-list">${(a.exercises || []).map((e) => exerciseBlock(e, lastSession(all, e.id, a.id))).join('')}</div>
      <div class="ex-add">
        <input id="ex-search" list="ex-options" placeholder="Übung suchen oder neue eintippen …" autocomplete="off" enterkeyhint="done">
        <datalist id="ex-options">${catalog(p).map((e) => `<option value="${esc(e.name)}">${esc(e.group)}</option>`).join('')}</datalist>
        <button type="button" class="btn" data-action="ex-add">${icon('plus', 16)}Hinzufügen</button>
      </div>
      <p class="muted small">Gewicht leer lassen = Körpergewicht. Neue Übungen landen automatisch in deiner Liste (Einstellungen → Übungen).</p>
    </fieldset>

    <label class="field gym-end">
      <span>Anstrengung (RPE) <output id="rpe-out">${a.rpe ? `${a.rpe} · ${RPE_LABELS[a.rpe]}` : 'nicht bewertet'}</output></span>
      <input type="range" name="rpe" min="0" max="10" step="1" value="${a.rpe || 0}" class="rpe">
    </label>

    <fieldset class="feelings gym-end">
      <legend>Wie hat es sich angefühlt?</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="feeling" value="${n}" ${a.feeling === n ? 'checked' : ''}><span aria-label="${n} von 5">${FEELINGS[n]}</span></label>`).join('')}
    </fieldset>

    <label class="field gym-end"><span>Notizen</span><textarea name="notes" rows="2" placeholder="Wie lief es? Schmerzen, Besonderheiten, Wetter …">${esc(a.notes || '')}</textarea></label>

    <footer class="sheet-actions gym-end">
      <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      <button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern</button>
    </footer>
  </form>`);
  const f0 = $('#act-form');
  if (opts.swimId && !f0.elements.distanceKm.value) f0.elements.distanceKm.value = (swimById(opts.swimId)?.m || 0) / 1000 || '';
  updatePaceHint(f0);
  if (opts.templateId) {
    loadTemplate($('#act-form'), opts.templateId);
    const pref = store.getPrefs().gymMode;
    if (pref ?? matchMedia('(max-width: 760px)').matches) gymStart($('#act-form'));
  }
}

// ── Gym-Modus: one exercise per screen, rest timer, duration measured automatically ──
let restTimer = null;
function gymStart(form) {
  if (!form) return;
  form.classList.add('gym-on');
  form.dataset.step ||= '0';
  form.dataset.started ||= String(Date.now());
  if (!form.querySelector('.gym-bar')) form.querySelector('.sheet-head').insertAdjacentHTML('afterend', '<div class="gym-bar"></div>');
  gymRender(form);
}
function gymStop(form) {
  form.classList.remove('gym-on');
  delete form.dataset.gymStage;
  form.querySelector('.gym-bar')?.remove();
  form.querySelectorAll('.gym-cur').forEach((b) => b.classList.remove('gym-cur'));
  clearInterval(restTimer);
}
function gymRender(form) {
  const blocks = [...form.querySelectorAll('.ex-block')];
  const hasWarm = !!form.querySelector('.warmup');
  const steps = [...(hasWarm ? ['warm'] : []), ...blocks.map(() => 'ex'), 'end'];
  const i = Math.max(0, Math.min(steps.length - 1, Number(form.dataset.step) || 0));
  form.dataset.step = String(i);
  const stage = steps[i];
  form.dataset.gymStage = stage;
  const exIdx = i - (hasWarm ? 1 : 0);
  blocks.forEach((b, k) => b.classList.toggle('gym-cur', stage === 'ex' && k === exIdx));
  if (stage === 'warm') form.querySelector('.warmup').open = true;
  if (stage === 'end') {
    const dur = form.elements.durationMin;
    if (dur && !dur.value && form.dataset.started) dur.value = Math.max(1, Math.round((Date.now() - Number(form.dataset.started)) / 60000));
  }
  const label = stage === 'warm' ? 'Aufwärmen' : stage === 'end' ? 'Abschluss' : `Übung ${exIdx + 1} von ${blocks.length}`;
  const next = stage === 'end' ? '' : steps[i + 1] === 'end' ? 'Abschliessen' : 'Weiter';
  form.querySelector('.gym-bar').innerHTML = `
    <div class="gym-progress"><i style="width:${(i / (steps.length - 1)) * 100}%"></i></div>
    <div class="gym-nav">
      <button type="button" class="btn btn-sm" data-action="gym-prev" ${i === 0 ? 'disabled' : ''} aria-label="Zurück">‹</button>
      <strong>${label}</strong>
      <span class="gym-rest" aria-live="polite"></span>
      ${stage === 'ex' ? `<button type="button" class="btn btn-sm" data-action="gym-rest" data-sec="90">${icon('clock', 14)}Pause</button>` : ''}
      ${next ? `<button type="button" class="btn btn-sm btn-primary" data-action="gym-next">${next} ›</button>` : ''}
    </div>
    <div class="gym-dots">${steps.map((st, k) => `<button type="button" data-action="gym-go" data-step="${k}" class="${k === i ? 'on' : ''}${k < i ? ' past' : ''}" aria-label="Schritt ${k + 1}"></button>`).join('')}
      <button type="button" class="link small" data-action="gym-toggle">Liste</button></div>`;
  form.closest('.sheet-body, dialog')?.scrollTo?.({ top: 0 });
  sheet.scrollTo?.({ top: 0 });
}
function gymRest(btn, sec) {
  const out = btn.closest('.gym-bar')?.querySelector('.gym-rest');
  if (!out) return;
  clearInterval(restTimer);
  const end = Date.now() + sec * 1000;
  const tick = () => {
    const left = Math.round((end - Date.now()) / 1000);
    if (left <= 0) { clearInterval(restTimer); out.textContent = 'Los! 💪'; navigator.vibrate?.(300); return; }
    out.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  restTimer = setInterval(tick, 1000);
}

function updatePaceHint(form) {
  const out = form?.querySelector('#pace-hint');
  if (!out) return;
  const type = form.querySelector('[name=type]:checked')?.value;
  const min = Number(form.elements.durationMin?.value);
  const km = Number(form.elements.distanceKm?.value);
  let text = '';
  if (min && km && type === 'run') {
    const r = profile().race;
    const goal = r?.goalSec ? ` · Zielpace ${esc(RACE_DISTANCES[r.distanceKm || HM_KM] || 'Wettkampf')} ${fmtPace(r.goalSec / (r.distanceKm || HM_KM))} /km` : '';
    text = `Pace ${fmtPace((min * 60) / km)} /km${goal}`;
  } else if (min && km && type === 'swim') text = `Tempo ${fmtPace((min * 60) / (km * 10))} /100 m`;
  else if (min && km && type === 'cycle') text = `${fmtNum(km / (min / 60), 1)} km/h`;
  out.textContent = text;
}

/** Fill the strength form from a template: last values pre-filled, progression suggested. */
function loadTemplate(form, tplId) {
  const p = profile();
  const t = p.templates.find((x) => x.id === tplId);
  if (!form || !t) return;
  const cat = catalog(p);
  const all = activities();
  form.querySelector('[name=type][value=strength]').checked = true;
  if (!form.elements.title.value.trim() || p.templates.some((x) => x.name === form.elements.title.value.trim())) form.elements.title.value = t.name;
  form.elements.templateId.value = t.id;
  form.querySelectorAll('[data-action=tpl-load]').forEach((b) => b.classList.toggle('btn-primary', b.dataset.id === t.id));
  let warm = 0;
  const L = light();
  const lims = activeLimits(limitsList()).filter((l) => l.kind !== 'tired');
  const hintFor = (ex) => {
    const notes = [];
    if (L.generalLevel === 'red') notes.push(`Ampel rot (${L.reasons[0]?.text || ''}) – heute eher leicht oder Pause. Du entscheidest.`);
    else if (L.generalLevel === 'yellow') notes.push('Ampel gelb – Steigerung nur, wenn es sich gut anfühlt.');
    const upper = ['Brust', 'Rücken', 'Schultern', 'Arme'].includes(ex.group);
    const lower = ['Beine', 'Gesäss & Hüfte', 'Prävention & Sprung'].includes(ex.group);
    for (const l of lims) {
      const a = l.affects || [];
      if (l.kind === 'ill' || (upper && a.includes('liftUpper')) || (lower && a.includes('liftLower'))) notes.push(`${LIMIT_SHORT[l.kind]}${l.area ? ` (${l.area})` : ''}: Übung anpassen oder weglassen.`);
    }
    return notes.join(' ');
  };
  form.querySelector('.ex-list').innerHTML = t.items.map((item) => {
    const ex = cat.find((e) => e.id === item.id) || { id: item.id, name: item.id, group: 'Eigene' };
    const target = { ...item, inc: item.inc ?? defaultInc(ex) };
    const hist = exerciseHistory(all, ex.id, form.dataset.id);
    const sugg = suggestNext(target, ex, hist, null);
    const decision = sugg.type === 'up' || sugg.type === 'time' ? 'up' : '';
    const sets = prefillSets(target, ex, hist, sugg, decision);
    let html = exerciseBlock({ ...ex, sets }, hist[0], { target, sugg, decision, note: hintFor(ex) });
    const kg = sets[0]?.kg;
    if (warm < 2 && ex.unit !== 's' && kg >= 10) { warm += 1; html = html.replace('<div class="sets">', `<p class="muted small warm-sets">${esc(warmupSets(kg, target.inc || 2.5))}</p><div class="sets">`); }
    return html;
  }).join('');
}

async function submitActivity(form) {
  const fd = new FormData(form);
  const mode = form.dataset.mode;
  const num = (k) => (fd.get(k) === '' || fd.get(k) == null ? undefined : Number(fd.get(k)));
  const type = fd.get('type') || 'other';
  const football = type === 'football' ? Object.fromEntries(Object.entries({
    kind: fd.get('fkind') || 'training',
    ...(fd.get('fkind') === 'match' ? {
      opponent: fd.get('opponent')?.trim(), result: fd.get('result')?.trim(),
      minutesPlayed: num('minutesPlayed'), goals: num('goals'), assists: num('assists'),
    } : {}),
  }).filter(([, v]) => v !== undefined && v !== '')) : undefined;
  const common = {
    type,
    title: fd.get('title').trim() || undefined,
    rpe: num('rpe') || undefined,
    feeling: num('feeling'),
    notes: fd.get('notes').trim() || undefined,
    football,
  };
  const exercises = type === 'strength' ? readExercises(form) : [];
  if (exercises.length) common.exercises = exercises;
  if (type === 'strength' && fd.get('templateId')) common.templateId = fd.get('templateId');
  if (type === 'strength' && fd.getAll('warm').length) common.warmup = fd.getAll('warm').length;
  if (type === 'swim' && fd.get('swimId')) common.swimId = fd.get('swimId');
  const newExercises = JSON.parse(form.dataset.newExercises || '[]').filter((n) => exercises.some((e) => e.id === n.id));

  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (mode === 'garmin') {
      await store.saveAnnotation(form.dataset.id, JSON.parse(JSON.stringify(common)));
    } else {
      const missing = [['date', 'Datum'], ['durationMin', 'Dauer']].filter(([k]) => !fd.get(k) || (k === 'durationMin' && !num(k)));
      if (missing.length) {
        if (form.classList.contains('gym-on')) { form.dataset.step = '999'; gymRender(form); }
        missing.forEach(([k]) => form.elements[k].setAttribute('aria-invalid', 'true'));
        form.elements[missing[0][0]].focus();
        form.elements[missing[0][0]].scrollIntoView({ block: 'center', behavior: 'smooth' });
        toast(`Bitte ${missing.map(([, label]) => label).join(' und ')} angeben.`, 'error');
        submit.disabled = false;
        return;
      }
      const activity = JSON.parse(JSON.stringify({
        id: form.dataset.id || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        source: 'manual',
        ...common,
        date: fd.get('date'),
        start: `${fd.get('date')}T${fd.get('time') || '12:00'}:00`,
        durationMin: num('durationMin'),
        distanceKm: SPORTS[type]?.distance ? num('distanceKm') : undefined,
        avgHr: num('avgHr'),
      }));
      if (activity.type === 'run' && activity.distanceKm) activity.paceSecPerKm = Math.round((activity.durationMin * 60) / activity.distanceKm);
      await store.saveActivity(activity);
    }
    if (newExercises.length) {
      await store.updateProfile((raw) => {
        const prof = normalizeProfile(raw);
        prof.customExercises = [...prof.customExercises, ...newExercises.filter((n) => !prof.customExercises.some((c) => c.id === n.id))];
        return prof;
      });
    }
    clearTimeout(draftTimer);
    draftTimer = null;
    form.dataset.mode = 'saved';
    if (type === 'strength' && mode === 'new') store.localSet('draft', null);
    sheet.close();
    toast(mode === 'new' ? 'Training gespeichert' : 'Änderungen gespeichert');
    await reload();
    if (store.isLive() && store.getPrefs().analyzeAfterEntry) runCoach('manual-entry');
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
    submit.disabled = false;
  }
}

// ───────────────────────── page: coach ─────────────────────────
function renderCoach() {
  const ins = state.data.insights || {};
  const an = ins.analysis;
  const head = pageHead('Coach', an ? `Analyse ${esc(relTime(ins.generatedAt))} · ${esc(ins.model || 'Claude')}` : 'KI-Analyse mit Claude',
    `<button class="btn btn-primary" data-action="analyze" ${state.pending ? 'disabled' : ''}>${icon('sparkles', 16)}<span>Neu analysieren</span></button>`);
  const ask = `<article class="card ask">
    <header class="card-head"><h2>Frag deinen Coach</h2></header>
    <form id="ask-form" class="ask-form">
      <textarea name="q" rows="2" maxlength="2000" placeholder="z.B. Wie bereite ich mich auf einen 10-km-Lauf in 6 Wochen vor, ohne dass das Fussball leidet?" required></textarea>
      <button class="btn btn-primary" type="submit" ${state.pending ? 'disabled' : ''}>${icon('send', 16)}<span>Senden</span></button>
    </form>
    <div class="qa-list">${(ins.qa || []).map((x) => `<details class="qa" ${x === ins.qa[0] ? 'open' : ''}>
      <summary><strong>${esc(x.question)}</strong><span class="muted small">${esc(relTime(x.at))}</span></summary>
      <div class="prose">${md(x.answer)}</div>
    </details>`).join('')}</div>
  </article>`;

  if (!an) {
    return `${head}${demoBanner()}${pendingBanner()}
      ${emptyState('Noch keine Analyse', 'Drück auf «Jetzt analysieren» – Claude wertet dann alle Trainings und Gesundheitsdaten aus. Analysen laufen nur auf Knopfdruck.', '<button class="btn btn-primary" data-action="analyze">Jetzt analysieren</button>')}
      ${reviewCard()}
      ${ask}`;
  }

  const areas = focusAreas(an);
  const tab = Math.min(state.coachTab, Math.max(0, areas.length - 1));
  const loadStatus = an.load?.status || '';
  const loadClass = { 'zu niedrig': 'warn', aufbauend: 'good', optimal: 'good', hoch: 'warn', 'zu hoch': 'bad' }[loadStatus] || '';

  return `${head}${demoBanner()}${pendingBanner()}
    <section class="grid hero">
      <article class="card readiness">
        ${ring(an.readiness?.score, { label: 'Bereitschaft' })}
        <div><p class="eyebrow">Tagesform</p><h2>${esc(an.readiness?.label)}</h2><p class="muted">${esc(an.readiness?.reasoning)}</p></div>
      </article>
      <article class="card">
        <p class="eyebrow">Trainingsbelastung</p>
        <h2 class="status ${loadClass}">${icon(loadClass === 'good' ? 'check' : 'alert', 18)}${esc(loadStatus)}</h2>
        <p class="muted">${esc(an.load?.comment)}</p>
      </article>
    </section>
    <article class="card">
      ${supervisorBadge(ins.supervisor)}
      <p class="lead">${esc(an.summary)}</p>
      ${(an.warnings || []).map((w) => `<p class="warn">${icon('alert', 16)}${esc(w)}</p>`).join('')}
    </article>
    <article class="card">
      <div class="segmented tabs" role="tablist">${areas.map((f, i) => `<button role="tab" aria-selected="${tab === i}" data-action="coach-tab" data-tab="${i}">${esc(f.area)}</button>`).join('')}</div>
      <div class="tab-panel" role="tabpanel">${tipList(areas[tab]?.tips)}</div>
    </article>
    ${an.nutrition ? `<article class="card">
      <header class="card-head"><h2>🍽️ Ernährung</h2><span class="muted small">Faustregeln</span></header>
      ${an.nutrition.summary ? `<p class="lead">${esc(an.nutrition.summary)}</p>` : ''}
      <div style="margin-top:12px">${tipList(an.nutrition.tips)}</div>
      <p class="muted small" style="margin-top:12px">Allgemeine Empfehlungen auf Basis von Sporternährungs-Leitlinien (ACSM, ISSN, UEFA) – keine medizinische oder ernährungstherapeutische Beratung.</p>
    </article>` : ''}
    <section>
      <header class="section-head"><h2>Deine nächsten 7 Tage</h2><span class="muted small">Vorschlag vom Coach</span></header>
      <div class="plan-list">${(an.plan || []).map(planCard).join('')}</div>
      <p class="muted small" style="margin-top:8px">Übernehmen kannst du die Vorschläge im <a class="link" href="#/plan">Plan</a>.</p>
    </section>
    ${reviewCard()}
    ${ask}`;
}

const SUP = {
  freigegeben: ['good', 'check', 'Vom Supervisor geprüft und freigegeben'],
  angepasst: ['warn', 'edit', 'Vom Supervisor geprüft und korrigiert'],
  ungeprüft: ['', 'alert', 'Supervisor-Prüfung ausgefallen – Plan ungeprüft'],
};
function supervisorBadge(sup) {
  if (!sup?.verdict || sup.verdict === 'aus') return '';
  const [cls, ic, text] = SUP[sup.verdict] || SUP.ungeprüft;
  const issues = sup.issues || [];
  return `<details class="supervisor ${cls}">
    <summary>${icon(ic, 15)}<span>${esc(text)}</span>${issues.length ? `<span class="muted small">${issues.length} Anpassung${issues.length === 1 ? '' : 'en'}</span>` : ''}</summary>
    ${issues.length ? `<ul>${issues.map((i) => `<li><strong>${esc(i.rule)}</strong> ${esc(i.problem)}${i.fix ? `<br><span class="muted">→ ${esc(i.fix)}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted small">Der Supervisor hat Plan und Tipps gegen die Wissensbasis geprüft (Belastungssteuerung, Progression, Erholung, Sicherheit) und nichts beanstandet.</p>'}
  </details>`;
}

// ───────────────────────── page: trends ─────────────────────────
const ms = (iso) => parseDay(iso).getTime();
function xLabels(dates) {
  if (dates.length < 2) return [];
  const n = Math.min(5, dates.length);
  return Array.from({ length: n }, (_, i) => dates[Math.round((i * (dates.length - 1)) / (n - 1))])
    .map((d) => ({ x: ms(d), label: fmtDate(d, { day: 'numeric', month: 'short' }) }));
}
const weekLabel = (wk) => `KW${isoWeek(wk)}`;
const inWeek = (wk) => (a) => a.date >= wk && a.date < addDays(wk, 7);
const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
const card = (title, sub, body, cls = '') => `<article class="card${cls ? ` ${cls}` : ''}">
  <header class="card-head"><h2>${title}</h2>${sub ? `<span class="muted small">${sub}</span>` : ''}</header>${body}</article>`;
const statRow = (items) => `<div class="stat-row trend-stats">${items.filter(Boolean).map(([v, l]) => `<div><strong>${v}</strong><span>${esc(l)}</span></div>`).join('')}</div>`;

/** Weekly bars of one value per week. */
function weekBars(ctx, list, valueFn, { unit = '', type, color, fmt = (v) => fmtNum(v, 1) } = {}) {
  return bars(ctx.weekStarts.map((wk) => {
    const v = valueFn(list.filter(inWeek(wk)), wk);
    return { label: weekLabel(wk), tip: `<b>KW ${isoWeek(wk)}</b> (${esc(fmtDate(wk, { day: 'numeric', month: 'short' }))})<br>${v ? `${fmt(v)} ${unit}` : '–'}`, segments: [{ type, color, value: Math.round((v || 0) * 10) / 10 }] };
  }), { unit });
}

function dailyLine(days, key, label, unit, { fmt = (v) => fmtNum(v), color = 'var(--series-1)', invert = false, band } = {}) {
  const pts = days.filter((d) => typeof d[key] === 'number');
  return line(pts.map((d) => ({ x: ms(d.date), y: d[key], tip: `<b>${esc(fmtDate(d.date))}</b><br>${label}: ${fmt(d[key])} ${unit}` })),
    { color, xLabels: xLabels(pts.map((d) => d.date)), yFormat: fmt, invert, band });
}

/** Average bed and wake time ('23:40' style); bed times after midnight count as late evening. */
function sleepTiming(list) {
  const toMin = (t, bed) => { const [h, m] = t.split(':').map(Number); let v = h * 60 + m; if (bed && v < 12 * 60) v += 24 * 60; return v; };
  const fmt = (v) => `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  const bed = list.filter((d) => d.sleepStart).map((d) => toMin(d.sleepStart, true));
  const wake = list.filter((d) => d.sleepEnd).map((d) => toMin(d.sleepEnd, false));
  if (!bed.length) return '';
  const sd = (arr) => { const m = avg(arr); return Math.sqrt(avg(arr.map((x) => (x - m) ** 2))); };
  return ` Ø eingeschlafen ${fmt(avg(bed))}, aufgewacht ${wake.length ? fmt(avg(wake)) : '–'}${bed.length >= 5 ? ` · Regelmässigkeit ±${Math.round(sd(bed))} Min.` : ''}.`;
}

function renderTrends() {
  const weeks = state.trendWeeks;
  const today = todayISO();
  const from = addDays(weekStart(today), -(weeks - 1) * 7);
  const prevFrom = addDays(from, -weeks * 7);
  const all = activities();
  const ctx = {
    weeks, from, prevFrom,
    acts: all.filter((a) => a.date >= from),
    prevActs: all.filter((a) => a.date >= prevFrom && a.date < from),
    days: healthDays().filter((d) => d.date >= from),
    prevDays: healthDays().filter((d) => d.date >= prevFrom && d.date < from),
    weekStarts: Array.from({ length: weeks }, (_, i) => addDays(from, i * 7)),
  };
  // a sport gets its own tab as soon as it was recorded once (any time)
  const sportTabs = sportsIn(all);
  const hasHealth = healthDays().length || Object.keys(checkins()).length;
  const tabs = [['overview', 'Übersicht'], ...(hasHealth ? [['health', '❤️ Gesundheit']] : []), ...sportTabs.map((t) => [t, `${sport(t).emoji} ${SPORT_LABELS[t]}`]), ...(all.length || garminRecords().length ? [['records', '🏆 Rekorde']] : [])];
  if (!tabs.some(([k]) => k === state.trendTab)) state.trendTab = 'overview';
  const tab = state.trendTab;
  const body = tab === 'overview' ? trendOverview(ctx, sportTabs, hasHealth)
    : tab === 'health' ? trendHealth(ctx)
      : tab === 'records' ? trendRecords()
      : tab === 'run' ? trendRun(ctx)
        : tab === 'strength' ? trendStrength(ctx)
          : trendSport(ctx, tab);

  return `
    ${pageHead('Trends', 'Entwicklung über die Zeit', `<div class="segmented" role="group" aria-label="Zeitraum">${[4, 12, 26, 52].map((w) => `<button data-action="trend-range" data-weeks="${w}" aria-pressed="${weeks === w}">${w === 52 ? '1 J' : `${w} W`}</button>`).join('')}</div>`)}
    ${demoBanner()}
    <div class="segmented tabs trend-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-action="trend-tab" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
    ${body}`;
}

// ── overview ──
function trendOverview(ctx, sportTabs, hasHealth) {
  const { acts } = ctx;
  const volumeCols = ctx.weekStarts.map((wk) => {
    const per = minutesBySport(acts.filter(inWeek(wk)));
    return {
      label: weekLabel(wk),
      tip: `<b>KW ${isoWeek(wk)}</b> (${esc(fmtDate(wk, { day: 'numeric', month: 'short' }))})<br>${Object.entries(per).map(([t, m]) => `${esc(SPORT_LABELS[t])}: ${fmtDur(m)}`).join('<br>') || 'Kein Training'}`,
      segments: Object.entries(per).map(([type, value]) => ({ type, value: Math.round((value / 60) * 10) / 10 })),
    };
  });
  const per = minutesBySport(acts);
  const dist = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([t, m]) => ({
    label: `${sport(t).emoji} ${SPORT_LABELS[t]}`, value: m, display: fmtDur(m), color: sportColor(t),
  }));
  const types = sportsIn(acts);
  const avgDay = (list, k) => avg(list.map((d) => d[k]).filter((v) => typeof v === 'number'));
  const sl = avgDay(ctx.days, 'sleepH');
  const rhr = avgDay(ctx.days, 'restingHr');
  const hrv = avgDay(ctx.days, 'hrv');

  const tiles = [
    hasHealth ? `<button class="card sport-tile" data-action="trend-tab" data-tab="health" style="--c:var(--bad)">
      <span class="tile-head">❤️ Gesundheit</span>
      <span class="tile-stats">${sl != null ? `<span><strong>${fmtHours(sl)}</strong> h Schlaf</span>` : ''}${rhr != null ? `<span><strong>${fmtNum(rhr)}</strong> bpm Ruhepuls</span>` : ''}${hrv != null ? `<span><strong>${fmtNum(hrv)}</strong> ms HRV</span>` : ''}</span>
      ${sparkline(ctx.days.map((d) => d.sleepH), 'var(--bad)')}
    </button>` : '',
    ...sportTabs.map((t) => {
      const list = acts.filter((a) => a.type === t);
      const km = sum(list, (a) => a.distanceKm);
      return `<button class="card sport-tile" data-action="trend-tab" data-tab="${t}" style="--c:${sportColor(t)}">
        <span class="tile-head">${sport(t).emoji} ${esc(SPORT_LABELS[t])}</span>
        <span class="tile-stats"><span><strong>${list.length}</strong> Einheiten</span><span><strong>${fmtDur(sum(list, (a) => a.durationMin))}</strong></span>${km ? `<span><strong>${fmtNum(km, t === 'swim' ? 1 : 0)}</strong> km</span>` : ''}</span>
        ${sparkline(ctx.weekStarts.map((wk) => sum(list.filter(inWeek(wk)), (a) => a.durationMin)), sportColor(t))}
      </button>`;
    }),
  ].join('');

  return `<section class="tile-grid">${tiles}</section>
    <section class="grid two">
      ${card('Trainingsumfang pro Woche', 'Stunden nach Sportart', `${bars(volumeCols, { unit: 'h' })}${types.length ? legend(types, SPORT_LABELS) : ''}`, 'wide')}
      ${card('Verteilung', 'Trainingszeit im Zeitraum', dist.length ? hbars(dist) : '<p class="muted">Keine Aktivitäten im Zeitraum.</p>')}
      ${loadCard(ctx, acts)}
    </section>`;
}

/** Weekly session-RPE load (RPE × minutes) – only for activities with an RPE. */
function loadCard(ctx, list, title = 'Belastung pro Woche') {
  if (!list.some((a) => a.rpe)) return '';
  return card(title, 'RPE × Minuten (Session-RPE)', `${weekBars(ctx, list, (w) => sum(w, (a) => (a.rpe ? a.rpe * (a.durationMin || 0) : 0)), { unit: 'AU', color: 'var(--accent)', fmt: (v) => fmtNum(v) })}
    <p class="muted small" style="margin-top:8px">Nur Einheiten mit RPE-Bewertung. Sprünge über ca. 30 % von einer Woche zur nächsten erhöhen das Verletzungsrisiko.</p>`);
}

// ── health ──
const HEALTH = [
  { key: 'sleepH', label: 'Schlaf', unit: 'h', fmt: fmtHours, better: 'higher' },
  { key: 'sleepScore', label: 'Schlaf-Score', unit: '', better: 'higher' },
  { key: 'restingHr', label: 'Ruhepuls', unit: 'bpm', better: 'lower' },
  { key: 'hrv', label: 'HRV', unit: 'ms', better: 'higher' },
  { key: 'stress', label: 'Stress', unit: '', better: 'lower' },
  { key: 'bodyBatteryHigh', label: 'Body Battery (Max.)', unit: '', better: 'higher' },
  { key: 'steps', label: 'Schritte', unit: '', better: 'higher' },
  { key: 'weightKg', label: 'Gewicht', unit: 'kg', fmt: (v) => fmtNum(v, 1), better: 'none' },
];

function trendHealth(ctx) {
  const { days, prevDays } = ctx;
  const avgOf = (list, k) => avg(list.map((d) => d[k]).filter((v) => typeof v === 'number'));
  const present = HEALTH.filter((h) => days.some((d) => typeof d[h.key] === 'number'));
  const tiles = present.map((h) => {
    const cur = avgOf(days, h.key);
    const prev = avgOf(prevDays, h.key);
    const f = h.fmt || ((v) => fmtNum(v));
    let trend = '<span class="trend">kein Vergleich</span>';
    if (prev != null) {
      const delta = cur - prev;
      const small = Math.abs(delta) < (h.key === 'sleepH' ? 0.1 : h.key === 'steps' ? 200 : 1);
      const good = h.better === 'higher' ? delta > 0 : delta < 0;
      if (h.better === 'none') { trend = small ? '<span class="trend">→ wie davor</span>' : `<span class="trend">${delta > 0 ? '↑' : '↓'} ${f(Math.abs(delta))} vs. davor</span>`; return `<article class="kpi"><header><span>Ø ${esc(h.label)}</span></header><div class="kpi-value">${f(cur)}<small>${h.unit}</small></div>${trend}</article>`; }
      trend = small ? '<span class="trend">→ wie davor</span>' : `<span class="trend ${good ? 'good' : 'bad'}">${delta > 0 ? '↑' : '↓'} ${f(Math.abs(delta))} vs. davor</span>`;
    }
    return `<article class="kpi"><header><span>Ø ${esc(h.label)}</span></header><div class="kpi-value">${f(cur)}<small>${h.unit}</small></div>${trend}</article>`;
  }).join('');

  // sleep: daily bars with stages for short ranges, weekly averages for long ones
  const sleepDays = days.filter((d) => d.sleepH);
  let sleep = '';
  if (sleepDays.length) {
    const tipFor = (d) => `<b>${esc(fmtDate(d.date))}</b><br>${fmtHours(d.sleepH)} h Schlaf${d.sleepScore ? ` · Score ${d.sleepScore}` : ''}${d.deepH != null ? `<br>Tief ${fmtHours(d.deepH)} · REM ${fmtHours(d.remH)} · Leicht ${fmtHours(Math.max(0, d.sleepH - d.deepH - (d.remH || 0)))}` : ''}`;
    const daily7 = ctx.weeks <= 6;
    const cols = daily7 ? sleepDays.map((d) => ({
      label: fmtDate(d.date, { day: 'numeric', month: 'numeric' }), tip: tipFor(d),
      segments: d.deepH != null ? [
        { value: d.deepH, color: 'var(--sleep-deep)' }, { value: d.remH || 0, color: 'var(--sleep-rem)' },
        { value: Math.max(0, d.sleepH - d.deepH - (d.remH || 0)), color: 'var(--sleep-light)' },
      ] : [{ value: d.sleepH, color: 'var(--sleep-light)' }],
    })) : ctx.weekStarts.map((wk) => {
      const w = sleepDays.filter(inWeek(wk));
      const a = avgOf(w, 'sleepH');
      return { label: weekLabel(wk), tip: `<b>KW ${isoWeek(wk)}</b><br>Ø ${a ? `${fmtHours(a)} h` : '–'} pro Nacht${w.length ? ` (${w.length} Nächte)` : ''}`, segments: [{ value: a || 0, color: 'var(--sleep-light)' }] };
    });
    const short = sleepDays.filter((d) => d.sleepH < 7).length;
    sleep = card('Schlaf', daily7 ? 'Stunden pro Nacht' : 'Ø pro Nacht und Woche', `${bars(cols, { unit: 'h', height: 160 })}
      ${daily7 && sleepDays.some((d) => d.deepH != null) ? '<div class="legend"><span><i style="background:var(--sleep-deep)"></i>Tief</span><span><i style="background:var(--sleep-rem)"></i>REM</span><span><i style="background:var(--sleep-light)"></i>Leicht</span></div>' : ''}
      <p class="muted small" style="margin-top:8px">${short} von ${sleepDays.length} Nächten unter 7 h. Für Sportler gelten 7–9 h als Richtwert.${sleepTiming(sleepDays)}</p>`, 'wide');
  }

  const ci = Object.entries(checkins()).filter(([d]) => d >= ctx.from).sort(([a], [b]) => a.localeCompare(b));
  const ciChart = ci.length ? card('Check-in', 'Ø Energie, Schlaf, Muskeln, Stress (1–5)', `${line(ci.map(([d, c]) => ({
    x: ms(d), y: checkinScore(c) ?? 0,
    tip: `<b>${esc(fmtDate(d))}</b><br>${CHECKIN.filter(([k]) => c[k]).map(([k, l]) => `${esc(l)} ${c[k]}`).join(' · ')}${c.pain ? `<br>Schmerz ${c.pain}/10 ${esc(c.painWhere || '')}` : ''}${c.sick ? '<br>krank' : ''}`,
  })), { color: 'var(--accent)', xLabels: xLabels(ci.map(([d]) => d)), yFormat: (v) => fmtNum(v, 1) })}
    ${ci.some(([, c]) => c.pain) ? `<p class="small" style="margin-top:8px">${icon('alert', 14)} Schmerzen eingetragen an ${ci.filter(([, c]) => c.pain).length} Tag(en): ${[...new Set(ci.filter(([, c]) => c.painWhere).map(([, c]) => c.painWhere))].map(esc).join(', ') || 'ohne Ort'}</p>` : ''}`) : '';

  const snap = snapshot();
  const fitness = snap.vo2max ? card('Fitness', 'Garmin', `<dl class="stat-grid">
      <div><dt>VO₂max</dt><dd>${fmtNum(snap.vo2max, 1)}</dd></div>
      ${snap.fitnessAge ? `<div><dt>Fitnessalter</dt><dd>${snap.fitnessAge}</dd></div>` : ''}
      ${snap.trainingStatus?.acwr ? `<div><dt>Belastungsverhältnis (ACWR)</dt><dd>${fmtNum(snap.trainingStatus.acwr, 2)}</dd></div>` : ''}
    </dl>`) : '';

  const has = (k) => days.some((d) => typeof d[k] === 'number');
  const stepsWeekly = has('steps') ? card('Schritte', 'Ø pro Tag und Woche', bars(ctx.weekStarts.map((wk) => {
    const a = avgOf(days.filter(inWeek(wk)), 'steps');
    return { label: weekLabel(wk), tip: `<b>KW ${isoWeek(wk)}</b><br>Ø ${a ? fmtNum(a) : '–'} Schritte/Tag`, segments: [{ value: Math.round(a || 0), color: 'var(--s-walk)' }] };
  }))) : '';

  if (!present.length && !ci.length) return emptyState('Keine Gesundheitsdaten im Zeitraum', 'Sobald Garmin synchronisiert oder du Check-ins machst, erscheinen sie hier.');
  return `<section class="kpis">${tiles}</section>
    <section class="grid two">
      ${sleep}
      ${has('restingHr') ? card('Ruhepuls', 'bpm · tiefer = erholter', dailyLine(days, 'restingHr', 'Ruhepuls', 'bpm', { color: 'var(--bad)' })) : ''}
      ${has('hrv') ? card('HRV (Nacht)', 'ms · Band = dein Normalbereich laut Garmin', dailyLine(days, 'hrv', 'HRV', 'ms', { band: (() => { const b = [...days].reverse().find((d) => d.hrvBaseLow && d.hrvBaseHigh); return b ? { lo: b.hrvBaseLow, hi: b.hrvBaseHigh } : undefined; })() })) : ''}
      ${has('stress') ? card('Stress', 'Garmin 0–100 · Tagesschnitt', dailyLine(days, 'stress', 'Stress', '', { color: 'var(--warn)' })) : ''}
      ${has('bodyBatteryHigh') ? card('Body Battery', 'Höchstwert pro Tag', dailyLine(days, 'bodyBatteryHigh', 'Body Battery', '', { color: 'var(--good)' })) : ''}
      ${has('weightKg') ? card('Körpergewicht', 'kg · Garmin und Check-in', dailyLine(days, 'weightKg', 'Gewicht', 'kg', { fmt: (v) => fmtNum(v, 1), color: 'var(--accent)' })) : ''}
      ${has('sleepScore') ? card('Schlaf-Score', '0–100', dailyLine(days, 'sleepScore', 'Score', '', { color: 'var(--sleep-rem)' })) : ''}
      ${stepsWeekly}
      ${intensityCard(ctx, days)}
      ${EXTRA_HEALTH.filter(([k]) => has(k)).map(([k, title, sub, unit, digits, color]) => card(title, sub, dailyLine(days, k, title, unit, { fmt: (v) => fmtNum(v, digits), color }))).join('')}
      ${ciChart}
      ${fitness}
    </section>`;
}

const EXTRA_HEALTH = [
  // key, title, subtitle, unit, digits, colour
  ['readiness', 'Garmin Readiness', '0–100 · Trainingsbereitschaft am Morgen', '', 0, 'var(--good)'],
  ['vo2max', 'VO₂max', 'ml/kg/min · Verlauf seit Sync-Beginn', '', 1, 'var(--s-run)'],
  ['spo2', 'Blutsauerstoff (SpO₂)', '% · Tagesschnitt', '%', 0, 'var(--series-1)'],
  ['respiration', 'Atemfrequenz', 'Atemzüge pro Minute (wach)', '/min', 1, 'var(--series-1)'],
  ['sleepStress', 'Stress im Schlaf', 'Garmin 0–100 · tiefer = erholsamer', '', 0, 'var(--warn)'],
  ['sleepRestingHr', 'Puls im Schlaf', 'bpm', 'bpm', 0, 'var(--bad)'],
  ['kcalActive', 'Aktive Kalorien', 'kcal pro Tag', 'kcal', 0, 'var(--accent)'],
  ['floors', 'Stockwerke', 'pro Tag', '', 0, 'var(--s-walk)'],
  ['bodyFat', 'Körperfett', '% · Waage', '%', 1, 'var(--accent)'],
  ['muscleKg', 'Muskelmasse', 'kg · Waage', 'kg', 1, 'var(--s-strength)'],
];

/** Weekly intensity minutes (moderate + 2× vigorous) against the WHO minimum of 150. */
function intensityCard(ctx, days) {
  if (!days.some((d) => d.moderateMin != null || d.vigorousMin != null)) return '';
  return card('Intensitätsminuten', 'pro Woche · WHO-Minimum 150', `${bars(ctx.weekStarts.map((wk) => {
    const w = days.filter(inWeek(wk));
    const v = w.reduce((s, d) => s + (d.moderateMin || 0) + 2 * (d.vigorousMin || 0), 0);
    return { label: weekLabel(wk), tip: `<b>KW ${isoWeek(wk)}</b><br>${v} Intensitätsminuten${v >= 150 ? ' ✓' : ''}`, segments: [{ value: v, color: v >= 150 ? 'var(--good)' : 'var(--warn)' }] };
  }))}`);
}

// ── records ──
const garminRecords = () => state.data?.garmin?.records || [];
const RECORD_SPORTS = [['run', '🏃 Laufen'], ['swim', '🏊 Schwimmen'], ['cycle', '🚴 Rad'], ['strength', '🏋️ Kraft'], ['steps', '👟 Schritte'], ['other', '✨ Weitere']];

function fmtRecord(r) {
  const v = r.value;
  if (v == null) return '–';
  if (r.kind === 'time') return fmtClock(Math.round(v));
  if (r.kind === 'distance') return r.sport === 'swim' ? `${fmtNum(v)} m` : `${fmtNum(v / 1000, 2)} km`;
  if (r.kind === 'power') return `${fmtNum(v)} W`;
  if (r.kind === 'elevation') return `${fmtNum(v)} m`;
  if (r.kind === 'pace') return `${fmtPace(v)} ${r.sport === 'swim' ? '/100 m' : '/km'}`;
  if (r.kind === 'kg') return `${fmtNum(v, 1)} kg`;
  if (r.kind === 'sec') return `${fmtNum(v)} s`;
  if (r.kind === 'reps') return `${fmtNum(v)} Wdh.`;
  return fmtNum(v);
}

/** Records computed from the athlete's own data (complements Garmin's list). */
function ownRecords(acts) {
  const out = [];
  const best = (list, f, better = 'max') => {
    const hit = list.reduce((b, a) => { const v = f(a); return v && (!b || (better === 'max' ? v > b.v : v < b.v)) ? { v, a } : b; }, null);
    if (hit) hit.earlier = list.filter((a) => a.date < hit.a.date && f(a)).length;
    return hit;
  };
  // improved = an earlier activity existed for this metric, so the record really beat something
  const push = (sport, label, kind, hit, extra = {}) => hit && out.push({ sport, label, kind, value: hit.v, date: hit.a.date, activityId: hit.a.id, own: true, improved: hit.earlier > 0, ...extra });
  const runs = acts.filter((a) => a.type === 'run' && a.distanceKm);
  push('run', 'Längster Lauf', 'distance', best(runs, (a) => a.distanceKm * 1000));
  push('run', 'Schnellste Ø-Pace ab 5 km', 'pace', best(runs.filter((a) => a.distanceKm >= 5 && a.paceSecPerKm), (a) => a.paceSecPerKm, 'min'));
  push('run', 'Schnellste Ø-Pace ab 10 km', 'pace', best(runs.filter((a) => a.distanceKm >= 10 && a.paceSecPerKm), (a) => a.paceSecPerKm, 'min'));
  push('run', 'Meiste Höhenmeter in einem Lauf', 'elevation', best(runs, (a) => a.elevationGain));
  const swims = acts.filter((a) => a.type === 'swim' && a.distanceKm);
  push('swim', 'Längste Schwimmeinheit', 'distance', best(swims, (a) => a.distanceKm * 1000));
  push('swim', 'Schnellste Ø-Pace ab 400 m', 'pace', best(swims.filter((a) => a.distanceKm >= 0.4), (a) => a.paceSecPer100m || (a.durationMin * 60) / (a.distanceKm * 10), 'min'));
  push('swim', 'Bester SWOLF', 'value', best(swims.filter((a) => a.swolf), (a) => a.swolf, 'min'));
  const rides = acts.filter((a) => a.type === 'cycle' && a.distanceKm);
  push('cycle', 'Längste Radfahrt', 'distance', best(rides, (a) => a.distanceKm * 1000));
  // strength: best estimated 1RM (or reps / seconds) per exercise
  const per = new Map();
  for (const a of [...acts].reverse()) { // oldest first, so 'improved' means it beat an earlier session
    if (a.eval) continue;
    for (const e of a.exercises || []) {
      const b = bestE1rm(e);
      const v = b ?? Math.max(0, ...e.sets.map((x) => x.reps || 0));
      if (!v) continue;
      const cur = per.get(e.id);
      const seen = (cur?.seen || 0) + 1;
      if (!cur || v > cur.value) per.set(e.id, { sport: 'strength', label: e.name, kind: b ? 'kg' : e.unit === 's' ? 'sec' : 'reps', value: v, date: a.date, activityId: a.id, own: true, detail: b ? `≈ 1RM aus ${fmtSets(e.sets, e.unit)}` : `${fmtSets(e.sets, e.unit)}`, unit: e.unit, improved: !!cur, seen });
      else cur.seen = seen;
    }
  }
  out.push(...[...per.values()].sort((x, y) => x.label.localeCompare(y.label)));
  return out;
}

function recentRecords(days = 7) {
  const since = addDays(todayISO(), -days);
  const g = garminRecords().filter((r) => r.date >= since);
  // strength PRs: a session that beat all earlier sessions of that exercise
  const acts = activities();
  const own = [];
  for (const a of acts.filter((x) => x.date >= since && x.exercises?.length && !x.eval)) {
    const earlier = acts.filter((x) => (x.start || x.date) < (a.start || a.date));
    for (const e of a.exercises) {
      const b = bestE1rm(e);
      const prev = earlier.flatMap((x) => (x.exercises || []).filter((y) => y.id === e.id)).map(bestE1rm).filter(Boolean);
      if (b && prev.length && b > Math.max(...prev)) own.push({ label: e.name, kind: 'kg', value: b, date: a.date, sport: 'strength' });
    }
  }
  return [...g, ...own];
}

function recordsBanner() {
  const recs = recentRecords(7);
  if (!recs.length) return '';
  return `<article class="card records-banner"><span class="trophy">🏆</span><div><p class="eyebrow">Neue Rekorde diese Woche</p>
    <p>${recs.slice(0, 4).map((r) => `<strong>${esc(r.label)}</strong> ${esc(fmtRecord(r))}`).join(' · ')}</p></div>
    <a class="link" href="#/trends" data-action="trend-tab" data-tab="records">Alle ${icon('chevron', 14)}</a></article>`;
}

function trendRecords() {
  const g = garminRecords();
  const own = ownRecords(activities());
  const ids = new Set(activities().map((a) => a.id));
  const since = addDays(todayISO(), -14);
  const row = (r) => `<li>
    <div><span>${esc(r.label)}</span>${r.detail || r.activityName ? `<span class="muted small">${esc(r.detail || r.activityName)}</span>` : ''}</div>
    <strong>${esc(fmtRecord(r))}</strong>
    <span class="muted small">${r.date ? esc(fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' })) : ''}${r.date >= since && (!r.own || r.improved) ? ' <span class="chip good">neu</span>' : ''}</span>
    ${r.activityId && ids.has(r.activityId) ? `<button class="icon-btn sm" data-action="open-activity" data-id="${esc(r.activityId)}" aria-label="Aktivität öffnen">${icon('chevron', 16)}</button>` : '<span></span>'}
  </li>`;
  const section = (title, list, sub) => (list.length ? card(title, sub, RECORD_SPORTS.filter(([k]) => list.some((r) => r.sport === k)).map(([k, l]) => `<h3 class="sub">${l}</h3><ul class="records rec-list">${list.filter((r) => r.sport === k).map(row).join('')}</ul>`).join('')) : '');
  if (!g.length && !own.length) return emptyState('Noch keine Rekorde', 'Sobald Trainings erfasst sind oder Garmin Rekorde meldet, erscheinen sie hier.');
  return `<section class="grid two">
    ${section('Garmin-Rekorde', g, 'offiziell von Garmin Connect')}
    ${section('Aus deinen Daten', own, 'alle erfassten Trainings')}
  </section>
  ${g.length ? '' : '<p class="muted small">Garmin-Rekorde (z.B. schnellste 5 km, 100 m Schwimmen) erscheinen nach dem nächsten Sync.</p>'}`;
}

// ── running ──
function trendRun(ctx) {
  const runs = ctx.acts.filter((a) => a.type === 'run');
  if (!runs.length) return emptyState('Keine Läufe im Zeitraum', 'Wähle einen längeren Zeitraum.');
  const km = sum(runs, (a) => a.distanceKm);
  const mins = sum(runs, (a) => a.durationMin);
  const longest = Math.max(...runs.map((a) => a.distanceKm || 0));
  const prevKm = sum(ctx.prevActs.filter((a) => a.type === 'run'), (a) => a.distanceKm);
  const paced = runs.filter((a) => a.paceSecPerKm && (a.distanceKm || 0) >= 2).reverse();
  const paceChart = line(paced.map((r, i) => {
    const rolling = avg(paced.slice(Math.max(0, i - 4), i + 1).map((x) => x.paceSecPerKm));
    return { x: ms(r.date), y: rolling, tip: `<b>${esc(actTitle(r))}</b><br>${esc(fmtDate(r.date))}<br>${fmtPace(r.paceSecPerKm)} /km · ${fmtNum(r.distanceKm, 1)} km${r.avgHr ? ` · ${r.avgHr} bpm` : ''}<br>Ø letzte 5 Läufe: ${fmtPace(rolling)} /km` };
  }), { invert: true, yFormat: fmtPace, steps: [10, 15, 30, 60, 120], color: 'var(--s-run)', xLabels: xLabels(paced.map((r) => r.date)), area: false });
  const hrRuns = paced.filter((r) => r.avgHr);
  // efficiency: metres per heartbeat – rises when you get fitter (same pace at lower HR)
  const eff = hrRuns.length >= 2 ? line(hrRuns.map((r) => ({ x: ms(r.date), y: Math.round((1000 / r.paceSecPerKm) * 60 / r.avgHr * 100) / 100, tip: `<b>${esc(fmtDate(r.date))}</b><br>${fmtPace(r.paceSecPerKm)} /km bei ${r.avgHr} bpm` })),
    { color: 'var(--s-run)', xLabels: xLabels(hrRuns.map((r) => r.date)), yFormat: (v) => fmtNum(v, 2) }) : '';
  const snap = snapshot();
  const races = snap.racePredictions;
  const race = profile().race;
  const own = raceEstimate(activities(), race?.distanceKm || HM_KM);
  const longCols = card('Längster Lauf pro Woche', 'km', weekBars(ctx, runs, (w) => Math.max(0, ...w.map((a) => a.distanceKm || 0)), { unit: 'km', type: 'run' }));
  return `${statRow([
    [runs.length, 'Läufe'], [fmtNum(km, 1), `km${prevKm ? ` (davor ${fmtNum(prevKm, 0)})` : ''}`], [fmtDur(mins), 'Laufzeit'],
    km ? [fmtPace((mins * 60) / km), 'Ø Pace /km'] : null, [fmtNum(longest, 1), 'längster (km)'],
  ])}
    <section class="grid two">
      ${card('Kilometer pro Woche', '', weekBars(ctx, runs, (w) => sum(w, (a) => a.distanceKm), { unit: 'km', type: 'run' }))}
      ${card('Pace', 'Ø 5 Läufe · höher = schneller', paceChart)}
      ${eff ? card('Laufökonomie', 'Meter pro Herzschlag · höher = fitter', eff) : ''}
      ${runDynamics(paced)}
      ${longCols}
      ${own ? card(`Prognose ${esc(RACE_DISTANCES[race?.distanceKm || HM_KM] || 'Halbmarathon')}`, 'aus deinen Läufen der letzten 8 Wochen', `<dl class="stat-grid">
          <div><dt>Prognose</dt><dd>${fmtClock(Math.round(own.sec))}</dd></div>
          <div><dt>Pace</dt><dd>${fmtPace(own.sec / (race?.distanceKm || HM_KM))} /km</dd></div>
          ${race?.goalSec ? `<div><dt>Ziel</dt><dd>${fmtClock(race.goalSec)}</dd></div><div><dt>Differenz</dt><dd>${own.sec <= race.goalSec ? '−' : '+'}${fmtClock(Math.abs(Math.round(own.sec - race.goalSec)))}</dd></div>` : ''}
        </dl><p class="muted small" style="margin-top:8px">Riegel-Formel ab dem besten Lauf ≥ 5 km (${esc(actTitle(own.run))}, ${esc(fmtDate(own.run.date, { day: 'numeric', month: 'short' }))}). Lockere Läufe werden über das RPE hochgerechnet – eher grobe Richtung als exakte Zeit.</p>`) : ''}
      ${races || snap.lactateThreshold || snap.vo2max ? card('Leistungswerte', 'Garmin', `<dl class="stat-grid">
          ${snap.vo2max ? `<div><dt>VO₂max</dt><dd>${fmtNum(snap.vo2max, 1)}</dd></div>` : ''}
          ${snap.lactateThreshold?.heartRate ? `<div><dt>Laktatschwelle</dt><dd>${snap.lactateThreshold.heartRate} bpm${snap.lactateThreshold.paceSecPerKm ? ` · ${fmtPace(snap.lactateThreshold.paceSecPerKm)}/km` : ''}</dd></div>` : ''}
          ${races ? [['5 km', races['5k']], ['10 km', races['10k']], ['Halbmarathon', races.half], ['Marathon', races.marathon]].filter(([, v]) => v).map(([k, v]) => `<div><dt>Prognose ${k}</dt><dd>${fmtClock(v)}</dd></div>`).join('') : ''}
        </dl>`) : ''}
      ${loadCard(ctx, runs, 'Laufbelastung pro Woche')}
    </section>`;
}

/** Running dynamics per run: cadence, stride, ground contact (only if the watch records them). */
function runDynamics(runs) {
  const series = [
    ['cadence', 'Kadenz', 'Schritte/min', 0, 'var(--s-run)'],
    ['strideCm', 'Schrittlänge', 'cm', 0, 'var(--series-1)'],
    ['groundContactMs', 'Bodenkontaktzeit', 'ms · tiefer = effizienter', 0, 'var(--warn)'],
    ['avgPower', 'Laufleistung', 'Watt', 0, 'var(--accent)'],
  ].filter(([k]) => runs.filter((r) => r[k]).length >= 2);
  return series.map(([k, title, sub, digits, color]) => {
    const pts = runs.filter((r) => r[k]);
    return card(title, sub, line(pts.map((r) => ({ x: ms(r.date), y: r[k], tip: `<b>${esc(actTitle(r))}</b><br>${esc(fmtDate(r.date))}<br>${title}: ${fmtNum(r[k], digits)}` })),
      { color, xLabels: xLabels(pts.map((r) => r.date)), yFormat: (v) => fmtNum(v, digits) }));
  }).join('');
}

// ── strength ──
function trendStrength(ctx) {
  const list = ctx.acts.filter((a) => a.type === 'strength');
  if (!list.length) return emptyState('Kein Krafttraining im Zeitraum', 'Wähle einen längeren Zeitraum.');
  const sessions = list.filter((a) => a.exercises?.length).reverse(); // oldest first
  const sets = sum(sessions, (a) => sum(a.exercises, (e) => e.sets.length));
  const vol = sum(sessions, (a) => volume(a.exercises));
  let charts = '';
  if (sessions.length) {
    const counts = new Map();
    for (const a of sessions) for (const e of a.exercises) counts.set(e.id, { name: e.name, unit: e.unit, n: (counts.get(e.id)?.n || 0) + 1 });
    const options = [...counts].sort((x, y) => y[1].n - x[1].n);
    if (!counts.has(state.trendExercise)) state.trendExercise = options[0][0];
    const current = counts.get(state.trendExercise);
    const points = sessions.flatMap((a) => {
      const e = a.exercises.find((x) => x.id === state.trendExercise);
      if (!e) return [];
      const best = bestE1rm(e);
      const y = best ?? Math.max(...e.sets.map((s) => s.reps || 0));
      return [{ x: ms(a.date), y, date: a.date, tip: `<b>${esc(fmtDate(a.date))}</b><br>${esc(fmtSets(e.sets, e.unit))}${best ? `<br>≈ 1RM ${fmtNum(best)} kg` : ''}` }];
    });
    const weighted = sessions.some((a) => a.exercises.some((e) => e.id === state.trendExercise && bestE1rm(e)));
    const unit = weighted ? 'kg' : current.unit === 's' ? 's' : 'Wdh.';
    const perGroup = {};
    for (const a of sessions) for (const e of a.exercises) perGroup[e.group || 'Eigene'] = (perGroup[e.group || 'Eigene'] || 0) + e.sets.length;
    const groups = Object.entries(perGroup).sort((x, y) => y[1] - x[1])
      .map(([g, n]) => ({ label: g, value: n, display: `${fmtNum(n / ctx.weeks, 1)}/Wo`, tip: `${g}: ${n} Sätze (${fmtNum(n / ctx.weeks, 1)} pro Woche)`, color: 'var(--s-strength)' }));
    // best value per exercise in the range (records)
    const best = options.map(([id, o]) => {
      let top = null;
      for (const a of sessions) {
        const e = a.exercises.find((x) => x.id === id);
        if (!e) continue;
        const b = bestE1rm(e);
        const v = b ?? Math.max(...e.sets.map((s) => s.reps || 0));
        if (!top || v > top.v) top = { v, kg: !!b, date: a.date, sets: fmtSets(e.sets, e.unit) };
      }
      return { ...o, ...top };
    });
    charts = `
      ${card('Fortschritt pro Übung', `<select id="trend-ex" class="mini-select" aria-label="Übung wählen">${options.map(([id, o]) => `<option value="${esc(id)}" ${id === state.trendExercise ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`,
        `${line(points, { color: 'var(--s-strength)', yFormat: (v) => `${fmtNum(v)}`, xLabels: xLabels(points.map((p) => p.date)) })}
        <p class="muted small" style="margin-top:8px">${weighted ? 'Geschätztes Maximalgewicht (1RM, Epley-Formel) pro Training in kg' : `Beste Leistung pro Training in ${unit}`}</p>`)}
      ${card('Sätze pro Muskelgruppe', 'pro Woche im Schnitt', hbars(groups))}
      ${card('Bestwerte im Zeitraum', '', `<ul class="records">${best.map((b) => `<li><span>${esc(b.name)}</span><span class="muted small">${esc(b.sets)}</span><strong>${b.kg ? `≈ ${fmtNum(b.v)} kg` : `${fmtNum(b.v)} ${b.unit === 's' ? 's' : 'Wdh.'}`}</strong><span class="muted small">${esc(fmtDate(b.date, { day: 'numeric', month: 'short' }))}</span></li>`).join('')}</ul>`, 'wide')}
      ${vol ? card('Volumen pro Woche', 'kg × Wiederholungen', weekBars(ctx, sessions, (w) => sum(w, (a) => volume(a.exercises)), { unit: 'kg', type: 'strength', fmt: (v) => fmtNum(v) })) : ''}`;
  }
  return `${statRow([[list.length, 'Einheiten'], [fmtNum(list.length / ctx.weeks, 1), 'pro Woche'], [sets, 'Sätze'], vol ? [fmtNum(vol / 1000, 1), 't Volumen'] : null])}
    <section class="grid two">
      ${charts || card('Noch keine Übungen erfasst', '', '<p class="muted">Erfasse Sätze im Training (oder ergänze eine Garmin-Krafteinheit), dann siehst du hier Fortschritt, Muskelgruppen und Bestwerte.</p>')}
      ${card('Einheiten pro Woche', '', weekBars(ctx, list, (w) => w.length, { unit: '', type: 'strength', fmt: (v) => fmtNum(v) }))}
      ${loadCard(ctx, list, 'Kraftbelastung pro Woche')}
    </section>`;
}

function swimTechnique(list) {
  const s = [...list].reverse();
  return [['swolf', 'SWOLF', 'Zeit + Züge pro Bahn · tiefer = effizienter', 'var(--s-swim)'],
    ['avgStrokesPerLength', 'Züge pro Bahn', 'tiefer = längerer Zug', 'var(--series-1)'],
    ['strokeRate', 'Zugrate', 'Züge pro Minute', 'var(--accent)']]
    .filter(([k]) => s.filter((a) => a[k]).length >= 2)
    .map(([k, title, sub, color]) => {
      const pts = s.filter((a) => a[k]);
      return card(title, sub, line(pts.map((a) => ({ x: ms(a.date), y: a[k], tip: `<b>${esc(fmtDate(a.date))}</b><br>${title}: ${fmtNum(a[k], 1)}${a.poolLengthM ? ` · ${fmtNum(a.poolLengthM)} m Becken` : ''}` })),
        { color, xLabels: xLabels(pts.map((a) => a.date)), yFormat: (v) => fmtNum(v, 0) }));
    }).join('');
}

// ── every other sport (swim, cycle, mobility, …) ──
function trendSport(ctx, t) {
  const list = ctx.acts.filter((a) => a.type === t);
  const label = SPORT_LABELS[t];
  if (!list.length) return emptyState(`Kein ${esc(label)} im Zeitraum`, 'Wähle einen längeren Zeitraum.');
  const km = sum(list, (a) => a.distanceKm);
  const mins = sum(list, (a) => a.durationMin);
  const hr = avg(list.map((a) => a.avgHr).filter(Boolean));
  const withDist = list.filter((a) => a.distanceKm > 0 && a.durationMin).reverse();
  let speed = '';
  if (withDist.length >= 2 && t === 'swim') {
    const per100 = (a) => a.paceSecPer100m || (a.durationMin * 60) / (a.distanceKm * 10);
    speed = card('Tempo', 'pro 100 m · höher = schneller', line(withDist.map((a) => ({ x: ms(a.date), y: per100(a), tip: `<b>${esc(fmtDate(a.date))}</b><br>${fmtNum(a.distanceKm * 1000)} m · ${fmtPace(per100(a))} /100 m` })),
      { invert: true, yFormat: fmtPace, steps: [5, 10, 15, 30], color: sportColor(t), xLabels: xLabels(withDist.map((a) => a.date)), area: false }));
  } else if (withDist.length >= 2) {
    const kmh = (a) => a.distanceKm / (a.durationMin / 60);
    speed = card('Geschwindigkeit', 'km/h', line(withDist.map((a) => ({ x: ms(a.date), y: kmh(a), tip: `<b>${esc(fmtDate(a.date))}</b><br>${fmtNum(a.distanceKm, 1)} km · ${fmtNum(kmh(a), 1)} km/h` })),
      { color: sportColor(t), xLabels: xLabels(withDist.map((a) => a.date)), yFormat: (v) => fmtNum(v, 1) }));
  }
  const fb = t === 'football' ? list.filter((a) => a.football?.kind === 'match') : [];
  return `${statRow([
    [list.length, 'Einheiten'], [fmtNum(list.length / ctx.weeks, 1), 'pro Woche'], [fmtDur(mins), 'Zeit'],
    km ? [t === 'swim' ? fmtNum(km * 1000) : fmtNum(km, 1), t === 'swim' ? 'Meter' : 'km'] : null,
    hr ? [fmtNum(hr), 'Ø Puls'] : null,
    fb.length ? [fb.length, 'Matches'] : null,
    fb.length ? [sum(fb, (a) => a.football.goals), 'Tore'] : null,
  ])}
    <section class="grid two">
      ${km ? card(t === 'swim' ? 'Meter pro Woche' : 'Kilometer pro Woche', '', weekBars(ctx, list, (w) => sum(w, (a) => a.distanceKm) * (t === 'swim' ? 1000 : 1), { unit: t === 'swim' ? 'm' : 'km', type: t, fmt: (v) => fmtNum(v, t === 'swim' ? 0 : 1) }))
        : card('Minuten pro Woche', '', weekBars(ctx, list, (w) => sum(w, (a) => a.durationMin), { unit: 'min', type: t, fmt: (v) => fmtNum(v) }))}
      ${card('Einheiten pro Woche', '', weekBars(ctx, list, (w) => w.length, { unit: '', type: t, fmt: (v) => fmtNum(v) }))}
      ${speed}
      ${t === 'swim' ? swimTechnique(list) : ''}
      ${loadCard(ctx, list, `Belastung ${esc(label)}`)}
    </section>`;
}

// ───────────────────────── page: settings ─────────────────────────
function renderSettings() {
  const cfg = store.getConfig();
  const prefs = store.getPrefs();
  const p = profile();
  const live = store.isLive();
  return `
    ${pageHead('Einstellungen', live ? `Verbunden mit ${esc(cfg.owner)}/${esc(cfg.dataRepo)}` : 'Demo-Modus')}
    <section class="grid two settings">
      <article class="card">
        <header class="card-head"><h2>${icon('link', 18)} GitHub-Verbindung</h2>${live ? '<span class="chip good">Verbunden</span>' : ''}</header>
        <p class="muted small">Deine Daten liegen als JSON-Dateien in einem (privaten) GitHub-Repository. Der Token bleibt nur auf diesem Gerät gespeichert. Anleitung im README.</p>
        <form id="cfg-form" class="form">
          <div class="row">
            <label class="field"><span>GitHub-Benutzer</span><input name="owner" value="${esc(cfg.owner || store.detectedRepo().owner || '')}" placeholder="schnre" required autocomplete="username"></label>
            <label class="field"><span>Branch</span><input name="branch" value="${esc(cfg.branch || 'main')}"></label>
          </div>
          <div class="row">
            <label class="field"><span>Daten-Repo</span><input name="dataRepo" value="${esc(cfg.dataRepo || '')}" placeholder="healthy_football_data" required></label>
            <label class="field"><span>App-Repo (Workflows)</span><input name="codeRepo" value="${esc(live ? store.appRepo() : (cfg.codeRepo || store.detectedRepo().codeRepo || ''))}" placeholder="Healthy_Football"></label>
          </div>
          <label class="field"><span>Fine-grained Personal Access Token</span><input name="token" type="password" value="${esc(cfg.token || '')}" placeholder="github_pat_…" autocomplete="off"></label>
          <div class="form-actions">
            ${live ? `<button type="button" class="btn btn-danger" data-action="disconnect">Trennen</button>` : ''}
            <button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern & testen</button>
          </div>
        </form>
      </article>

      <article class="card">
        <header class="card-head"><h2>${icon('user', 18)} Profil für den Coach</h2></header>
        <form id="profile-form" class="form">
          <div class="row">
            <label class="field grow"><span>Name</span><input name="name" value="${esc(p.name || '')}"></label>
            <label class="field"><span>Alter</span><input name="age" type="number" inputmode="numeric" value="${esc(p.age ?? '')}"></label>
            <label class="field"><span>Gewicht (kg)</span><input name="weightKg" type="number" inputmode="decimal" step="0.1" value="${esc(p.weightKg ?? '')}"></label>
            <label class="field"><span>Max. Puls</span><input name="maxHr" type="number" inputmode="numeric" value="${esc(p.maxHr ?? '')}"></label>
          </div>
          <div class="row">
            <label class="field grow"><span>Position</span>
              <select name="position">${['', 'Sturm', 'Flügel', 'Offensives Mittelfeld', 'Zentrales Mittelfeld', 'Defensives Mittelfeld', 'Aussenverteidigung', 'Innenverteidigung', 'Torhüter'].map((o) => `<option ${p.position === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
            </label>
            <label class="field grow"><span>Niveau / Liga</span><input name="level" value="${esc(p.level || '')}" placeholder="z.B. 4. Liga"></label>
            <label class="field"><span>Tage/Woche</span><input name="trainingDays" type="number" min="1" max="7" value="${esc(p.trainingDays ?? '')}"></label>
          </div>
          <fieldset class="type-picker">
            <legend>Deine Sportarten <em class="muted">(steuert Auswahl beim Erfassen und den Coach)</em></legend>
            ${Object.keys(SPORTS).filter((k) => k !== 'other').map((k) => `<label style="--c:${sportColor(k)}"><input type="checkbox" name="sports" value="${k}" ${!p.sports?.length || p.sports.includes(k) ? 'checked' : ''}><span>${SPORTS[k].emoji}</span>${esc(SPORTS[k].label)}</label>`).join('')}
          </fieldset>
          <label class="field"><span>Verletzungen / Einschränkungen</span><textarea name="injuries" rows="2">${esc(p.injuries || '')}</textarea></label>
          <label class="field"><span>Feste Termine</span><input name="schedule" value="${esc(p.schedule || '')}" placeholder="z.B. Training Di + Do 19:30, Match Sa"></label>
          <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('check', 16)}Profil speichern</button></div>
        </form>
      </article>

      ${goalsCard(p)}
      ${raceSettingsCard(p)}
      ${remindersCard(p)}
      ${stretchSettingsCard(p)}
      ${nutritionCard(p)}
      ${templatesCard(p)}
      ${exercisesCard(p)}

      <article class="card">
        <header class="card-head"><h2>${icon('sparkles', 18)} Automatisierung</h2></header>
        <label class="switch"><input type="checkbox" data-pref="analyzeAfterEntry" ${prefs.analyzeAfterEntry ? 'checked' : ''}><span></span>Nach jedem erfassten Training automatisch analysieren (kostet API-Guthaben)</label>
        <p class="muted small">Garmin wird automatisch alle 3 Stunden synchronisiert – das ist gratis. Claude analysiert nur, wenn du «Neu analysieren» drückst oder eine Frage stellst (ca. 0.10–0.20 USD pro Analyse).</p>
        <p class="muted small">Letzter Garmin-Sync: <strong>${esc(relTime(state.data?.garmin?.updatedAt))}</strong> · Letzte Analyse: <strong>${esc(relTime(state.data?.insights?.generatedAt))}</strong></p>
        <div class="form-actions">
          <button class="btn" data-action="sync">${icon('refresh', 16)}Garmin jetzt synchronisieren</button>
          <button class="btn" data-action="analyze">${icon('sparkles', 16)}Analyse starten</button>
        </div>
      </article>

      <article class="card">
        <header class="card-head"><h2>${icon('sun', 18)} Darstellung & Geräte</h2></header>
        <div class="segmented" role="group" aria-label="Farbschema">${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `<button data-action="theme" data-theme="${k}" aria-pressed="${prefs.theme === k}">${l}</button>`).join('')}</div>
        <h3 class="sub">Anderes Gerät verbinden</h3>
        <p class="muted small">Kopiert einen Link mit deiner Konfiguration <strong>inklusive Token</strong>. Öffne ihn auf dem Handy und füge die App danach zum Home-Bildschirm hinzu. Schicke ihn nur an dich selbst.</p>
        <div class="form-actions">
          <button class="btn" data-action="copy-link" ${live ? '' : 'disabled'}>${icon('link', 16)}Setup-Link kopieren</button>
          <button class="btn" data-action="export">${icon('download', 16)}Daten exportieren</button>
          ${live ? '' : `<button class="btn" data-action="reset-demo">Demo zurücksetzen</button>`}
        </div>
      </article>
    </section>`;
}

function targetRow(t = {}) {
  return `<div class="row target-row">
    <label class="field grow"><span>Ziel</span><input name="targetText" value="${esc(t.text || '')}" placeholder="z.B. 10 km unter 42:00 · Kniebeuge 100 kg"></label>
    <label class="field"><span>Bis</span><input name="targetDate" type="date" value="${esc(t.date || '')}"></label>
    <button type="button" class="icon-btn" data-action="remove-target" aria-label="Ziel entfernen">${icon('trash', 16)}</button>
  </div>`;
}

function goalsCard(p) {
  const g = p.goals;
  return `<article class="card">
    <header class="card-head"><h2>${icon('target', 18)} Ziele & Schwerpunkt</h2></header>
    <form id="goals-form" class="form">
      <label class="field"><span>Hauptziel</span>
        <select name="main"><option value="">– wählen –</option>${Object.entries(FOCUS).map(([k, l]) => `<option value="${k}" ${g.main === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
      <fieldset class="chip-checks">
        <legend>Weitere Ziele</legend>
        ${Object.entries(FOCUS).map(([k, l]) => `<label><input type="checkbox" name="secondary" value="${k}" ${g.secondary.includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('')}
      </fieldset>
      <fieldset>
        <legend>Saisonphase</legend>
        <div class="segmented">${Object.entries(PHASES).map(([k, l]) => `<label><input type="radio" name="phase" value="${k}" ${g.phase === k ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>
      </fieldset>
      <fieldset class="weekly-inputs">
        <legend>Wochenziele <em class="muted">(Einheiten pro Woche, leer = kein Ziel)</em></legend>
        ${WEEKLY_SPORTS.filter((k) => !p.sports?.length || p.sports.includes(k) || p.weekly[k]).map((k) => `<label class="field"><span>${SPORTS[k].emoji} ${esc(SPORTS[k].label)}</span><input type="number" name="weekly_${k}" min="0" max="14" inputmode="numeric" value="${esc(p.weekly[k] || '')}" placeholder="–"></label>`).join('')}
      </fieldset>
      <div class="targets">${(g.targets.length ? g.targets : [{}]).map(targetRow).join('')}</div>
      <button type="button" class="btn btn-sm add-target" data-action="add-target">${icon('plus', 14)}Messbares Ziel</button>
      <label class="field"><span>Details & Wünsche</span><textarea name="notes" rows="2" placeholder="z.B. Ich mag keine Bahnintervalle, will bis Saisonstart fitter sein als letztes Jahr">${esc(g.notes)}</textarea></label>
      <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('check', 16)}Ziele speichern</button></div>
    </form>
  </article>`;
}

function nutritionCard(p) {
  const n = p.nutrition;
  return `<article class="card">
    <header class="card-head"><h2>🍽️ Ernährung</h2>${n.enabled ? '<span class="chip good">Aktiv</span>' : ''}</header>
    <form id="nutrition-form" class="form">
      <label class="switch"><input type="checkbox" name="enabled" ${n.enabled ? 'checked' : ''}><span></span>Ernährungstipps vom Coach (Faustregeln vor/nach Training und Match)</label>
      <div class="row">
        <label class="field"><span>Ernährungsform</span><select name="diet">${DIETS.map((d) => `<option ${n.diet === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field grow"><span>Unverträglichkeiten / Allergien</span><input name="intolerances" value="${esc(n.intolerances)}" placeholder="z.B. Laktose, Nüsse"></label>
      </div>
      <p class="muted small">Grundlage: Leitlinien von ACSM, ISSN und UEFA zur Sporternährung. Keine medizinische Beratung – bei Allergien oder Erkrankungen Fachperson fragen.</p>
      <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern</button></div>
    </form>
  </article>`;
}

function exercisesCard(p) {
  const custom = p.customExercises;
  return `<article class="card">
    <header class="card-head"><h2>🏋️ Übungen</h2><span class="muted small">${custom.length} eigene</span></header>
    ${custom.length ? `<ul class="custom-ex">${custom.map((e) => `<li><span>${esc(e.name)} <span class="muted small">· ${esc(e.group || 'Eigene')}${e.unit === 's' ? ' · Sekunden' : ''}</span></span>
      <button class="icon-btn sm" data-action="remove-exercise" data-id="${esc(e.id)}" aria-label="${esc(e.name)} entfernen">${icon('trash', 16)}</button></li>`).join('')}</ul>` : '<p class="muted small">Noch keine eigenen Übungen. Du kannst sie hier oder direkt beim Erfassen eines Krafttrainings anlegen.</p>'}
    <form id="exercise-form" class="form" style="margin-top:14px">
      <div class="row">
        <label class="field grow"><span>Neue Übung</span><input name="name" placeholder="z.B. Sled Push" required maxlength="60"></label>
        <label class="field"><span>Gruppe</span><select name="group">${MUSCLE_GROUPS.map((g) => `<option ${g === 'Eigene' ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label class="field"><span>Messung</span><select name="unit"><option value="">Wiederholungen</option><option value="s">Sekunden</option></select></label>
      </div>
      <div class="form-actions"><button type="submit" class="btn">${icon('plus', 16)}Übung hinzufügen</button></div>
    </form>
    <details class="builtin-ex"><summary class="muted small">Standardliste anzeigen</summary>
      ${MUSCLE_GROUPS.filter((g) => g !== 'Eigene').map((g) => `<p class="small"><strong>${g}:</strong> ${catalog({}).filter((e) => e.group === g).map((e) => esc(e.name)).join(', ')}</p>`).join('')}
    </details>
  </article>`;
}

function tplItemRow(item, cat) {
  const ex = cat.find((e) => e.id === item.id);
  const timed = ex?.unit === 's';
  return `<div class="tpl-row${timed ? ' timed' : ''}">
    <label class="field grow"><span>Übung</span><select name="ex">${cat.map((e) => `<option value="${esc(e.id)}" ${e.id === item.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Sätze</span><input name="sets" type="number" min="1" max="10" inputmode="numeric" value="${esc(item.sets ?? 3)}"></label>
    <label class="field reps-only"><span>Wdh. von</span><input name="repMin" type="number" min="1" inputmode="numeric" value="${esc(item.repMin ?? 8)}"></label>
    <label class="field reps-only"><span>bis</span><input name="repMax" type="number" min="1" inputmode="numeric" value="${esc(item.repMax ?? 10)}"></label>
    <label class="field time-only"><span>Start (s)</span><input name="startSec" type="number" min="5" inputmode="numeric" value="${esc(item.startSec ?? 60)}"></label>
    <label class="field"><span>+ Schritt</span><input name="inc" type="number" min="0" step="0.25" inputmode="decimal" value="${esc(item.inc ?? defaultInc(ex))}"></label>
    <button type="button" class="icon-btn sm" data-action="tpl-row-remove" aria-label="Übung entfernen">${icon('trash', 16)}</button>
  </div>`;
}

function templatesCard(p) {
  const cat = catalog(p);
  return `<article class="card templates-card">
    <header class="card-head"><h2>🏋️ Trainingsvorlagen</h2><span class="muted small">${p.templates.length} Vorlage${p.templates.length === 1 ? '' : 'n'}</span></header>
    <p class="muted small">Beim Erfassen lädst du eine Vorlage: Die Werte vom letzten Mal sind eingetragen, und die App schlägt Steigerungen vor (doppelte Progression). Du kannst jederzeit beim Gewicht bleiben. «+ Schritt» ist kg pro Steigerung, bei Zeitübungen Sekunden.</p>
    ${p.templates.map((t) => `<form class="form tpl-form" data-id="${esc(t.id)}">
      <label class="field"><span>Name</span><input name="name" value="${esc(t.name)}" required maxlength="40"></label>
      <div class="tpl-rows">${t.items.map((i) => tplItemRow(i, cat)).join('')}</div>
      <div class="form-actions">
        <button type="button" class="btn btn-sm" data-action="tpl-row-add">${icon('plus', 14)}Übung</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="tpl-delete" data-id="${esc(t.id)}">Vorlage löschen</button>
        <button type="submit" class="btn btn-sm btn-primary">${icon('check', 14)}Speichern</button>
      </div>
    </form>`).join('')}
    <div class="form-actions">
      <button class="btn" data-action="tpl-new">${icon('plus', 16)}Neue Vorlage</button>
      ${p.templates.length ? `<button class="btn" data-action="eval-start">${icon('target', 16)}Einstufung (Testtraining)</button>` : ''}
      ${PRESET_TEMPLATES.some((pt) => !p.templates.some((t) => t.id === pt.id)) ? `<button class="btn" data-action="tpl-preset">Kraftplan für Läufer A/B übernehmen</button>` : ''}
    </div>
  </article>`;
}

function submitTemplate(form) {
  const rows = [...form.querySelectorAll('.tpl-row')];
  const n = (r, k) => (r.querySelector(`[name=${k}]`).value === '' ? undefined : Number(r.querySelector(`[name=${k}]`).value));
  const cat = catalog(profile());
  const items = rows.map((r) => {
    const id = r.querySelector('[name=ex]').value;
    const timed = cat.find((e) => e.id === id)?.unit === 's';
    const item = { id, sets: n(r, 'sets') || 3, repMin: n(r, 'repMin') || 8, repMax: Math.max(n(r, 'repMax') || 0, n(r, 'repMin') || 8), inc: n(r, 'inc') ?? 0 };
    if (timed) Object.assign(item, { repMin: 1, repMax: 1, startSec: n(r, 'startSec') || 60 });
    return item;
  });
  const name = form.elements.name.value.trim() || 'Vorlage';
  return saveProfile((p) => ({ ...p, templates: p.templates.map((t) => (t.id === form.dataset.id ? { ...t, name, items } : t)) }), `«${name}» gespeichert`);
}

async function saveProfile(mutate, message) {
  try {
    const next = await store.updateProfile((raw) => JSON.parse(JSON.stringify(mutate(normalizeProfile(raw)))));
    state.data.profile = next;
    toast(message);
    render();
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
  }
}

function submitGoals(form) {
  const fd = new FormData(form);
  const texts = fd.getAll('targetText');
  const dates = fd.getAll('targetDate');
  const goals = {
    main: fd.get('main') || '',
    secondary: fd.getAll('secondary').filter((k) => k !== fd.get('main')),
    phase: fd.get('phase') || '',
    targets: texts.map((text, i) => ({ text: text.trim(), date: dates[i] || '' })).filter((t) => t.text),
    notes: fd.get('notes').trim(),
  };
  const weekly = Object.fromEntries(WEEKLY_SPORTS.map((k) => [k, Number(fd.get(`weekly_${k}`) || 0)]).filter(([, n]) => n > 0));
  return saveProfile((p) => ({ ...p, goals, weekly }), 'Ziele gespeichert – sie fliessen in die nächste Analyse ein');
}

function submitNutrition(form) {
  const fd = new FormData(form);
  const nutrition = { enabled: fd.get('enabled') === 'on', diet: fd.get('diet'), intolerances: fd.get('intolerances').trim() };
  return saveProfile((p) => ({ ...p, nutrition }), nutrition.enabled ? 'Ernährungstipps aktiviert' : 'Ernährung gespeichert');
}

function submitExercise(form) {
  const fd = new FormData(form);
  const name = fd.get('name').trim();
  if (!name) return null;
  if (catalog(profile()).some((e) => e.name.toLowerCase() === name.toLowerCase())) { toast('Diese Übung gibt es schon.', 'error'); return null; }
  const exercise = { id: `c_${slug(name)}`, name, group: fd.get('group'), ...(fd.get('unit') ? { unit: 's' } : {}) };
  return saveProfile((p) => ({ ...p, customExercises: [...p.customExercises, exercise] }), `«${name}» hinzugefügt`);
}

function addExercise() {
  const input = $('#ex-search');
  const form = $('#act-form');
  const name = input.value.trim();
  if (!name || !form) return;
  let exercise = catalog(profile()).find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!exercise) {
    exercise = { id: `c_${slug(name)}`, name, group: 'Eigene' };
    form.dataset.newExercises = JSON.stringify([...JSON.parse(form.dataset.newExercises || '[]'), exercise]);
  }
  if ([...form.querySelectorAll('.ex-block')].some((b) => b.dataset.exId === exercise.id)) { toast('Diese Übung ist schon drin.'); return; }
  form.querySelector('.ex-list').insertAdjacentHTML('beforeend', exerciseBlock(exercise, lastSession(activities(), exercise.id, form.dataset.id)));
  input.value = '';
  form.querySelector('.ex-block:last-child [data-f=kg]')?.focus();
}

async function submitConfig(form) {
  const fd = Object.fromEntries(new FormData(form));
  const cfg = {
    owner: fd.owner.trim(), dataRepo: fd.dataRepo.trim(),
    codeRepo: fd.codeRepo.trim() || store.detectedRepo().codeRepo || fd.dataRepo.trim(), branch: fd.branch.trim() || 'main', token: fd.token.trim(),
  };
  store.saveConfig(cfg);
  try {
    const info = await store.testConnection();
    if (!info.canWrite) toast('Verbunden, aber der Token hat keine Schreibrechte auf das Daten-Repo («Contents: Read and write»).', 'error', 8000);
    else if (!info.workflows) toast(`Daten OK, aber kein Zugriff auf die Workflows in ${info.codeRepo}. Der Token braucht auch dieses Repo mit «Actions: Read and write».`, 'error', 10000);
    else toast(`Verbunden mit ${info.dataRepo}${info.private ? ' (privat)' : ''} · Workflows in ${info.codeRepo} erreichbar`);
    await reload();
  } catch (err) {
    toast(`Verbindung fehlgeschlagen: ${err.message}`, 'error', 6000);
  }
}

function submitProfile(form) {
  const fd = new FormData(form);
  const basics = { sports: fd.getAll('sports') };
  for (const k of ['name', 'position', 'level', 'injuries', 'schedule']) basics[k] = (fd.get(k) || '').trim() || undefined;
  for (const k of ['age', 'weightKg', 'maxHr', 'trainingDays']) basics[k] = fd.get(k) ? Number(fd.get(k)) : undefined;
  return saveProfile((p) => {
    const { raceGoal, ...rest } = p; // folded into goals.targets by normalizeProfile
    return { ...rest, ...basics };
  }, 'Profil gespeichert');
}

// ───────────────────────── workflows (sync / coach) ─────────────────────────
function requireLive() {
  if (store.isLive()) return true;
  toast('Im Demo-Modus nicht verfügbar – verbinde zuerst GitHub in den Einstellungen.', 'error', 5000);
  return false;
}

async function poll(check, { interval = 8000, timeout = 8 * 60000 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, interval));
    if (await check()) return true;
  }
  return false;
}

async function runWorkflow({ kind, workflow, inputs, fileKey, question, prepare }) {
  if (!requireLive()) return;
  if (state.pending) { toast('Es läuft bereits ein Vorgang – einen Moment bitte.'); return; }
  const stamp = (d) => (fileKey === 'insights' ? d.insights?.generatedAt : d.garmin?.updatedAt);
  const before = stamp(state.data);
  try {
    if (prepare) await prepare();
    await store.dispatch(workflow, inputs);
  } catch (err) {
    const repo = `${store.getConfig().owner}/${store.appRepo()}`;
    toast(err.status === 404 || err.status === 403
      ? `Workflow in ${repo} nicht erreichbar. Prüfe in den Einstellungen das App-Repo und ob der Token Zugriff auf ${repo} mit «Actions: Read and write» hat.`
      : `Start fehlgeschlagen: ${err.message}`, 'error', 10000);
    return;
  }
  const since = Date.now();
  state.pending = { kind, question };
  render();
  try {
    const done = await poll(async () => {
      const value = await store.loadFile(fileKey).catch(() => null);
      const changed = fileKey === 'insights' ? value?.generatedAt : value?.updatedAt;
      if (changed && changed !== before) return true;
      const run = await store.latestRun(workflow).catch(() => null);
      if (run && run.status === 'completed' && run.conclusion !== 'success' && new Date(run.created_at).getTime() > since - 60000) {
        throw Object.assign(new Error(`Workflow «${run.name}» ist fehlgeschlagen`), { url: run.html_url });
      }
      return false;
    });
    state.pending = null;
    await reload();
    if (done) toast(kind === 'sync' ? 'Garmin-Daten aktualisiert' : question ? 'Der Coach hat geantwortet' : 'Neue Coach-Analyse ist da');
    else toast('Das dauert länger als erwartet – schau später nochmals rein.', 'error', 6000);
    if (done && stamp(state.data) === before && kind === 'sync') toast('Keine neuen Garmin-Daten.');
  } catch (err) {
    state.pending = null;
    render();
    toast(`${err.message} – Details im Actions-Tab auf GitHub.`, 'error', 8000);
    if (err.url) console.warn('Workflow-Log:', err.url);
  }
}

const runCoach = (trigger, question = '') => runWorkflow({
  kind: 'coach', workflow: 'coach.yml', inputs: { trigger }, fileKey: 'insights', question,
  prepare: question ? () => store.saveQuestion(question) : null,
});
const runSync = () => runWorkflow({ kind: 'sync', workflow: 'garmin-sync.yml', inputs: { days: '', analyze: 'false' }, fileKey: 'garmin' });

// ───────────────────────── rendering & routing ─────────────────────────
function render(transition = false) {
  const doRender = () => {
    if (!state.data && state.route !== 'einstellungen') {
      view.innerHTML = state.error
        ? emptyState('Daten konnten nicht geladen werden', esc(state.error), '<a class="btn btn-primary" href="#/einstellungen">Einstellungen prüfen</a>')
        : '<div class="loading"><span class="spinner"></span></div>';
    } else {
      view.innerHTML = ROUTES[state.route].render();
    }
    document.title = `${ROUTES[state.route].title} · Trainingsbuch`;
    $('#topbar-title').textContent = ROUTES[state.route].title;
    document.querySelectorAll('[data-route]').forEach((el) => {
      if (el.dataset.route === state.route) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    renderStatus();
  };
  if (transition && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(doRender);
  } else {
    doRender();
  }
}

function renderStatus() {
  const el = $('#side-status');
  if (!state.data) { el.innerHTML = ''; return; }
  el.innerHTML = state.data.mode === 'demo'
    ? `<span class="dot"></span>Demo-Modus`
    : `<span class="dot live"></span>Sync ${esc(relTime(state.data.garmin?.updatedAt))}`;
}

function navigate() {
  const route = location.hash.replace(/^#\/?/, '') || 'heute';
  const changed = route !== state.route;
  if (changed && sheet.open) sheet.close();
  state.route = ROUTES[route] ? route : 'heute';
  render(changed);
  if (changed) scrollTo({ top: 0 });
}

async function reload() {
  try {
    state.data = await store.loadAll();
    state.error = null;
  } catch (err) {
    state.error = err.status === 401 ? 'Der Token ist ungültig oder abgelaufen.' : err.message;
    if (state.data) toast(`Aktualisieren fehlgeschlagen: ${state.error}`, 'error');
  }
  render();
}

function applyTheme() {
  const { theme } = store.getPrefs();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function buildNav() {
  const link = (r, cls) => `<a href="#/${r}" data-route="${r}" class="${cls}">${icon(ROUTES[r].icon, 22)}<span>${ROUTES[r].title}</span></a>`;
  $('#side-nav').innerHTML = Object.keys(ROUTES).map((r) => link(r, 'nav-link')).join('');
  $('#tabbar').innerHTML = `${link('heute', 'tab')}${link('plan', 'tab')}
    <button class="fab" data-action="add" aria-label="Training erfassen">${icon('plus', 26)}</button>
    ${link('coach', 'tab')}${link('trends', 'tab')}`;
  $('#topbar-actions').innerHTML = `<button class="icon-btn" data-action="sync" aria-label="Garmin synchronisieren">${icon('refresh')}</button>
    <a class="icon-btn" href="#/einstellungen" data-route="einstellungen" aria-label="Einstellungen">${icon('settings')}</a>`;
  $('#side-add').innerHTML = `${icon('plus', 18)}<span>Training erfassen</span>`;
}

// ───────────────────────── events ─────────────────────────
const actions = {
  add: () => openForm(),
  'open-activity': (el) => openActivity(el.dataset.id),
  'edit-activity': (el) => openForm(activities().find((a) => a.id === el.dataset.id)),
  'delete-activity': async (el) => {
    if (!confirm('Dieses Training wirklich löschen?')) return;
    try {
      await store.deleteActivity(el.dataset.id);
      sheet.close();
      toast('Training gelöscht');
      await reload();
    } catch (err) { toast(`Löschen fehlgeschlagen: ${err.message}`, 'error'); }
  },
  'close-sheet': () => { clearInterval(restTimer); sheet.close(); },
  sync: () => runSync(),
  analyze: () => runCoach('button'),
  'coach-tab': (el) => { state.coachTab = Number(el.dataset.tab); render(); },
  filter: (el) => { state.actFilter = el.dataset.type; render(); },
  'trend-range': (el) => { state.trendWeeks = Number(el.dataset.weeks); render(); },
  'ex-add': () => addExercise(),
  'ex-remove': (el) => el.closest('.ex-block').remove(),
  'set-add': (el) => {
    const block = el.closest('.ex-block');
    const rows = block.querySelectorAll('.set-row');
    const prev = rows[rows.length - 1];
    const set = prev ? { kg: prev.querySelector('[data-f=kg]').value, reps: prev.querySelector('[data-f=reps]').value } : {};
    block.querySelector('.sets').insertAdjacentHTML('beforeend', setRow(set, block.dataset.exUnit));
  },
  'set-remove': (el) => el.closest('.set-row').remove(),
  'ex-copy-last': (el) => {
    const block = el.closest('.ex-block');
    block.querySelector('.sets').innerHTML = JSON.parse(el.dataset.sets).map((s) => setRow(s, block.dataset.exUnit)).join('');
  },
  'tpl-start': (el) => openForm(null, { templateId: el.dataset.id }),
  'garmin-sets-take': async (el) => {
    const a = activities().find((x) => x.id === el.dataset.id);
    if (!a?.garminSets) return;
    const exercises = garminSetsToExercises(a.garminSets);
    const ann = state.data.manual?.annotations?.[a.id] || {};
    try {
      await store.saveAnnotation(a.id, { ...ann, exercises });
      const cat = catalog(profile());
      const unknown = exercises.filter((e) => !cat.some((c) => c.id === e.id)).map(({ sets, ...e }) => e);
      if (unknown.length) await store.updateProfile((raw) => { const p = normalizeProfile(raw); p.customExercises = [...p.customExercises, ...unknown.filter((u) => !p.customExercises.some((c) => c.id === u.id))]; return p; });
      toast(`${exercises.length} Übungen übernommen`);
      await reload();
      openActivity(a.id);
    } catch (err) { toast(`Speichern fehlgeschlagen: ${err.message}`, 'error'); }
  },
  'gym-toggle': (el) => {
    const form = el.closest('form');
    const on = !form.classList.contains('gym-on');
    store.savePrefs({ gymMode: on });
    if (on) gymStart(form); else gymStop(form);
  },
  'gym-next': (el) => { const f = el.closest('form'); clearInterval(restTimer); f.dataset.step = Number(f.dataset.step) + 1; gymRender(f); },
  'gym-prev': (el) => { const f = el.closest('form'); clearInterval(restTimer); f.dataset.step = Number(f.dataset.step) - 1; gymRender(f); },
  'gym-go': (el) => { const f = el.closest('form'); clearInterval(restTimer); f.dataset.step = el.dataset.step; gymRender(f); },
  'gym-rest': (el) => gymRest(el, Number(el.dataset.sec) || 90),
  'ci-set': (el) => {
    state.ciDraft ??= {};
    const v = Number(el.dataset.v);
    state.ciDraft[el.dataset.k] = state.ciDraft[el.dataset.k] === v ? undefined : v;
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.ciDraft[el.dataset.k])));
  },
  'ci-save': () => saveCheckin(),
  'ci-edit': () => { state.ciDraft = { ...(checkins()[todayISO()] || {}) }; render(); },
  'ci-cancel': () => { state.ciDraft = null; render(); },
  'trend-tab': (el) => { state.trendTab = el.dataset.tab; render(); },
  // limits
  'limit-new': () => openLimitForm(),
  'limit-resolve': (el) => saveManual((m) => {
    const l = (m.limits || []).find((x) => x.id === el.dataset.id);
    if (l) { l.resolved = true; l.to = l.to && l.to < todayISO() ? l.to : todayISO(); }
  }, 'Einschränkung beendet', 'Schön, dass du wieder fit bist!'),
  // plan
  'plan-view': (el) => { state.planView = el.dataset.view; render(); },
  'plan-week': (el) => {
    const step = Number(el.dataset.step);
    state.planWeek = step === 0 ? null : addDays(state.planWeek || weekStart(todayISO()), step * 7);
    state.planAdd = null; state.planMove = null; render();
  },
  'cal-month': (el) => { state.calMonth = el.dataset.month; render(); },
  'cal-day': (el) => { state.planWeek = weekStart(el.dataset.date); state.planView = 'week'; render(); },
  'plan-add': (el) => { state.planAdd = state.planAdd === el.dataset.date ? null : el.dataset.date; render(); $('.plan-add [name=title]')?.focus(); },
  'plan-add-cancel': () => { state.planAdd = null; render(); },
  'plan-move': (el) => { state.planMove = state.planMove === el.dataset.id ? null : el.dataset.id; render(); },
  'plan-move-cancel': () => { state.planMove = null; render(); },
  'plan-move-ok': (el) => {
    const it = findPlanItem(el.dataset.id);
    const date = $('#move-date')?.value;
    state.planMove = null;
    if (!it || !date || date === it.date) { render(); return; }
    planPatch(it, { date, movedFrom: it.movedFrom || it.date }, `Plan: ${it.title || it.sport} → ${date}`, `Verschoben auf ${fmtDate(date)}`);
  },
  'plan-remove': (el) => {
    const it = findPlanItem(el.dataset.id);
    if (!it) return;
    if (it.src === 'fix' && !confirm('Nur diesen einen Termin streichen? (Der feste Termin bleibt für die anderen Wochen.)')) return;
    planPatch(it, { removed: true }, `Plan: ${it.title || it.sport} entfernt`, 'Aus dem Plan entfernt');
  },
  'plan-done': (el) => {
    const it = findPlanItem(el.dataset.id);
    if (!it) return;
    if (!it.done && planDone(it, activities())) { toast('Schon erledigt – dazu gibt es ein erfasstes Training.'); return; }
    planPatch(it, { done: !it.done || undefined }, `Plan: ${it.title || it.sport} ${it.done ? 'offen' : 'erledigt'}`);
  },
  'plan-take': (el) => {
    const x = analysis()?.plan?.[Number(el.dataset.i)];
    if (!x) return;
    saveManual((m) => { m.plan = [...(m.plan || []), { id: newId('p'), date: x.date, sport: x.type, title: x.title, note: x.details || undefined, durationMin: x.durationMin || undefined, src: 'own', fromCoach: true }]; }, `Plan: Coach-Vorschlag ${x.title}`, 'In den Plan übernommen');
  },
  'plan-take-all': () => {
    const own = manualData().plan || [];
    const list = (analysis()?.plan || []).filter((x) => x.type !== 'rest' && x.date >= todayISO() && !own.some((o) => o.date === x.date && o.sport === x.type && o.title === x.title));
    saveManual((m) => { m.plan = [...(m.plan || []), ...list.map((x) => ({ id: newId('p'), date: x.date, sport: x.type, title: x.title, note: x.details || undefined, durationMin: x.durationMin || undefined, src: 'own', fromCoach: true }))]; }, 'Plan: Coach-Vorschläge übernommen', `${list.length} Einheiten übernommen`);
  },
  'rec-remove': (el) => {
    const r = (profile().recurring || []).find((x) => x.id === el.dataset.id);
    if (!r || !confirm(`Festen Termin «${r.title || r.sport}» entfernen?`)) return;
    saveProfile((p) => ({ ...p, recurring: (p.recurring || []).filter((x) => x.id !== r.id) }), 'Fester Termin entfernt');
  },
  'ics-plan': () => exportPlanIcs(),
  'swim-log': (el) => openForm(null, { type: 'swim', swimId: el.dataset.swim, date: el.dataset.date }),
  // stretching
  'stretch-item': (el) => setStretch(todayISO(), (log) => {
    const i = log.done.indexOf(el.dataset.id);
    if (i >= 0) log.done.splice(i, 1); else log.done.push(el.dataset.id);
  }),
  'stretch-day': (el) => setStretch(el.dataset.date, (log) => {
    log.complete = !log.complete;
    log.done = log.complete ? stretchItems().map((i) => i.id) : [];
  }),
  'stretch-timer': (el) => startStretchTimer(el.dataset.id),
  'st-row-add': (el) => el.closest('form').querySelector('.st-rows').insertAdjacentHTML('beforeend', stretchRow({ sec: 30 })),
  'st-row-remove': (el) => el.closest('.st-row').remove(),
  'st-suggest': (el) => { el.closest('form').querySelector('.st-rows').innerHTML = STRETCH_SUGGESTION.map(stretchRow).join(''); toast('Vorschlag geladen – anpassen und speichern'); },
  // race
  'race-clear': () => { if (confirm('Wettkampf entfernen?')) saveProfile((p) => { const { race, ...rest } = p; return rest; }, 'Wettkampf entfernt'); },
  // evaluation & drafts
  'eval-start': () => openEval(),
  'draft-resume': () => resumeDraft(),
  'draft-discard': () => { if (confirm('Angefangenes Training verwerfen?')) { store.localSet('draft', null); render(); } },
  'review-run': () => runCoach('monthly'),
  'tpl-load': (el) => loadTemplate(el.closest('form'), el.dataset.id),
  'ex-decide': (el) => {
    const block = el.closest('.ex-block');
    const form = el.closest('form');
    const plan = JSON.parse(block.dataset.plan);
    const decision = el.dataset.dec === 'keep' ? '' : el.dataset.dec;
    block.dataset.decision = decision;
    const hist = exerciseHistory(activities(), block.dataset.exId, form?.dataset.id);
    const sets = prefillSets(plan.target, { unit: block.dataset.exUnit }, hist, plan.sugg, decision || null);
    block.querySelector('.sets').innerHTML = sets.map((x) => setRow(x, block.dataset.exUnit)).join('');
    block.querySelector('.sugg').outerHTML = suggBox({ ...plan, decision }, block.dataset.exUnit);
  },
  'tpl-new': () => saveProfile((p) => ({ ...p, templates: [...p.templates, { id: `tpl_${Date.now().toString(36)}`, name: `Training ${String.fromCharCode(65 + p.templates.length)}`, items: [] }] }), 'Neue Vorlage angelegt'),
  'tpl-preset': () => saveProfile((p) => ({
    ...p,
    sports: p.sports?.length && !p.sports.includes('strength') ? [...p.sports, 'strength'] : p.sports,
    customExercises: [...p.customExercises, ...PRESET_EXERCISES.filter((e) => !p.customExercises.some((c) => c.id === e.id))],
    templates: [...p.templates, ...PRESET_TEMPLATES.filter((t) => !p.templates.some((x) => x.id === t.id))],
  }), 'Kraftplan A/B übernommen'),
  'tpl-delete': (el) => {
    const t = profile().templates.find((x) => x.id === el.dataset.id);
    if (!t || !confirm(`Vorlage «${t.name}» löschen? Erfasste Trainings bleiben erhalten.`)) return;
    saveProfile((p) => ({ ...p, templates: p.templates.filter((x) => x.id !== t.id) }), `«${t.name}» gelöscht`);
  },
  'tpl-row-add': (el) => el.closest('form').querySelector('.tpl-rows').insertAdjacentHTML('beforeend', tplItemRow({ id: catalog(profile())[0].id }, catalog(profile()))),
  'tpl-row-remove': (el) => el.closest('.tpl-row').remove(),
  'add-target': () => $('#goals-form .targets').insertAdjacentHTML('beforeend', targetRow()),
  'remove-target': (el) => el.closest('.target-row').remove(),
  'remove-exercise': (el) => {
    const ex = profile().customExercises.find((e) => e.id === el.dataset.id);
    if (!ex || !confirm(`«${ex.name}» aus deiner Liste entfernen? Bereits erfasste Trainings bleiben erhalten.`)) return;
    saveProfile((p) => ({ ...p, customExercises: p.customExercises.filter((e) => e.id !== ex.id) }), `«${ex.name}» entfernt`);
  },
  theme: (el) => { store.savePrefs({ theme: el.dataset.theme }); applyTheme(); render(); },
  'copy-link': async () => {
    try { await navigator.clipboard.writeText(store.setupLink()); toast('Setup-Link kopiert – nur an dich selbst senden!'); }
    catch { prompt('Link kopieren:', store.setupLink()); }
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state.data, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `trainingsbuch-${todayISO()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'reset-demo': async () => { store.resetDemo(); await reload(); toast('Demo-Daten zurückgesetzt'); },
  disconnect: async () => {
    if (!confirm('Verbindung auf diesem Gerät trennen? Deine Daten im Repo bleiben erhalten.')) return;
    store.disconnect();
    await reload();
  },
};

const forms = {
  'act-form': submitActivity,
  'cfg-form': submitConfig,
  'profile-form': submitProfile,
  'goals-form': submitGoals,
  'nutrition-form': submitNutrition,
  'exercise-form': submitExercise,
  'limit-form': submitLimit,
  'eval-form': submitEval,
  'race-form': (form) => {
    const fd = new FormData(form);
    const race = JSON.parse(JSON.stringify({ name: fd.get('name').trim() || undefined, date: fd.get('date') || undefined, distanceKm: Number(fd.get('distanceKm')) || HM_KM, goalSec: parseClock(fd.get('goal')) || undefined }));
    return saveProfile((p) => ({ ...p, race }), 'Wettkampf gespeichert');
  },
  'stretch-form': submitStretch,
  'reminder-form': submitReminders,
  'rec-form': (form) => {
    const fd = new FormData(form);
    const r = JSON.parse(JSON.stringify({ id: newId('r'), weekday: Number(fd.get('weekday')), sport: fd.get('sport'), title: fd.get('title').trim() || SPORTS[fd.get('sport')]?.label, templateId: fd.get('templateId') || undefined }));
    return saveProfile((p) => ({ ...p, recurring: [...(p.recurring || []), r] }), `Fester Termin: ${r.title} jeden ${WEEKDAYS_LONG[r.weekday]}`);
  },
  'ask-form': (form) => {
    const q = new FormData(form).get('q').trim();
    if (q) runCoach('question', q);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  const actForm = e.target.closest?.('#act-form');
  if (actForm && el) saveDraftSoon(actForm);
});
document.addEventListener('submit', (e) => {
  if (forms[e.target.id]) { e.preventDefault(); forms[e.target.id](e.target); }
  else if (e.target.classList?.contains('tpl-form')) { e.preventDefault(); submitTemplate(e.target); }
  else if (e.target.classList?.contains('plan-add')) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const entry = JSON.parse(JSON.stringify({ id: newId('p'), date: e.target.dataset.date, sport: fd.get('sport'), title: fd.get('title').trim() || SPORTS[fd.get('sport')]?.label, templateId: fd.get('templateId') || undefined, src: 'own' }));
    state.planAdd = null;
    saveManual((m) => { m.plan = [...(m.plan || []), entry]; }, `Plan: ${entry.title} (${entry.date})`, 'Eingetragen');
  }
});
document.addEventListener('input', (e) => {
  if (e.target.getAttribute?.('aria-invalid')) e.target.removeAttribute('aria-invalid');
  if (e.target.id === 'act-search') {
    state.actQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = $('#act-search');
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  const actForm = e.target.closest?.('#act-form');
  if (actForm) {
    saveDraftSoon(actForm);
    if (['durationMin', 'distanceKm'].includes(e.target.name)) updatePaceHint(actForm);
  }
  const evalRow = e.target.closest?.('.eval-row');
  if (evalRow) {
    const kg = evalRowResult(evalRow);
    evalRow.querySelector('.eval-out').innerHTML = kg ? `Start <strong>${fmtNum(kg, 1)} kg</strong>` : '–';
  }
  if (e.target.name === 'rpe') {
    const v = Number(e.target.value);
    $('#rpe-out').textContent = v ? `${v} · ${RPE_LABELS[v]}` : 'nicht bewertet';
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.pref) store.savePrefs({ [e.target.dataset.pref]: e.target.checked });
  if (e.target.id === 'trend-ex') { state.trendExercise = e.target.value; render(); }
  if (e.target.id === 'review-month') { state.reviewMonth = e.target.value; render(); }
  if (e.target.dataset.swimFor) {
    const it = findPlanItem(e.target.dataset.swimFor);
    if (it) planPatch(it, { swimId: e.target.value }, 'Plan: Schwimmprogramm', `Programm: ${swimById(e.target.value)?.name}`);
  }
  const actForm = e.target.closest?.('#act-form');
  if (actForm) {
    saveDraftSoon(actForm);
    if (e.target.name === 'type') updatePaceHint(actForm);
    if (e.target.name === 'swimId' && e.target.value && !actForm.elements.distanceKm.value) actForm.elements.distanceKm.value = swimById(e.target.value).m / 1000;
  }
  if (e.target.name === 'kind' && e.target.closest('#limit-form')) e.target.closest('form').classList.toggle('is-ill', e.target.value === 'ill');
  if (e.target.name === 'ex' && e.target.closest('.tpl-row')) {
    const row = e.target.closest('.tpl-row');
    const ex = catalog(profile()).find((x) => x.id === e.target.value);
    row.classList.toggle('timed', ex?.unit === 's');
    row.querySelector('[name=inc]').value = defaultInc(ex);
  }
  // picking a suggestion from the exercise list adds it right away
  if (e.target.id === 'ex-search' && catalog(profile()).some((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase())) addExercise();
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'ex-search' && e.key === 'Enter') { e.preventDefault(); addExercise(); }
});
// close the sheet when tapping the backdrop
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
sheet.addEventListener('close', () => {
  clearInterval(restTimer);
  // flush a pending draft save and show the "unfinished session" banner
  const form = sheet.querySelector('#act-form');
  if (form && draftTimer) { clearTimeout(draftTimer); draftTimer = null; saveDraftSoon(form); }
  setTimeout(() => { if (state.route === 'heute' && state.data) render(); }, 700);
});

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60000 && !state.pending) reload();
});

// ───────────────────────── boot ─────────────────────────
async function init() {
  applyTheme();
  buildNav();
  initTooltip();
  if (store.importSetupFromHash()) toast('Gerät verbunden');
  if (store.isLive()) state.data = store.cached();
  window.addEventListener('hashchange', navigate);
  navigate();
  await reload();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
