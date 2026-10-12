import {
  SPORTS, FEELINGS, RPE_LABELS, sport, sportColor, esc, md, icon, toast, initTooltip,
  todayISO, addDays, parseDay, daysBetween, weekStart, isoWeek, fmtDate, weekdayShort, relDay, relTime,
  fmtNum, fmtDur, fmtPace, fmtClock, avg,
} from './util.js';
import * as store from './store.js';
import { bars, line, sparkline, ring, hbars, legend } from './charts.js';
import {
  MUSCLE_GROUPS, FOCUS, PHASES, DIETS, catalog, normalizeProfile, bestE1rm, volume, fmtSets,
  lastSession, setRow, exerciseBlock, readExercises, slug,
  exerciseHistory, suggestNext, prefillSets, suggBox, defaultInc, nextTemplate, warmupSets, WARMUP,
  PRESET_TEMPLATES, PRESET_EXERCISES, targetText,
} from './training.js';

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
  pending: null, // { kind: 'coach' | 'sync', question?, since }
};

const ROUTES = {
  heute: { title: 'Heute', icon: 'home', render: renderToday },
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
  { key: 'sleepH', label: 'Schlaf', icon: 'moon', unit: 'h', digits: 1, better: 'higher' },
  { key: 'bodyBatteryHigh', label: 'Body Battery', icon: 'battery', unit: '', better: 'higher' },
  { key: 'stress', label: 'Stress', icon: 'gauge', unit: '', better: 'lower' },
  { key: 'steps', label: 'Schritte', icon: 'steps', unit: '', better: 'higher' },
];

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
    trend = `<span class="trend ${good ? 'good' : 'bad'}">${delta > 0 ? '↑' : '↓'} ${fmtNum(Math.abs(delta), k.digits || 0)} vs. Ø 7 T.</span>`;
  } else if (delta != null) {
    trend = '<span class="trend">→ wie Ø 7 T.</span>';
  }
  const when = latest.date === todayISO() ? '' : `<span class="kpi-when">${esc(relDay(latest.date))}</span>`;
  return `<article class="kpi">
    <header>${icon(k.icon, 16)}<span>${k.label}</span>${when}</header>
    <div class="kpi-value">${fmtNum(latest[k.key], k.digits || 0)}<small>${k.unit}</small></div>
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
    ${demoBanner()}${pendingBanner()}
    <section class="grid hero">${readiness}${brief}</section>
    <section class="kpis">${KPIS.map((k) => kpiTile(k, days)).join('')}${vo2}</section>
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

function strengthCard(acts) {
  const p = profile();
  if (!p.templates.length || (p.sports?.length && !p.sports.includes('strength'))) return '';
  const next = nextTemplate(p.templates, acts);
  return `<article class="card strength-next">
    <div><p class="eyebrow">Krafttraining</p><h2>Als Nächstes: ${esc(next.name)}</h2>
    <p class="muted small">${esc(next.items.map((i) => catalog(p).find((e) => e.id === i.id)?.name || i.id).join(' · '))}</p></div>
    <div class="ex-actions">
      <button class="btn btn-primary" data-action="tpl-start" data-id="${esc(next.id)}">${icon('plus', 16)}${esc(next.name)} starten</button>
      ${p.templates.filter((t) => t.id !== next.id).map((t) => `<button class="btn" data-action="tpl-start" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
    </div>
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
    ['Höhenmeter', a.elevationGain && `${a.elevationGain} m`],
    ['Kadenz', a.cadence && `${a.cadence} spm`],
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

function openForm(existing, opts = {}) {
  const mode = !existing ? 'new' : existing.source === 'garmin' ? 'garmin' : 'edit';
  const prof0 = profile();
  const defType = opts.templateId ? 'strength' : !prof0.sports?.length || prof0.sports.includes('football') ? 'football' : prof0.sports[0];
  const a = existing || { type: defType, date: todayISO(), football: { kind: 'training' } };
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
    <div class="row no-garmin">
      <label class="field"><span>Dauer (min)</span><input type="number" name="durationMin" inputmode="numeric" min="1" max="600" value="${esc(a.durationMin ?? '')}" required placeholder="60"></label>
      <label class="field distance-field"><span>Distanz (km)</span><input type="number" name="distanceKm" inputmode="decimal" step="0.01" min="0" value="${esc(a.distanceKm ?? '')}" placeholder="optional"></label>
      <label class="field"><span>Ø Puls</span><input type="number" name="avgHr" inputmode="numeric" min="40" max="230" value="${esc(a.avgHr ?? '')}" placeholder="optional"></label>
    </div>

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

    <label class="field">
      <span>Anstrengung (RPE) <output id="rpe-out">${a.rpe ? `${a.rpe} · ${RPE_LABELS[a.rpe]}` : 'nicht bewertet'}</output></span>
      <input type="range" name="rpe" min="0" max="10" step="1" value="${a.rpe || 0}" class="rpe">
    </label>

    <fieldset class="feelings">
      <legend>Wie hat es sich angefühlt?</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="feeling" value="${n}" ${a.feeling === n ? 'checked' : ''}><span aria-label="${n} von 5">${FEELINGS[n]}</span></label>`).join('')}
    </fieldset>

    <label class="field"><span>Notizen</span><textarea name="notes" rows="2" placeholder="Wie lief es? Schmerzen, Besonderheiten, Wetter …">${esc(a.notes || '')}</textarea></label>

    <footer class="sheet-actions">
      <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      <button type="submit" class="btn btn-primary">${icon('check', 16)}Speichern</button>
    </footer>
  </form>`);
  if (opts.templateId) loadTemplate($('#act-form'), opts.templateId);
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
  form.querySelector('.ex-list').innerHTML = t.items.map((item) => {
    const ex = cat.find((e) => e.id === item.id) || { id: item.id, name: item.id, group: 'Eigene' };
    const target = { ...item, inc: item.inc ?? defaultInc(ex) };
    const hist = exerciseHistory(all, ex.id, form.dataset.id);
    const sugg = suggestNext(target, ex, hist, null);
    const decision = sugg.type === 'up' || sugg.type === 'time' ? 'up' : '';
    const sets = prefillSets(target, ex, hist, sugg, decision);
    let html = exerciseBlock({ ...ex, sets }, hist[0], { target, sugg, decision });
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
  const newExercises = JSON.parse(form.dataset.newExercises || '[]').filter((n) => exercises.some((e) => e.id === n.id));

  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (mode === 'garmin') {
      await store.saveAnnotation(form.dataset.id, JSON.parse(JSON.stringify(common)));
    } else {
      const missing = [['date', 'Datum'], ['durationMin', 'Dauer']].filter(([k]) => !fd.get(k) || (k === 'durationMin' && !num(k)));
      if (missing.length) {
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
    </section>
    ${ask}`;
}

// ───────────────────────── page: trends ─────────────────────────
function renderTrends() {
  const weeks = state.trendWeeks;
  const today = todayISO();
  const from = addDays(weekStart(today), -(weeks - 1) * 7);
  const acts = activities().filter((a) => a.date >= from);
  const days = daily().filter((d) => d.date >= from);

  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(from, i * 7));
  const weekLabel = (wk) => `KW${isoWeek(wk)}`;
  const volumeCols = weekStarts.map((wk) => {
    const wa = acts.filter((a) => a.date >= wk && a.date < addDays(wk, 7));
    const per = minutesBySport(wa);
    return {
      label: weekLabel(wk),
      tip: `<b>KW ${isoWeek(wk)}</b> (${esc(fmtDate(wk, { day: 'numeric', month: 'short' }))})<br>${Object.entries(per).map(([t, m]) => `${esc(SPORT_LABELS[t])}: ${fmtDur(m)}`).join('<br>') || 'Kein Training'}`,
      segments: Object.entries(per).map(([type, value]) => ({ type, value: Math.round((value / 60) * 10) / 10 })),
    };
  });
  const kmCols = weekStarts.map((wk) => {
    const km = acts.filter((a) => a.type === 'run' && a.date >= wk && a.date < addDays(wk, 7)).reduce((s, a) => s + (a.distanceKm || 0), 0);
    return { label: weekLabel(wk), tip: `<b>KW ${isoWeek(wk)}</b><br>${fmtNum(km, 1)} km`, segments: [{ type: 'run', value: Math.round(km * 10) / 10 }] };
  });

  const ms = (iso) => parseDay(iso).getTime();
  const xLabels = (dates) => {
    if (dates.length < 2) return [];
    const n = Math.min(5, dates.length);
    return Array.from({ length: n }, (_, i) => dates[Math.round((i * (dates.length - 1)) / (n - 1))])
      .map((d) => ({ x: ms(d), label: fmtDate(d, { day: 'numeric', month: 'short' }) }));
  };

  const runs = acts.filter((a) => a.type === 'run' && a.paceSecPerKm && (a.distanceKm || 0) >= 2).reverse();
  // rolling average over the last 5 runs – single runs zig-zag between easy and tempo days
  const paceChart = line(runs.map((r, i) => {
    const rolling = avg(runs.slice(Math.max(0, i - 4), i + 1).map((x) => x.paceSecPerKm));
    return {
      x: ms(r.date), y: rolling,
      tip: `<b>${esc(actTitle(r))}</b><br>${esc(fmtDate(r.date))}<br>${fmtPace(r.paceSecPerKm)} /km · ${fmtNum(r.distanceKm, 1)} km${r.avgHr ? ` · ${r.avgHr} bpm` : ''}<br>Ø letzte 5 Läufe: ${fmtPace(rolling)} /km`,
    };
  }), { invert: true, yFormat: fmtPace, steps: [10, 15, 30, 60, 120], color: 'var(--s-run)', xLabels: xLabels(runs.map((r) => r.date)), area: false });

  const metricLine = (key, label, unit, digits = 0) => {
    const pts = days.filter((d) => typeof d[key] === 'number');
    return line(pts.map((d) => ({ x: ms(d.date), y: d[key], tip: `<b>${esc(fmtDate(d.date))}</b><br>${label}: ${fmtNum(d[key], digits)} ${unit}` })),
      { color: 'var(--series-1)', xLabels: xLabels(pts.map((d) => d.date)) });
  };

  const sleepDays = days.slice(-Math.min(days.length, weeks <= 4 ? 28 : 42)).filter((d) => d.sleepH);
  const sleepCols = sleepDays.map((d) => ({
    label: fmtDate(d.date, { day: 'numeric', month: 'numeric' }),
    tip: `<b>${esc(fmtDate(d.date))}</b><br>${fmtNum(d.sleepH, 1)} h Schlaf${d.sleepScore ? `<br>Score ${d.sleepScore}` : ''}${d.deepH ? `<br>Tief ${fmtNum(d.deepH, 1)} h · REM ${fmtNum(d.remH, 1)} h` : ''}`,
    segments: [{ type: 'sleep', value: d.sleepH, color: 'var(--series-1)' }],
  }));

  const per = minutesBySport(acts);
  const dist = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([t, m]) => ({
    label: `${sport(t).emoji} ${SPORT_LABELS[t]}`, value: m, display: fmtDur(m), color: sportColor(t),
  }));

  const snap = snapshot();
  const races = snap.racePredictions;
  const types = sportsIn(acts);

  return `
    ${pageHead('Trends', 'Entwicklung über die Zeit', `<div class="segmented" role="group" aria-label="Zeitraum">${[4, 12, 26, 52].map((w) => `<button data-action="trend-range" data-weeks="${w}" aria-pressed="${weeks === w}">${w === 52 ? '1 J' : `${w} W`}</button>`).join('')}</div>`)}
    ${demoBanner()}
    <section class="grid two">
      <article class="card wide">
        <header class="card-head"><h2>Trainingsumfang pro Woche</h2><span class="muted small">Stunden nach Sportart</span></header>
        ${bars(volumeCols, { unit: 'h' })}
        ${types.length ? legend(types, SPORT_LABELS) : ''}
      </article>
      <article class="card">
        <header class="card-head"><h2>Lauf-Pace</h2><span class="muted small">Ø 5 Läufe · höher = schneller</span></header>
        ${paceChart}
      </article>
      <article class="card">
        <header class="card-head"><h2>Laufkilometer pro Woche</h2></header>
        ${bars(kmCols, { unit: 'km' })}
      </article>
      <article class="card">
        <header class="card-head"><h2>HRV (Nacht)</h2><span class="muted small">ms</span></header>
        ${metricLine('hrv', 'HRV', 'ms')}
      </article>
      <article class="card">
        <header class="card-head"><h2>Ruhepuls</h2><span class="muted small">bpm</span></header>
        ${metricLine('restingHr', 'Ruhepuls', 'bpm')}
      </article>
      <article class="card">
        <header class="card-head"><h2>Schlaf</h2><span class="muted small">Stunden pro Nacht</span></header>
        ${sleepCols.length ? bars(sleepCols, { unit: 'h', height: 150 }) : '<p class="empty-chart">Keine Schlafdaten.</p>'}
      </article>
      <article class="card">
        <header class="card-head"><h2>Verteilung</h2><span class="muted small">Trainingszeit im Zeitraum</span></header>
        ${dist.length ? hbars(dist) : '<p class="muted">Keine Aktivitäten im Zeitraum.</p>'}
      </article>
      ${strengthTrends(acts, ms, xLabels)}
      ${races || snap.lactateThreshold || snap.vo2max ? `<article class="card">
        <header class="card-head"><h2>Leistungswerte</h2><span class="muted small">Garmin</span></header>
        <dl class="stat-grid">
          ${snap.vo2max ? `<div><dt>VO₂max</dt><dd>${fmtNum(snap.vo2max, 1)}</dd></div>` : ''}
          ${snap.lactateThreshold?.heartRate ? `<div><dt>Laktatschwelle</dt><dd>${snap.lactateThreshold.heartRate} bpm${snap.lactateThreshold.paceSecPerKm ? ` · ${fmtPace(snap.lactateThreshold.paceSecPerKm)}/km` : ''}</dd></div>` : ''}
          ${races ? [['5 km', races['5k']], ['10 km', races['10k']], ['Halbmarathon', races.half], ['Marathon', races.marathon]].filter(([, v]) => v).map(([k, v]) => `<div><dt>Prognose ${k}</dt><dd>${fmtClock(v)}</dd></div>`).join('') : ''}
        </dl>
      </article>` : ''}
    </section>`;
}

function strengthTrends(acts, ms, xLabels) {
  const sessions = acts.filter((a) => a.exercises?.length).reverse(); // oldest first
  if (!sessions.length) return '';
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
  const weighted = points.length && sessions.some((a) => a.exercises.some((e) => e.id === state.trendExercise && bestE1rm(e)));
  const unit = weighted ? 'kg' : current.unit === 's' ? 's' : 'Wdh.';

  const perGroup = {};
  for (const a of sessions) for (const e of a.exercises) perGroup[e.group || 'Eigene'] = (perGroup[e.group || 'Eigene'] || 0) + e.sets.length;
  const groups = Object.entries(perGroup).sort((x, y) => y[1] - x[1])
    .map(([g, n]) => ({ label: g, value: n, display: `${n} ${n === 1 ? 'Satz' : 'Sätze'}`, color: 'var(--s-strength)' }));

  return `<article class="card">
      <header class="card-head"><h2>Kraft-Fortschritt</h2>
        <select id="trend-ex" class="mini-select" aria-label="Übung wählen">${options.map(([id, o]) => `<option value="${esc(id)}" ${id === state.trendExercise ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </header>
      ${line(points, { color: 'var(--s-strength)', yFormat: (v) => `${fmtNum(v)}`, xLabels: xLabels(points.map((p) => p.date)) })}
      <p class="muted small" style="margin-top:8px">${weighted ? 'Geschätztes Maximalgewicht (1RM, Epley-Formel) pro Training in kg' : `Beste Leistung pro Training in ${unit}`}</p>
    </article>
    <article class="card">
      <header class="card-head"><h2>Sätze pro Muskelgruppe</h2><span class="muted small">im Zeitraum</span></header>
      ${hbars(groups)}
    </article>`;
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
  return saveProfile((p) => ({ ...p, goals }), 'Ziele gespeichert – sie fliessen in die nächste Analyse ein');
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
  $('#tabbar').innerHTML = `${link('heute', 'tab')}${link('aktivitaeten', 'tab')}
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
  'close-sheet': () => sheet.close(),
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
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `healthy-football-${todayISO()}.json` });
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
  'ask-form': (form) => {
    const q = new FormData(form).get('q').trim();
    if (q) runCoach('question', q);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});
document.addEventListener('submit', (e) => {
  if (forms[e.target.id]) { e.preventDefault(); forms[e.target.id](e.target); }
  else if (e.target.classList?.contains('tpl-form')) { e.preventDefault(); submitTemplate(e.target); }
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
  if (e.target.name === 'rpe') {
    const v = Number(e.target.value);
    $('#rpe-out').textContent = v ? `${v} · ${RPE_LABELS[v]}` : 'nicht bewertet';
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.pref) store.savePrefs({ [e.target.dataset.pref]: e.target.checked });
  if (e.target.id === 'trend-ex') { state.trendExercise = e.target.value; render(); }
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
