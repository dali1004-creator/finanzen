// logic.js – die komplette Rechenlogik der App: kein Bildschirm, kein Netzwerk.
// Wird im Browser von app.js genutzt und in Node von den Tests (tests/).

export const SCHEMA = 1;
export const CASH = 'Bargeld';
const DEFAULT_LABELS = ['Lebensmittel', 'Mensa', 'Essen gehen', 'Alkohol', 'Fitnessstudio', 'Abos', 'Miete', 'Mobilität', 'Shopping'];

const dict = () => Object.create(null); // Objekt ohne Prototyp: sicher gegen "__proto__"-Tricks

export function emptyState() {
  return { v: SCHEMA, manual: [], bank: [], rules: dict(), hints: dict(), groups: dict(), pots: [CASH], balance: null, since: null };
}

// ---------- Grundlagen ----------

export const round2 = (n) => Math.round(n * 100) / 100;
const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

/** Text säubern: Steuerzeichen raus, Leerraum zusammenfassen, Länge begrenzen. */
export function cleanText(s, max = 160) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "22" | "22,5" | "22.50" | "1.234,56" | "-15,58" → Zahl, sonst null. */
export function parseAmount(s) {
  let t = String(s ?? '').replace(/[\s€]/g, '');
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '');
  else if (!/^[+-]?\d+([.,]\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) < 1e9 ? round2(n) : null;
}

/** "09.11.26" | "09.11.2026" → "2026-11-09", ungültig → null. */
export function parseDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, m[2] - 1, m[1]));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === m[2] - 1 ? d.toISOString().slice(0, 10) : null;
}

/** Heutiges Datum in Ortszeit als "JJJJ-MM-TT". */
export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Tage von a bis b (b − a). */
export const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function hash(str) { // cyrb53: kurzer, stabiler Fingerabdruck (keine Kryptografie nötig)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

// ---------- Sparkassen-CSV ----------

/** CSV mit ";" und Anführungszeichen in Zeilen/Felder zerlegen. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const endRow = () => { row.push(field); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else field += c;
  }
  endRow();
  return rows;
}

const headerKey = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]/g, '');

/**
 * Sparkassen-Export (CSV-CAMT oder CSV-MT940) lesen. Übernimmt NUR, was die App braucht:
 * Datum, Betrag, Name, Buchungstext, Verwendungszweck, vorgemerkt. IBANs, BIC,
 * Mandatsreferenz und Gläubiger-ID werden verworfen und nie gespeichert.
 */
export function parseSparkasse(text) {
  const rows = parseCsv(String(text).replace(/^﻿/, ''));
  if (!rows.length) throw new Error('Die Datei ist leer.');
  const head = rows[0].map(headerKey);
  const col = {
    date: head.indexOf('buchungstag'),
    amt: head.indexOf('betrag'),
    text: head.indexOf('buchungstext'),
    zweck: head.indexOf('verwendungszweck'),
    name: head.findIndex((h) => h.includes('zahlungspflichtiger')),
    info: head.indexOf('info'),
  };
  if (col.date < 0 || col.amt < 0) throw new Error('Das sieht nicht wie ein Sparkassen-Umsatzexport aus. Bitte als „CSV-CAMT“ exportieren.');
  const out = [];
  let bad = 0;
  for (const r of rows.slice(1, 50001)) {
    const date = parseDate(r[col.date]);
    const amt = parseAmount(r[col.amt]);
    if (!date || amt === null) { bad++; continue; }
    out.push({
      date, amt,
      name: cleanText(r[col.name]),
      text: cleanText(r[col.text], 60),
      zweck: cleanText(r[col.zweck], 200),
      pending: /vorgemerkt/i.test(r[col.info] ?? ''),
    });
  }
  return { rows: out, bad };
}

// ---------- Händler, Kategorien ----------

const NOISE = new Set(['GMBH', 'MBH', 'AG', 'SE', 'KG', 'CO', 'OHG', 'UG', 'EK', 'GBR', 'LTD', 'INC', 'BV', 'SA', 'SAS',
  'SARL', 'EV', 'DE', 'DEUTSCHLAND', 'GERMANY', 'EUROPE', 'SAGT', 'DANKE']);

function keyFrom(s) {
  const words = String(s).split('//')[0].toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[^A-Z]+/g, ' ').trim().split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w));
  const key = words.slice(0, 2).join(' ');
  return key.length >= 3 ? key : '';
}

/** PayPal/Klarna sind nur Zahlungswege, nie eine Kategorie. */
export const isProvider = (b) => /paypal|klarna/i.test(b.name || b.zweck);
export const isCash = (b) => /bargeld|geldautomat/i.test(b.text);

/** Händler eines Bankumsatzes: key = Wiedererkennung für Regeln, label = Anzeige. */
export function merchant(b) {
  if (isProvider(b)) {
    // PayPal schreibt den Händler (falls überhaupt) als "… PP.123.PP . Händler, Ihr Einkauf bei Händler"
    const found = cleanText((/einkauf bei\s+([^,]+)/i.exec(b.zweck) || /\.PP\/?\s*\.\s*([^,]+),/.exec(b.zweck))?.[1], 40);
    const shop = /[a-zäöü]{2}/i.test(found) ? found : ''; // Händler muss nach einem Namen aussehen, nicht nach einer Referenznummer
    const via = /klarna/i.test(b.name || b.zweck) ? 'Klarna' : 'PayPal';
    return { key: shop ? keyFrom(shop) : '', label: shop ? `${via} · ${shop}` : via };
  }
  return { key: keyFrom(b.name), label: cleanText(String(b.name).split('//')[0], 60) || b.text || 'Umsatz' };
}

/** Alle benutzten Kategorien, zuletzt benutzte zuerst. */
export function allLabels(state) {
  const seen = new Map();
  const add = (label, date) => {
    if (!label) return;
    const k = label.toLowerCase();
    if (!seen.has(k) || date > seen.get(k).date) seen.set(k, { label, date });
  };
  state.manual.forEach((m) => add(m.label, m.date));
  state.bank.forEach((b) => add(b.cat, b.date));
  return [...seen.values()].sort(byDateDesc).map((x) => x.label);
}

/** Gleiche Schreibweise erzwingen: "lebensmittel" → "Lebensmittel", wenn es das schon gibt. */
export function canonical(state, label) {
  const t = cleanText(label, 40);
  return allLabels(state).find((l) => l.toLowerCase() === t.toLowerCase()) || t;
}

export const isPotLabel = (state, label) => !!label && state.pots.some((p) => p.toLowerCase() === label.toLowerCase());
const isPot = (state, b) => !b.match && isPotLabel(state, b.cat);

/** Vorschläge fürs Kategoriefeld; bei einem Bankumsatz zuerst, was bei diesem Händler schon gewählt wurde. */
export function suggest(state, query = '', b = null, n = 4) {
  const learned = b ? Object.entries(state.hints[merchant(b).key] || {}).sort((x, y) => y[1] - x[1]).map((x) => x[0]) : [];
  return pickMatches([...learned, ...allLabels(state), ...DEFAULT_LABELS], query, n, (l) => isPotLabel(state, l));
}

/** Die ersten n Einträge, die den Suchtext enthalten (ohne Doppelte, ohne exakten Treffer). */
function pickMatches(list, query, n, skip = () => false) {
  const q = query.trim().toLowerCase();
  const seen = new Set(), out = [];
  for (const l of list) {
    const k = l.toLowerCase();
    if (seen.has(k) || skip(l) || (q && (!k.includes(q) || k === q))) continue;
    seen.add(k); out.push(l);
    if (out.length === n) break;
  }
  return out;
}

// ---------- Oberkategorien (z. B. Aldi, Rewe → Einkaufen) ----------

const DEFAULT_GROUPS = ['Einkaufen', 'Essen & Trinken', 'Freizeit', 'Wohnen', 'Verträge', 'Mobilität'];
const gkey = (label) => label.toLowerCase();

/** Alle vergebenen Oberkategorien. */
export const allGroups = (state) => [...new Map(Object.values(state.groups).map((g) => [g.toLowerCase(), g])).values()];

/** Oberkategorie einer Kategorie; heißt die Kategorie selbst wie eine Oberkategorie, gehört sie dorthin. */
export function groupOf(state, label) {
  if (!label) return '';
  return state.groups[gkey(label)] || allGroups(state).find((g) => g.toLowerCase() === gkey(label)) || '';
}

/** Oberkategorie festlegen ('' entfernt sie). Gleiche Schreibweise wie eine bestehende Oberkategorie wird übernommen. */
export function setGroup(state, label, group) {
  const g = cleanText(group, 40), l = cleanText(label, 40);
  if (!l) return;
  delete state.groups[gkey(l)];
  if (!g || gkey(g) === gkey(l)) return;
  state.groups[gkey(l)] = allGroups(state).find((x) => x.toLowerCase() === g.toLowerCase()) || g;
}

/** Oberkategorie umbenennen bzw. mit einer anderen zusammenführen ('' löst sie auf). */
export function renameGroup(state, from, to) {
  const t = cleanText(to, 40);
  const target = t && (allGroups(state).find((g) => g.toLowerCase() === t.toLowerCase() && g.toLowerCase() !== from.toLowerCase()) || t);
  for (const k of Object.keys(state.groups)) {
    if (state.groups[k].toLowerCase() !== from.toLowerCase()) continue;
    if (target && target.toLowerCase() !== k) state.groups[k] = target; else delete state.groups[k];
  }
}

export const suggestGroups = (state, query = '', n = 4) => pickMatches([...allGroups(state), ...DEFAULT_GROUPS], query, n);

function learn(state, b, label) {
  const { key } = merchant(b);
  if (!key) return;
  const h = (state.hints[key] ||= dict());
  h[label] = (h[label] || 0) + 1;
}

/** Bekannte Händler (Regeln) und Bargeld automatisch zuordnen. Gibt die Anzahl zurück. */
export function applyRules(state) {
  let n = 0;
  for (const b of state.bank) {
    if (b.amt >= 0 || b.cat || b.match) continue;
    const cat = isCash(b) ? CASH : state.rules[merchant(b).key];
    if (cat) { b.cat = cat; b.src = 'auto'; n++; }
  }
  return n;
}

// ---------- Abgleich Eingabe ↔ Bank ----------

const tolerance = (amt) => Math.max(1, amt * 0.05);
const isExact = (m, b) => Math.abs(-b.amt - m.amt) < 0.005;

/** Kann Bankumsatz b dieselbe Ausgabe sein wie Eingabe m? (±1 € bzw. ±5 %, Bank bucht bis 5 Tage später) */
function fits(state, m, b) {
  if (b.amt >= 0 || b.match || b.noMatch || isPot(state, b)) return false;
  if (Math.abs(-b.amt - m.amt) > tolerance(m.amt)) return false;
  const d = dayDiff(m.date, b.date);
  return d >= -1 && d <= 5;
}

/** Passt der Name? Entweder steht die Eingabe im Bankumsatz ("Aldi" ↔ "ALDI SUED") oder sie wurde schon mal zugeordnet. */
function nameHit(state, m, b) {
  const label = m.label.toLowerCase();
  const learned = state.hints[merchant(b).key];
  if (learned && Object.keys(learned).some((l) => l.toLowerCase() === label)) return true;
  const hay = `${b.name} ${b.zweck}`.toLowerCase();
  return label.split(/\s+/).some((w) => w.length >= 3 && hay.includes(w));
}

const score = (state, m, b) => Math.abs(-b.amt - m.amt) / tolerance(m.amt)
  + Math.abs(dayDiff(m.date, b.date) - 1) / 5 - (nameHit(state, m, b) ? 1 : 0);

function freeManual(state) {
  const used = new Set(state.bank.map((b) => b.match).filter(Boolean));
  return state.manual.filter((m) => !used.has(m.id));
}

function link(state, b, m) {
  b.match = m.id;
  delete b.noMatch;
  learn(state, b, m.label);
}

/** Eindeutige Paare automatisch verknüpfen: genau ein Kandidat auf beiden Seiten UND (gleicher Betrag oder passender Name). */
export function autoMatch(state) {
  const cands = new Map(freeManual(state).map((m) => [m, state.bank.filter((b) => fits(state, m, b))]));
  const load = new Map();
  for (const bs of cands.values()) for (const b of bs) load.set(b, (load.get(b) || 0) + 1);
  let n = 0;
  for (const [m, bs] of cands) {
    const b = bs[0];
    if (bs.length === 1 && load.get(b) === 1 && (isExact(m, b) || nameHit(state, m, b))) { link(state, b, m); n++; }
  }
  return n;
}

/**
 * Offene Fragen. Jeder Ausgabe-Umsatz der Bank, der weder verknüpft noch eindeutig zugeordnet ist,
 * erzeugt genau eine Frage – so bleibt kein Euro ohne Kategorie.
 *  - kind "match": es gibt passende Eingaben → „Gehört das zu deiner Eingabe?“
 *  - kind "cat":   keine passende Eingabe → „Wofür war das?“
 */
export function questions(state) {
  const free = freeManual(state);
  const recurringKeys = new Set(recurring(state).map((r) => r.key));
  const out = [];
  for (const b of state.bank) {
    if (b.amt >= 0 || b.match || isPot(state, b)) continue;
    let cands = free.filter((m) => fits(state, m, b));
    if (b.cat) cands = cands.filter((m) => isExact(m, b) || nameHit(state, m, b));
    const key = merchant(b).key;
    if (cands.length) {
      cands.sort((x, y) => score(state, x, b) - score(state, y, b));
      out.push({ kind: 'match', b, cands: cands.slice(0, 4), key, recurring: recurringKeys.has(key) });
    } else if (!b.cat) {
      out.push({ kind: 'cat', b, key, recurring: recurringKeys.has(key) });
    }
  }
  // Abgleich-Fragen zuerst; dann Händler mit vielen Umsätzen (eine Antwort klärt viele), sonst neueste zuerst
  const group = new Map();
  for (const q of out) if (q.kind === 'cat' && q.key) group.set(q.key, (group.get(q.key) || 0) + 1);
  for (const q of out) q.same = q.kind === 'cat' && q.key ? group.get(q.key) - 1 : 0;
  return out.sort((x, y) => (x.kind !== y.kind ? (x.kind === 'match' ? -1 : 1) : y.same - x.same || byDateDesc(x.b, y.b)));
}

export const canRemember = (b) => !!merchant(b).key;
export const findBank = (state, id) => state.bank.find((b) => b.id === id);
export const findManual = (state, id) => state.manual.find((m) => m.id === id);

export function answerMatch(state, bankId, manualId) {
  const b = findBank(state, bankId), m = findManual(state, manualId);
  if (b && m) link(state, b, m);
}

export function rejectMatch(state, bankId) {
  const b = findBank(state, bankId);
  if (b) b.noMatch = true;
}

/** Kategorie setzen; mit remember gilt sie künftig für alle Umsätze dieses Händlers. */
export function setCategory(state, bankId, label, remember = false) {
  const b = findBank(state, bankId), l = canonical(state, label);
  if (!b || !l) return 0;
  b.cat = l; b.src = 'user';
  learn(state, b, l);
  const { key } = merchant(b);
  if (!remember || !key) return 0;
  state.rules[key] = l;
  return applyRules(state);
}

export function unlink(state, bankId) {
  const b = findBank(state, bankId);
  if (b) { delete b.match; b.noMatch = true; }
}

// ---------- Eigene Eingaben ----------

export function addManual(state, { date, amt, label }) {
  const l = canonical(state, label), a = round2(Number(amt));
  if (!l || !(a > 0) || a >= 1e7) throw new Error('Ungültige Eingabe.');
  const m = { id: newId(), date: isISO(date) ? date : localISO(), amt: a, label: l };
  state.manual.push(m);
  autoMatch(state);
  return m;
}

export function updateManual(state, id, label) {
  const m = findManual(state, id), l = canonical(state, label);
  if (m && l) m.label = l;
}

export function deleteManual(state, id) {
  state.manual = state.manual.filter((m) => m.id !== id);
  for (const b of state.bank) if (b.match === id) delete b.match;
  autoMatch(state);
}

/** Kategorie umbenennen; heißt das Ziel schon so, werden beide zusammengeführt. */
export function renameCategory(state, from, to) {
  const same = (s) => !!s && s.toLowerCase() === from.toLowerCase();
  const t = cleanText(to, 40);
  if (!t || t === from) return;
  const target = same(t) ? t : canonical(state, t); // nur Schreibweise geändert → übernehmen, sonst ggf. zusammenführen
  state.manual.forEach((m) => { if (same(m.label)) m.label = target; });
  state.bank.forEach((b) => { if (same(b.cat)) b.cat = target; });
  for (const k in state.rules) if (same(state.rules[k])) state.rules[k] = target;
  for (const k in state.hints) {
    const h = state.hints[k];
    for (const l of Object.keys(h)) if (same(l) && l !== target) { h[target] = (h[target] || 0) + h[l]; delete h[l]; }
  }
  const wasPot = isPotLabel(state, from);
  state.pots = state.pots.filter((p) => !same(p));
  if (wasPot) setPot(state, target, true);
  const group = state.groups[gkey(from)];
  delete state.groups[gkey(from)];
  if (group && !state.groups[gkey(target)]) state.groups[gkey(target)] = group;
}

export function setPot(state, label, on) {
  state.pots = state.pots.filter((p) => p.toLowerCase() !== label.toLowerCase());
  if (on) state.pots.push(label);
}

// ---------- Import ----------

/**
 * Bankumsätze übernehmen, ohne Doppelte. Gleiche Umsätze erkennt die App am Fingerabdruck aus
 * Datum, Betrag, Name, Text und Zweck. Vorgemerkte Umsätze, die inzwischen gebucht sind,
 * werden ersetzt und behalten ihre Kategorie bzw. Verknüpfung.
 */
export function importRows(state, rows, opts = {}) {
  if ('since' in opts) state.since = opts.since;
  const use = state.since ? rows.filter((r) => r.date >= state.since) : rows;
  const seen = new Map();
  const fresh = use.map((r) => {
    const k = [r.date, r.amt, r.name, r.text, r.zweck].join('|');
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return { id: `b${hash(k)}-${n}`, ...r };
  });
  const result = { added: 0, known: 0, replaced: 0, old: rows.length - use.length };
  if (!fresh.length) return result;

  const dates = fresh.map((f) => f.date).sort();
  const lo = dates[0], hi = dates.at(-1);
  const ids = new Set(fresh.map((f) => f.id));
  const existing = new Map(state.bank.map((b) => [b.id, b]));
  // Vorgemerkte, die in der neuen Datei nicht mehr so vorkommen: im Zeitraum der Datei sicher überholt,
  // bis 7 Tage davor nur, wenn sich die gebuchte Fassung findet.
  const stale = state.bank.filter((b) => b.pending && !ids.has(b.id) && b.date <= hi && dayDiff(b.date, lo) <= 7);
  const removed = new Set(stale.filter((b) => b.date >= lo));
  const taken = new Set();

  for (const f of fresh) {
    const ex = existing.get(f.id);
    if (ex) { ex.pending = f.pending; result.known++; continue; }
    const p = stale.find((x) => !taken.has(x) && x.amt === f.amt && merchant(x).key === merchant(f).key && Math.abs(dayDiff(x.date, f.date)) <= 7);
    if (p) {
      taken.add(p);
      removed.add(p);
      for (const k of ['cat', 'src', 'match', 'noMatch']) if (p[k] !== undefined) f[k] = p[k];
    }
    state.bank.push(f);
    result.added++;
  }
  result.replaced = removed.size;
  state.bank = state.bank.filter((b) => !removed.has(b));
  applyRules(state);
  autoMatch(state);
  return result;
}

// ---------- Auswertung ----------

export const lastBankDate = (state) => state.bank.reduce((mx, b) => (b.date > mx ? b.date : mx), '');
const sumBooked = (state) => round2(state.bank.reduce((s, b) => (b.pending ? s : s + b.amt), 0));
export const pendingSum = (state) => round2(state.bank.reduce((s, b) => (b.pending ? s + b.amt : s), 0));

/** Kontostand merken: Wert jetzt + Summe aller gebuchten Umsätze als Bezugspunkt. */
export function setBalance(state, value) {
  state.balance = { value: round2(value), base: sumBooked(state) };
}

/** Kontostand = eingetragener Wert + alles, was seitdem gebucht wurde. */
export const balanceNow = (state) => (state.balance ? round2(state.balance.value + sumBooked(state) - state.balance.base) : null);

export function monthsOf(state, extra) {
  const s = new Set([localISO().slice(0, 7), extra]);
  for (const x of state.manual) s.add(x.date.slice(0, 7));
  for (const x of state.bank) s.add(x.date.slice(0, 7));
  return [...s].filter(Boolean).sort();
}

/**
 * Monatsübersicht. Jede Ausgabe zählt genau einmal:
 *  - Bank + Eingabe verknüpft → einmal, mit deiner Kategorie
 *  - nur Bank → mit ihrer Kategorie, sonst "Noch offen"
 *  - nur Eingabe (z. B. bar) → mit deiner Kategorie
 *  - Bargeld/Töpfe: Abheben ist keine Ausgabe; was davon ohne Eintrag bleibt, erscheint als "… ohne Eintrag"
 */
export function overview(state, month) {
  const inMonth = (d) => d.startsWith(month);
  const manualById = new Map(state.manual.map((m) => [m.id, m]));
  const used = new Set(), cats = new Map(), pots = new Map(), list = [];
  const add = (map, k, v) => map.set(k, round2((map.get(k) || 0) + v));
  const last = lastBankDate(state);
  let income = 0, open = 0;

  for (const b of state.bank) {
    const m = b.match && manualById.get(b.match);
    if (m) used.add(m.id);
    if (!b.amt || !inMonth(b.date)) continue; // 0,00-€-Buchungen (Bankhinweise) nicht anzeigen
    const item = { kind: 'bank', id: b.id, date: b.date, amt: b.amt, title: merchant(b).label, pending: b.pending };
    if (b.amt > 0) { income += b.amt; item.type = 'income'; item.label = 'Einnahme'; }
    else if (m) { add(cats, m.label, -b.amt); item.type = 'both'; item.label = m.label; }
    else if (isPot(state, b)) { add(pots, b.cat, -b.amt); item.type = 'pot'; item.label = b.cat; }
    else if (b.cat) { add(cats, b.cat, -b.amt); item.type = b.src === 'auto' ? 'auto' : 'bank'; item.label = b.cat; }
    else { open -= b.amt; item.type = 'open'; item.label = 'Noch offen'; }
    list.push(item);
  }

  let covered = 0; // eigene Eingaben ohne Bankgegenstück = vermutlich bar / aus einem Topf bezahlt
  for (const m of state.manual) {
    if (used.has(m.id) || !inMonth(m.date)) continue;
    add(cats, m.label, m.amt);
    const waiting = !last || dayDiff(m.date, last) < 5; // Bank hatte noch keine Zeit zu buchen
    if (!waiting) covered += m.amt;
    list.push({ kind: 'manual', id: m.id, date: m.date, amt: -m.amt, title: m.label, label: m.label, type: waiting ? 'wait' : 'manual', pending: false });
  }

  const rows = [...cats].map(([name, amt]) => ({ name, amt }));
  for (const [name, amt] of pots) {
    const rest = round2(amt - covered);
    covered = Math.max(0, covered - amt);
    if (rest > 0) rows.push({ name: `${name} ohne Eintrag`, amt: rest, pot: name });
  }
  rows.sort((a, b) => b.amt - a.amt);
  list.sort(byDateDesc);
  const spent = round2(rows.reduce((s, r) => s + r.amt, 0) + open);

  // Kategorien mit Oberkategorie zusammenfassen: { name, amt, children: [...] }
  const grouped = [], byGroup = new Map();
  for (const r of rows) {
    const g = r.pot ? '' : groupOf(state, r.name);
    if (!g) { grouped.push(r); continue; }
    let G = byGroup.get(g.toLowerCase());
    if (!G) { G = { name: g, amt: 0, children: [] }; byGroup.set(g.toLowerCase(), G); grouped.push(G); }
    G.amt = round2(G.amt + r.amt);
    G.children.push(r);
  }
  grouped.sort((a, b) => b.amt - a.amt);
  return { income: round2(income), spent, open: round2(open), rows: grouped, list };
}

/** Wiederkehrende Abbuchungen: gleicher Händler, ähnlicher Betrag, höchstens einmal pro Monat, in ≥ 2 Monaten, zuletzt vor ≤ 40 Tagen. */
export function recurring(state) {
  const last = lastBankDate(state);
  const groups = new Map();
  for (const b of state.bank) {
    if (b.amt >= 0 || b.pending || isCash(b) || isPot(state, b)) continue;
    const { key } = merchant(b);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const manualById = new Map(state.manual.map((m) => [m.id, m]));
  const out = [];
  for (const [key, bs] of groups) {
    bs.sort((x, y) => -byDateDesc(x, y));
    const latest = bs.at(-1), amt = -latest.amt;
    if (dayDiff(latest.date, last) > 40) continue;
    const similar = bs.filter((b) => Math.abs(-b.amt - amt) <= amt * 0.1 + 0.5);
    const months = new Set(similar.map((b) => b.date.slice(0, 7)));
    if (months.size < 2 || similar.length > months.size) continue;
    const cat = latest.match ? manualById.get(latest.match)?.label : latest.cat;
    out.push({ key, label: merchant(latest).label, amt, cat: cat || '' });
  }
  return out.sort((a, b) => b.amt - a.amt);
}

// ---------- Sicherung ----------

const validId = (s) => typeof s === 'string' && /^[\w-]{1,64}$/.test(s);
const validNum = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e9;

/** Gespeicherte Daten / Sicherungsdatei streng prüfen und nur bekannte, saubere Felder übernehmen. */
export function validateState(x) {
  if (!x || typeof x !== 'object' || x.v !== SCHEMA || !Array.isArray(x.manual) || !Array.isArray(x.bank)) {
    throw new Error('Das ist keine gültige Sicherung dieser App.');
  }
  const s = emptyState();
  const ids = new Set();
  for (const m of x.manual.slice(0, 200000)) {
    const label = cleanText(m?.label, 40);
    if (validId(m?.id) && !ids.has(m.id) && isISO(m.date) && validNum(m.amt) && m.amt > 0 && label) {
      ids.add(m.id);
      s.manual.push({ id: m.id, date: m.date, amt: round2(m.amt), label });
    }
  }
  const manualIds = new Set(ids);
  for (const b of x.bank.slice(0, 200000)) {
    if (!validId(b?.id) || ids.has(b.id) || !isISO(b.date) || !validNum(b.amt)) continue;
    ids.add(b.id);
    const t = { id: b.id, date: b.date, amt: round2(b.amt), name: cleanText(b.name), text: cleanText(b.text, 60), zweck: cleanText(b.zweck, 200), pending: b.pending === true };
    const cat = cleanText(b.cat, 40);
    if (cat) { t.cat = cat; t.src = b.src === 'auto' ? 'auto' : 'user'; }
    if (manualIds.has(b.match)) t.match = b.match;
    if (b.noMatch === true) t.noMatch = true;
    s.bank.push(t);
  }
  const validKey = (k) => /^[A-Z]{2,}( [A-Z]{2,})?$/.test(k);
  for (const [k, v] of Object.entries(x.rules || {})) if (validKey(k) && cleanText(v, 40)) s.rules[k] = cleanText(v, 40);
  for (const [k, h] of Object.entries(x.hints || {})) {
    if (!validKey(k) || !h || typeof h !== 'object') continue;
    s.hints[k] = dict();
    for (const [l, n] of Object.entries(h)) if (cleanText(l, 40) && Number.isInteger(n) && n > 0) s.hints[k][cleanText(l, 40)] = n;
  }
  for (const [k, g] of Object.entries(x.groups || {})) {
    const label = cleanText(k, 40).toLowerCase(), group = cleanText(g, 40);
    if (label && group) s.groups[label] = group;
  }
  if (Array.isArray(x.pots)) s.pots = [...new Set(x.pots.map((p) => cleanText(p, 40)).filter(Boolean))].slice(0, 20);
  if (x.balance && validNum(x.balance.value) && validNum(x.balance.base)) s.balance = { value: x.balance.value, base: x.balance.base };
  if (isISO(x.since)) s.since = x.since;
  return s;
}
