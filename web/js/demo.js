// Realistic sample data so the app is explorable before GitHub/Garmin are connected.
import { todayISO, addDays, parseDay } from './util.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function demoData() {
  const rand = rng(42);
  const jitter = (base, spread) => base + (rand() - 0.5) * 2 * spread;
  const today = todayISO();
  const garminActs = [];
  const manualActs = [];
  const daily = [];

  for (let back = 83; back >= 0; back--) {
    const date = addDays(today, -back);
    const dow = (parseDay(date).getDay() + 6) % 7; // 0 = Monday
    const progress = (83 - back) / 83; // fitness improves over time

    if ([0, 3, 6].includes(dow) && back > 0) {
      const kind = dow === 0 ? 'easy' : dow === 3 ? 'tempo' : 'long';
      const km = kind === 'long' ? jitter(12 + progress * 4, 1.5) : kind === 'tempo' ? jitter(8, 1) : jitter(6.5, 1);
      const pace = (kind === 'tempo' ? 285 : kind === 'long' ? 330 : 345) - progress * 15 + jitter(0, 8);
      const dur = (km * pace) / 60;
      const hr = kind === 'tempo' ? jitter(166, 4) : jitter(146, 5);
      garminActs.push({
        id: `gdemo${back}`, source: 'garmin', type: 'run', garminType: 'running',
        title: kind === 'tempo' ? 'Tempolauf' : kind === 'long' ? 'Langer Lauf' : 'Lockerer Lauf',
        date, start: `${date}T${kind === 'long' ? '09:30' : '18:15'}:00`,
        durationMin: Math.round(dur * 10) / 10, distanceKm: Math.round(km * 100) / 100,
        paceSecPerKm: Math.round(pace), avgHr: Math.round(hr), maxHr: Math.round(hr + 14),
        calories: Math.round(km * 68), elevationGain: Math.round(jitter(60, 30)),
        trainingLoad: Math.round(dur * (kind === 'tempo' ? 2.4 : 1.5)),
        aerobicTE: Math.round(jitter(kind === 'tempo' ? 3.6 : 2.8, 0.3) * 10) / 10,
        anaerobicTE: Math.round(jitter(kind === 'tempo' ? 1.8 : 0.4, 0.3) * 10) / 10,
        cadence: Math.round(jitter(172, 3)),
        hrZonesMin: kind === 'tempo' ? [4, 8, 10, 18, 3].map((m) => Math.round(m * dur / 43)) : [6, 22, 10, 2, 0].map((m) => Math.round(m * dur / 40)),
      });
    }
    if ([1, 3].includes(dow) && back > 0) {
      manualActs.push({
        id: `mdemo${back}`, source: 'manual', type: 'football', title: 'Mannschaftstraining',
        date, start: `${date}T19:30:00`, durationMin: 90, avgHr: Math.round(jitter(148, 5)),
        rpe: Math.round(jitter(6, 1)), feeling: Math.round(jitter(4, 1)),
        football: { kind: 'training' }, notes: dow === 1 ? 'Viel Spielform, Pressing' : 'Technik + Abschluss',
      });
    }
    if (dow === 5 && back > 0) {
      const opponents = ['FC Seefeld', 'SC Wipkingen', 'FC Unterstrass', 'SV Höngg', 'FC Oerlikon', 'Blue Stars'];
      manualActs.push({
        id: `mdemo${back}`, source: 'manual', type: 'football', title: `Match vs. ${opponents[back % opponents.length]}`,
        date, start: `${date}T15:00:00`, durationMin: Math.round(jitter(80, 10)), avgHr: Math.round(jitter(158, 4)),
        rpe: Math.round(jitter(8, 1)), feeling: Math.round(jitter(4, 1)),
        football: { kind: 'match', opponent: opponents[back % opponents.length], result: `${Math.floor(rand() * 4)}:${Math.floor(rand() * 3)}`, minutesPlayed: 80, goals: rand() > 0.75 ? 1 : 0, assists: rand() > 0.7 ? 1 : 0 },
        notes: '',
      });
    }
    if (dow === 2 && back > 0) {
      garminActs.push({
        id: `gdemos${back}`, source: 'garmin', type: 'strength', garminType: 'strength_training',
        title: 'Krafttraining Beine & Core', date, start: `${date}T07:00:00`, durationMin: Math.round(jitter(50, 8)),
        avgHr: Math.round(jitter(118, 6)), calories: Math.round(jitter(320, 40)), trainingLoad: Math.round(jitter(45, 10)),
      });
    }

    const load = back % 7 === 1 ? 1 : 0;
    daily.push({
      date,
      restingHr: Math.round(jitter(51 - progress * 2 + load * 2, 1.5)),
      hrv: Math.round(jitter(60 + progress * 5 - load * 6, 5)),
      hrvStatus: 'BALANCED',
      sleepH: Math.round(jitter(7.3, 0.7) * 100) / 100,
      sleepScore: Math.round(jitter(78, 9)),
      deepH: Math.round(jitter(1.5, 0.3) * 100) / 100,
      remH: Math.round(jitter(1.8, 0.3) * 100) / 100,
      bodyBatteryHigh: Math.round(jitter(82, 10)),
      bodyBatteryLow: Math.round(jitter(22, 8)),
      bodyBattery: Math.round(jitter(65, 15)),
      stress: Math.round(jitter(28, 8)),
      steps: Math.round(jitter(9800, 2500)),
    });
  }

  // one template per weekday (0 = Monday), matching the demo training rhythm
  const week = [
    ['run', 'Lockerer Regenerationslauf', 40, 'locker', '40′ sehr locker @ 5:50–6:10/km, Puls unter 145. Danach 10′ Mobility.'],
    ['football', 'Mannschaftstraining', 90, 'mittel', 'Fester Termin. Im Aufwärmen 4 Steigerungsläufe über 60 m.'],
    ['run', 'Intervalle 6×800 m', 55, 'hart', '15′ einlaufen, 6×800 m @ 4:05/km mit 2′ Trabpause, 10′ auslaufen.'],
    ['football', 'Mannschaftstraining', 90, 'mittel', 'Fester Termin. Nach dem Training 3×5 Nordic Hamstring Curls.'],
    ['rest', 'Ruhetag vor dem Match', 0, 'Ruhe', 'Spaziergang, genug trinken, kohlenhydratreich essen, früh schlafen.'],
    ['football', 'Match', 90, 'hart', 'Dynamisches Aufwärmen 20′. Nach dem Spiel 10′ auslaufen.'],
    ['mobility', 'Mobility & langer Spaziergang', 45, 'locker', '15′ Hüft- und Sprunggelenk-Mobility, 3×10 Glute Bridges, 3×30" Copenhagen Plank je Seite, danach 30′ Spaziergang.'],
  ];
  const plan = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const [type, title, durationMin, intensity, details] = week[(parseDay(date).getDay() + 6) % 7];
    return { date, type, title, durationMin, intensity, details };
  });

  return {
    garmin: {
      updatedAt: new Date(Date.now() - 42 * 60000).toISOString(),
      activities: garminActs.reverse(),
      daily,
      snapshot: {
        readiness: { score: 74, level: 'HIGH', feedback: 'Gut erholt', recoveryTimeH: 6 },
        trainingStatus: { phrase: 'PRODUCTIVE', acuteLoad: 612, chronicLoad: 540, acwr: 1.13 },
        vo2max: 54.6, fitnessAge: 24,
        racePredictions: { '5k': 1238, '10k': 2598, half: 5790, marathon: 12420 },
        lactateThreshold: { heartRate: 171, paceSecPerKm: 268 },
      },
    },
    manual: { activities: manualActs.reverse(), annotations: {} },
    profile: {
      name: '', age: 28, position: 'Zentrales Mittelfeld', level: 'Amateur (4. Liga)',
      trainingDays: 5, goals: '10 km unter 42 Minuten laufen und im Match bis zur 90. Minute pressen können.',
      raceGoal: '10 km in 41:59', injuries: 'Leichte Achillessehnen-Reizung rechts im Frühling', maxHr: 194,
    },
    insights: {
      generatedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      model: 'claude-opus-5-5 (Demo)',
      trigger: 'garmin-sync',
      analysis: {
        summary: 'Deine Form zeigt klar nach oben: Die Pace deiner lockeren Läufe ist in 12 Wochen um rund 15 s/km schneller geworden – bei gleichem Puls. Mit drei Läufen, zwei Trainings und einem Match pro Woche liegst du an der oberen Grenze dessen, was du gut verkraftest. HRV und Ruhepuls sind stabil, du bist bereit für eine harte Einheit.',
        readiness: { score: 78, label: 'Bereit für Tempo', reasoning: 'HRV über deinem 3-Wochen-Schnitt (66 vs. 62 ms), Ruhepuls bei 49, Schlaf 7.4 h. Die letzte harte Belastung (Match) liegt 3 Tage zurück.' },
        load: { status: 'optimal', comment: 'ACWR 1.13 – du steigerst dich kontrolliert. Halte den Wochenumfang diese Woche konstant, bevor du den langen Lauf weiter verlängerst.' },
        running: [
          { title: 'Ein Qualitätslauf pro Woche reicht', detail: 'Neben zwei Fussballtrainings ist ein harter Lauf (Intervalle oder Schwelle) optimal. Dein Tempolauf am Donnerstag kollidiert mit dem Training – verschiebe ihn auf Mittwoch.', priority: 'hoch' },
          { title: 'Schwellentempo bei 4:28/km', detail: 'Deine Laktatschwelle liegt bei 171 bpm bzw. 4:28/km. 3×10\' in diesem Bereich bauen genau die Ausdauer für die 10 km unter 42 Minuten auf.', priority: 'mittel' },
          { title: 'Lockere Läufe wirklich locker', detail: 'Dein Ø-Puls bei lockeren Läufen liegt bei 146 bpm – Ziel: unter 145. Das spart Energie für die harten Tage.', priority: 'niedrig' },
        ],
        football: [
          { title: 'Wiederholungssprints einbauen', detail: '1×/Woche 2 Serien à 6×30 m Sprint mit 20" Pause. Das trainiert genau die Belastung im Pressing in der Schlussphase.', priority: 'hoch' },
          { title: 'Nordic Curls gegen Zerrungen', detail: '2×/Woche 3×5 Nordic Hamstring Curls senkt das Risiko für Oberschenkelzerrungen nachweislich – ideal nach dem Training.', priority: 'mittel' },
        ],
        recovery: [
          { title: 'Schlaf vor Matchtagen', detail: 'Vor deinen letzten zwei Matches hast du unter 7 h geschlafen. Plane am Freitag bewusst 8 h ein.', priority: 'mittel' },
          { title: 'Achillessehne im Blick behalten', detail: 'Wadenheben exzentrisch 3×15 an 3 Tagen pro Woche. Bei Schmerzen am Morgen das Lauftempo reduzieren und ärztlich abklären lassen.', priority: 'niedrig' },
        ],
        warnings: [],
        plan,
        answer: '',
      },
      qa: [
        { question: 'Soll ich am Tag nach dem Match laufen gehen?', answer: 'Ja, aber nur sehr locker: 30–40 Minuten im Wohlfühltempo (Puls unter 145) fördern die Durchblutung und beschleunigen die Erholung. Wenn deine HRV am Morgen deutlich unter dem Schnitt liegt oder die Beine schwer sind, ersetze den Lauf durch 20 Minuten Velo oder Mobility.', at: new Date(Date.now() - 2 * 86400000).toISOString() },
      ],
      history: [],
    },
  };
}
