// Daily quote ("Tageszitat"): one quote per day, matched to the day's situation.
// German wording = own translation of the original. Base set: well-documented authors.
// FORBES = selection from Kevin Kruse, «Inspirational Quotes» (Forbes, 2013); attributions as given there,
// those widely considered doubtful are flagged with `attr: true` and shown as «zugeschrieben».
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

const FORBES = [
  { t: 'Du verfehlst 100 % der Schüsse, die du nicht nimmst.', a: 'Wayne Gretzky', tags: ['hard', 'race', 'general'] },
  { t: 'Ich habe über 9000 Würfe verfehlt und fast 300 Spiele verloren. 26-mal wurde mir der entscheidende Wurf anvertraut – und ich habe daneben geworfen. Ich bin immer und immer wieder gescheitert. Und genau deshalb habe ich Erfolg.', a: 'Michael Jordan', tags: ['restart'] },
  { t: 'Das Schwierigste ist die Entscheidung zu handeln. Der Rest ist nur Beharrlichkeit.', a: 'Amelia Earhart', tags: ['restart', 'consistency', 'general'] },
  { t: 'Jeder Strike bringt mich näher an den nächsten Home Run.', a: 'Babe Ruth', tags: ['restart'] },
  { t: 'Ein klares Ziel ist der Ausgangspunkt jeder Leistung.', a: 'W. Clement Stone', tags: ['general', 'race'] },
  { t: 'Wir werden zu dem, worüber wir nachdenken.', a: 'Earl Nightingale', tags: ['general'] },
  { t: 'Das Leben besteht zu 10 % aus dem, was mir passiert, und zu 90 % daraus, wie ich darauf reagiere.', a: 'Charles Swindoll', tags: ['restart', 'rest', 'general'] },
  { t: 'Der beste Zeitpunkt, einen Baum zu pflanzen, war vor 20 Jahren. Der zweitbeste ist jetzt.', a: 'Chinesisches Sprichwort', tags: ['restart'] },
  { t: 'Achtzig Prozent des Erfolgs bestehen darin, aufzutauchen.', a: 'Woody Allen', tags: ['consistency', 'general'] },
  { t: 'Gewinnen ist nicht alles – aber gewinnen zu wollen schon.', a: 'Vince Lombardi', tags: ['race', 'hard'] },
  { t: 'Ich bin nicht das Produkt meiner Umstände. Ich bin das Produkt meiner Entscheidungen.', a: 'Stephen Covey', tags: ['consistency', 'general'] },
  { t: 'Entweder du bestimmst den Tag, oder der Tag bestimmt dich.', a: 'Jim Rohn', tags: ['consistency', 'general'] },
  { t: 'Ob du denkst, du kannst es, oder du kannst es nicht – du hast recht.', a: 'Henry Ford', attr: true, tags: ['race', 'hard', 'general'] },
  { t: 'Was immer du tun kannst oder erträumst – fang damit an. Kühnheit besitzt Genie, Kraft und Zauber.', a: 'Johann Wolfgang von Goethe', attr: true, tags: ['restart'] },
  { t: 'Man sagt oft, Motivation hält nicht an. Baden auch nicht – deshalb empfehlen wir es täglich.', a: 'Zig Ziglar', tags: ['consistency', 'general'] },
  { t: 'Das Leben schrumpft oder weitet sich im Verhältnis zum eigenen Mut.', a: 'Anaïs Nin', tags: ['hard', 'race'] },
  { t: 'Glaube, dass du es kannst, und du hast schon den halben Weg geschafft.', a: 'Theodore Roosevelt', attr: true, tags: ['race', 'general'] },
  { t: 'Alles, was du je wolltest, liegt auf der anderen Seite der Angst.', a: 'George Addair', tags: ['race', 'hard'] },
  { t: 'Fang an, wo du bist. Nutze, was du hast. Tu, was du kannst.', a: 'Arthur Ashe', tags: ['restart', 'rest', 'general'] },
  { t: 'Siebenmal hinfallen, achtmal aufstehen.', a: 'Japanisches Sprichwort', tags: ['restart'] },
  { t: 'Wenn der Wind nicht hilft, greif zu den Rudern.', a: 'Lateinisches Sprichwort', tags: ['hard', 'swim'] },
  { t: 'Zu viele von uns leben nicht ihre Träume, weil sie ihre Ängste leben.', a: 'Les Brown', tags: ['general', 'race'] },
  { t: 'Herausforderungen machen das Leben interessant – sie zu meistern macht es sinnvoll.', a: 'Joshua J. Marine', tags: ['hard', 'general'] },
  { t: 'Grenzen existieren nur in unserem Kopf. Mit Vorstellungskraft werden unsere Möglichkeiten grenzenlos.', a: 'Jamie Paolinetti', tags: ['race', 'general'] },
  { t: 'Wer sagt, dass es nicht geht, soll den nicht stören, der es gerade tut.', a: 'Chinesisches Sprichwort', tags: ['hard', 'strength'] },
  { t: 'Auf der Extrameile gibt es keinen Stau.', a: 'Roger Staubach', tags: ['hard', 'consistency', 'strength'] },
  { t: 'Es ist nie zu spät, der zu werden, der du hättest sein können.', a: 'George Eliot', attr: true, tags: ['restart'] },
  { t: 'Die Kämpfe, die zählen, sind nicht die um Goldmedaillen. Es sind die unsichtbaren Kämpfe in uns selbst – darum geht es.', a: 'Jesse Owens', tags: ['race', 'hard'] },
  { t: 'Es spielt keine Rolle, wie langsam du gehst, solange du nicht stehen bleibst.', a: 'Konfuzius', attr: true, tags: ['consistency', 'rest', 'restart'] },
  { t: 'Träume gross und wage es zu scheitern.', a: 'Norman Vaughan', tags: ['race', 'general'] },
  { t: 'Tu, was du kannst, wo du bist, mit dem, was du hast.', a: 'Theodore Roosevelt', tags: ['restart', 'rest'] },
  { t: 'Wenn du tust, was du immer getan hast, bekommst du, was du immer bekommen hast.', a: 'Tony Robbins', attr: true, tags: ['consistency', 'strength'] },
  { t: 'Vielleicht bist du enttäuscht, wenn du scheiterst – aber verloren bist du, wenn du es nicht versuchst.', a: 'Beverly Sills', tags: ['restart', 'race'] },
  { t: 'Die Frage ist nicht, wer mich lässt, sondern wer mich aufhalten will.', a: 'Ayn Rand', tags: ['hard', 'race'] },
  { t: 'Wenn alles gegen dich zu laufen scheint: Das Flugzeug hebt gegen den Wind ab, nicht mit ihm.', a: 'Henry Ford', attr: true, tags: ['hard', 'restart'] },
  { t: 'Ändere deine Gedanken, und du veränderst deine Welt.', a: 'Norman Vincent Peale', tags: ['general'] },
  { t: 'Nichts ist unmöglich – das Wort selbst sagt «I\'m possible».', a: 'Audrey Hepburn', attr: true, tags: ['race', 'general'] },
  { t: 'Der einzige Weg, grossartige Arbeit zu leisten, ist zu lieben, was man tut.', a: 'Steve Jobs', tags: ['general', 'consistency'] },
  { t: 'In zwanzig Jahren wirst du mehr enttäuscht sein über die Dinge, die du nicht getan hast, als über die, die du getan hast.', a: 'Mark Twain', attr: true, tags: ['race', 'general'] },
].map((q) => ({ ...q, src: 'Forbes' }));
QUOTES.push(...FORBES);

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
