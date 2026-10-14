// Daily quote ("Tageszitat"): one quote per day, matched to the day's situation.
// Only quotes with a well-documented author; German wording = own translation of the original.
// Tags: general, hard, rest, race, consistency, restart, strength, swim
import { todayISO } from './util.js';

export const QUOTES = [
  { t: 'Kein Mensch ist begrenzt.', a: 'Eliud Kipchoge', tags: ['general', 'race', 'hard'] },
  { t: 'Nur wer diszipliniert ist, ist im Leben wirklich frei.', a: 'Eliud Kipchoge', tags: ['general', 'consistency'] },
  { t: 'Es geht nicht um die Beine, es geht um Herz und Kopf.', a: 'Eliud Kipchoge', tags: ['race', 'hard'] },
  { t: 'Weniger als dein Bestes zu geben heisst, das Geschenk zu opfern.', a: 'Steve Prefontaine', tags: ['hard', 'race'] },
  { t: 'Vielleicht schlägt mich jemand – aber dafür muss er bluten.', a: 'Steve Prefontaine', tags: ['race'] },
  { t: 'Das Wunder ist nicht, dass ich ins Ziel kam. Das Wunder ist, dass ich den Mut hatte zu starten.', a: 'John Bingham', tags: ['race', 'restart', 'general'] },
  { t: 'Wenn du laufen willst, lauf eine Meile. Wenn du ein anderes Leben erleben willst, lauf einen Marathon.', a: 'Emil Zátopek', tags: ['general', 'race'] },
  { t: 'Trainiere, aber quäle dich nicht.', a: 'Arthur Lydiard', tags: ['rest'] },
  { t: 'Wer einen Körper hat, ist ein Athlet.', a: 'Bill Bowerman', tags: ['general', 'restart'] },
  { t: 'Schmerz ist unvermeidlich. Leiden ist freiwillig.', a: 'Haruki Murakami', tags: ['hard', 'race'] },
  { t: 'Die meisten von uns geben auf, wenn sie erst etwa 40 Prozent ihrer maximalen Leistung gegeben haben.', a: 'David Goggins', tags: ['hard'] },
  { t: 'Der erste Schub aus Schmerz und Müdigkeit ist nur dein innerer Begrenzer, der spricht.', a: 'David Goggins', tags: ['hard', 'race'] },
  { t: 'Je öfter du dich unwohl fühlst, desto stärker wirst du.', a: 'David Goggins', tags: ['hard', 'strength'] },
  { t: 'Der einzige Gegner, gegen den du spielst, bist du selbst.', a: 'David Goggins', tags: ['general', 'consistency'] },
  { t: 'Dinge zu tun, auch kleine, die unbequem sind, macht dich stark.', a: 'David Goggins', tags: ['general', 'restart'] },
  { t: 'Es gibt keinen bequemen Weg von der Erde zu den Sternen.', a: 'Seneca', tags: ['hard', 'general'] },
  { t: 'Auch eine Reise von tausend Meilen beginnt mit dem ersten Schritt.', a: 'Laozi', tags: ['restart', 'rest', 'general'] },
  { t: 'Wir sind, was wir wiederholt tun. Exzellenz ist also keine Handlung, sondern eine Gewohnheit.', a: 'Will Durant', tags: ['consistency', 'rest'] },
  { t: 'Du steigst nicht auf das Niveau deiner Ziele. Du fällst auf das Niveau deiner Systeme.', a: 'James Clear', tags: ['consistency', 'restart'] },
  { t: 'Immer versucht. Immer gescheitert. Egal. Wieder versuchen. Wieder scheitern. Besser scheitern.', a: 'Samuel Beckett', tags: ['restart'] },
  { t: 'Ich habe jede Minute des Trainings gehasst, aber ich sagte mir: Gib nicht auf. Leide jetzt und lebe den Rest deines Lebens als Champion.', a: 'Muhammad Ali', tags: ['hard', 'strength'] },
  { t: 'Die letzten drei, vier Wiederholungen lassen den Muskel wachsen. Dieser Bereich des Schmerzes trennt den Champion von den anderen.', a: 'Arnold Schwarzenegger', tags: ['strength'] },
  { t: 'Man kann nichts eine Grenze setzen. Je mehr du träumst, desto weiter kommst du.', a: 'Michael Phelps', tags: ['swim', 'general'] },
];

const TAG_LABEL = {
  rest: 'Für deinen Ruhetag', hard: 'Für deine harte Einheit', race: 'Für dein Rennen', consistency: 'Weil du dranbleibst',
  restart: 'Für einen neuen Anlauf', strength: 'Für dein Krafttraining', swim: 'Für dein Schwimmtraining', general: 'Für heute',
};

// simple deterministic hash so the quote stays the same all day
const hash = (s) => [...s].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 7) >>> 0;

/** Own quotes from the settings: one per line, "Text — Autor" (author optional). */
export function parseOwnQuotes(text = '') {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*[—–-]\s*([^—–-]+)$/);
    const t = (m ? m[1] : l).replace(/^[«"„“]|[»"“”]$/g, '').trim();
    return { t, a: m ? m[2].trim() : '', tags: ['general', 'hard', 'race', 'consistency', 'restart', 'strength', 'swim'], own: true };
  }).filter((q) => q.t);
}

/**
 * Pick today's quote. situation = tag that fits the day; shift = how often "anderes" was pressed today.
 * Own quotes join every pool except rest days (no "push harder" on a red day).
 */
export function pickQuote({ situation = 'general', own = [], shift = 0, day = todayISO() }) {
  let pool = [...QUOTES, ...own].filter((q) => q.tags.includes(situation));
  if (pool.length < 2) pool = [...QUOTES, ...own].filter((q) => q.tags.includes('general'));
  const i = (hash(`${day}:${situation}`) + shift) % pool.length;
  return { ...pool[i], label: TAG_LABEL[situation] || TAG_LABEL.general, situation };
}
