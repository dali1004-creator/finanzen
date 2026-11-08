// app.js – Oberfläche. Alles wird per DOM-API gebaut und Texte nur als reiner Text gesetzt
// (kein innerHTML), damit Inhalte aus der Bank-CSV nie als Code ausgeführt werden können.
// Daten liegen ausschließlich im Speicher dieses Geräts (localStorage); es gibt keinen Server.
import * as L from './logic.js';

const KEY = 'finanzen.v1';
const MAX_CSV = 10 * 1024 * 1024;
const MAX_BACKUP = 30 * 1024 * 1024;
const TAGS = {
  both: 'du + Bank', bank: 'nur Bank', auto: 'nur Bank · automatisch', manual: 'nur du',
  wait: 'nur du · wartet auf Bank', open: 'offen', income: 'Einnahme', pot: 'abgehoben / aufgeladen',
};

const root = document.getElementById('app');
const ui = { screen: 'add', shown: '', month: L.localISO().slice(0, 7), skip: new Set(), toast: '' };
let state = load();
let toastTimer = 0;

// ---------- Speicher ----------

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return L.emptyState(); }
  if (!raw) return L.emptyState();
  try { return L.validateState(JSON.parse(raw)); } catch {
    try { localStorage.setItem(`${KEY}.defekt`, raw); } catch { /* egal */ }
    alert('Die gespeicherten Daten waren beschädigt und wurden beiseitegelegt. Bitte eine Sicherung laden.');
    return L.emptyState();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {
    alert('Speichern fehlgeschlagen (Speicher voll oder gesperrt). Bitte eine Sicherung exportieren.');
  }
}

function commit() { save(); render(); }

// ---------- Kleine Helfer ----------

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = (n) => euro.format(n);
const signed = (n) => (n > 0 ? '+ ' : n < 0 ? '− ' : '') + euro.format(Math.abs(n));
const dmy = (iso, withYear = false) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${withYear ? y : ''}`; };
const monthName = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const shiftMonth = (ym, by) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + by, 1); return L.localISO(d).slice(0, 7); };

/** Element bauen. Kinder: Knoten oder Text (wird als Text eingefügt, nie als HTML). */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', back: 'M15 18l-6-6 6-6', next: 'M9 18l6-6-6-6',
  check: 'M5 12l5 5L20 7', close: 'M6 6l12 12M18 6L6 18', down: 'M12 3v12M7 10l5 5 5-5M5 21h14', up: 'M12 15V3M7 8l5-5 5 5M5 21h14',
};
function icon(name, size = 20) {
  const s = document.createElementNS(SVG, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}

/** Vorschlags-Chips unter einem Kategoriefeld; aktualisieren sich beim Tippen. */
function chipBox(input, bankTx, onPick) {
  const box = h('div', { class: 'chips' });
  const fill = () => box.replaceChildren(...L.suggest(state, input.value, bankTx).map((n) =>
    h('button', { type: 'button', class: 'chip', onclick: () => { input.value = n; fill(); onPick?.(); } }, n)));
  input.addEventListener('input', fill);
  fill();
  return box;
}

/** Einblendfenster von unten. dlg.add(...) fügt Inhalt hinzu. */
function sheet(title) {
  const inner = h('div', { class: 'sheet-inner' },
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => dlg.close() }, icon('close'))));
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' }, inner);
  dlg.add = (...kids) => inner.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // Tipp auf den Hintergrund
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function go(screen) { ui.screen = screen; render(); }

function render() {
  const y = window.scrollY;
  root.replaceChildren({ add: viewAdd, overview: viewOverview, questions: viewQuestions }[ui.screen]());
  window.scrollTo(0, ui.shown === ui.screen ? y : 0);
  ui.shown = ui.screen;
}

// ---------- Bildschirm 1: Eingabe ----------

function viewAdd() {
  const open = L.questions(state).length;
  const amount = h('input', { id: 'betrag', class: 'amount-input', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', enterkeyhint: 'next' });
  const label = h('input', { id: 'kat', class: 'label-input', autocomplete: 'off', autocorrect: 'off', maxlength: 40, placeholder: 'z. B. Aldi oder Lebensmittel', enterkeyhint: 'send' });
  const date = h('input', { id: 'datum', type: 'date', class: 'date-input', value: L.localISO(), max: L.localISO() });
  const send = h('button', { type: 'submit', class: 'btn primary big', disabled: true }, 'Senden');
  const check = () => { send.disabled = !(L.parseAmount(amount.value) > 0 && label.value.trim()); };
  amount.addEventListener('input', check);
  label.addEventListener('input', check);
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); label.focus(); } });

  const submit = (e) => {
    e.preventDefault();
    const amt = L.parseAmount(amount.value);
    if (!(amt > 0) || !label.value.trim()) return;
    const entry = L.addManual(state, { date: date.value, amt, label: label.value });
    ui.toast = `Gespeichert: ${eur(amt)} · ${entry.label}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast = ''; document.querySelector('.toast')?.replaceChildren(); }, 2500);
    commit();
  };

  return h('div', { class: 'screen' },
    h('div', { class: 'topbar end' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': open ? `Übersicht öffnen, ${open} offene Fragen` : 'Übersicht öffnen', onclick: () => go('overview') },
        icon('grid'), open ? h('span', { class: 'badge', 'aria-hidden': 'true' }, open > 99 ? '99+' : open) : null)),
    h('form', { class: 'add-form', onsubmit: submit },
      h('div', { class: 'add-fields' },
        h('div', { class: 'field-group' },
          h('label', { for: 'betrag', class: 'label' }, 'Betrag'),
          h('div', { class: 'amount-row' }, amount, h('span', { class: 'euro', 'aria-hidden': 'true' }, '€'))),
        h('div', { class: 'stack' },
          h('div', { class: 'field-group' }, h('label', { for: 'kat', class: 'label' }, 'An wen / Kategorie'), label),
          chipBox(label, null, check)),
        h('div', { class: 'date-row' }, h('label', { for: 'datum', class: 'label' }, 'Datum'), date)),
      h('p', { class: 'toast', role: 'status' }, ui.toast ? [icon('check', 16), ui.toast] : null),
      send));
}

// ---------- Bildschirm 2: Übersicht ----------

function viewOverview() {
  const o = L.overview(state, ui.month);
  const open = L.questions(state).length;
  const months = L.monthsOf(state, ui.month);
  const i = months.indexOf(ui.month);
  const bal = L.balanceNow(state), pend = L.pendingSum(state);
  const empty = !state.bank.length && !state.manual.length;
  const max = Math.max(o.open, ...o.rows.map((r) => r.amt), 1);
  const rec = L.recurring(state);
  const stat = (name, n) => h('div', { class: 'stat' }, h('span', {}, name), h('strong', {}, eur(n)));
  const setMonth = (m) => () => { ui.month = m; render(); };

  return h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück zur Eingabe', onclick: () => go('add') }, icon('back')),
      h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Vorheriger Monat', disabled: i <= 0, onclick: setMonth(months[i - 1]) }, icon('back', 18)),
      h('h1', {}, monthName(ui.month)),
      h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Nächster Monat', disabled: i >= months.length - 1, onclick: setMonth(months[i + 1]) }, icon('next', 18))),

    h('button', { type: 'button', class: 'balance', onclick: openBalance },
      h('span', { class: 'label' }, 'Kontostand'),
      h('span', { class: 'big' }, bal == null ? 'Eintragen' : eur(bal)),
      h('span', { class: 'sub' }, bal == null ? 'Tippen, um den Kontostand laut Sparkasse einzutragen'
        : pend ? `Noch vorgemerkt: ${signed(pend)}` : 'Stand laut letztem Import')),

    h('div', { class: 'stats' }, stat('Einnahmen', o.income), stat('Ausgaben', o.spent), stat('Übrig', o.income - o.spent)),

    open
      ? h('button', { type: 'button', class: 'banner warn', onclick: () => go('questions') },
        h('span', { class: 'count' }, open > 99 ? '99+' : open),
        h('span', { class: 'grow' }, h('strong', {}, open === 1 ? 'Offene Frage' : 'Offene Fragen'), h('span', {}, 'Tippen, damit jeder Umsatz eine Kategorie bekommt')),
        icon('next', 18))
      : empty ? null : h('p', { class: 'banner ok' }, icon('check', 18), 'Alles zugeordnet – kein Euro ohne Kategorie'),

    empty ? h('p', { class: 'empty' }, 'Noch keine Daten. Trag auf der Startseite Ausgaben ein oder importiere unten deine Sparkassen-CSV.') : null,

    o.rows.length || o.open
      ? h('section', { class: 'section' }, h('h2', {}, 'Wohin das Geld geht'),
        o.rows.map((r) => catRow(r, max)),
        o.open ? catRow({ name: 'Noch offen', amt: o.open, open: true }, max) : null)
      : null,

    rec.length
      ? h('section', { class: 'section' }, h('h2', {}, 'Wiederkehrend'),
        h('p', { class: 'hint' }, `Zusammen ca. ${eur(rec.reduce((s, r) => s + r.amt, 0))} pro Monat`),
        h('div', { class: 'list' }, rec.map((r) => h('div', { class: 'rec' },
          h('span', {}, r.label, r.cat ? h('small', {}, ` · ${r.cat}`) : null), h('strong', {}, eur(r.amt))))))
      : null,

    o.list.length ? h('section', { class: 'section' }, h('h2', {}, 'Umsätze'), h('div', { class: 'list' }, o.list.map((t) => txRow(t)))) : null,

    h('section', { class: 'section' }, h('h2', {}, 'Daten'), dataButtons()));
}

function catRow(r, max) {
  const bar = h('span', { class: `bar${r.open ? ' warn' : r.pot ? ' pot' : ''}` });
  bar.style.width = `${Math.max(2, Math.round((r.amt / max) * 100))}%`;
  return h('button', { type: 'button', class: `cat-row${r.open ? ' warn' : ''}`, onclick: () => (r.open ? go('questions') : openCategory(r)) },
    h('span', { class: 'cat-line' }, h('span', {}, r.name), h('strong', {}, eur(r.amt))),
    h('span', { class: 'track' }, bar));
}

function txRow(t, parent) {
  const sub = [t.label !== t.title ? t.label : null, TAGS[t.type], dmy(t.date), t.pending ? 'vorgemerkt' : null].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'tx', onclick: () => { parent?.close(); openTx(t); } },
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, t.title),
      h('span', { class: 'tx-sub' }, h('span', { class: `dot ${t.type}` }), sub)),
    h('strong', { class: t.amt > 0 ? 'pos' : null }, signed(t.amt)));
}

function dataButtons() {
  const csv = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: (e) => { importCsv(e.target.files[0]); e.target.value = ''; } });
  const backup = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { importBackup(e.target.files[0]); e.target.value = ''; } });
  return h('div', { class: 'stack' },
    h('button', { type: 'button', class: 'btn', onclick: () => csv.click() }, icon('down', 18), 'Sparkassen-CSV importieren'), csv,
    h('button', { type: 'button', class: 'btn', onclick: exportBackup }, icon('up', 18), 'Sicherung exportieren'),
    h('button', { type: 'button', class: 'btn', onclick: () => backup.click() }, 'Sicherung laden'), backup,
    h('button', { type: 'button', class: 'btn danger', onclick: wipe }, 'Alle Daten löschen'),
    h('p', { class: 'hint' }, 'Deine Daten liegen nur auf diesem Gerät, nichts wird ins Internet übertragen. Exportiere regelmäßig eine Sicherung, z. B. nach iCloud Drive.'));
}

// ---------- Bildschirm 3: Offene Fragen ----------

function viewQuestions() {
  const all = L.questions(state);
  const head = (info) => h('div', { class: 'topbar' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück zur Übersicht', onclick: () => go('overview') }, icon('back')),
    h('h1', {}, 'Offene Fragen'),
    h('span', { class: 'muted' }, info || ''));

  if (!all.length) {
    return h('div', { class: 'screen' }, head(),
      h('div', { class: 'done' },
        h('span', { class: 'done-icon' }, icon('check', 30)),
        h('p', { class: 'done-title' }, 'Alles zugeordnet'),
        h('p', { class: 'muted' }, 'Jeder Umsatz hat jetzt eine Kategorie.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go('overview') }, 'Zur Übersicht')));
  }

  let list = all.filter((q) => !ui.skip.has(q.b.id));
  if (!list.length) { ui.skip.clear(); list = all; }
  const q = list[0], b = q.b, who = L.merchant(b);
  const later = h('button', { type: 'button', class: 'btn', onclick: () => { ui.skip.add(b.id); render(); } }, 'Später');

  const card = h('div', { class: 'q-card' },
    h('p', { class: 'muted' }, who.label),
    h('p', { class: 'q-amount' }, signed(b.amt)),
    h('p', { class: 'muted' }, [dmy(b.date, true), b.text, b.pending ? 'vorgemerkt' : null, q.recurring ? 'jeden Monat' : null].filter(Boolean).join(' · ')),
    b.zweck ? h('p', { class: 'q-zweck' }, b.zweck) : null);

  let body;
  if (q.kind === 'match') {
    body = h('div', { class: 'stack' },
      h('p', { class: 'q-ask' }, q.cands.length > 1 ? 'Zu welcher deiner Eingaben gehört das?' : 'Gehört das zu deiner Eingabe?'),
      q.cands.map((m) => h('button', { type: 'button', class: 'btn choice', onclick: () => { L.answerMatch(state, b.id, m.id); commit(); } },
        `${m.label} · ${eur(m.amt)} · ${dmy(m.date)}`)),
      h('button', { type: 'button', class: 'btn', onclick: () => { L.rejectMatch(state, b.id); commit(); } }, q.cands.length > 1 ? 'Keine davon' : 'Nein, etwas anderes'),
      later);
  } else {
    const input = h('input', { id: 'antwort', class: 'field', autocomplete: 'off', maxlength: 40, placeholder: 'z. B. Mensa' });
    const saveBtn = h('button', { type: 'submit', class: 'btn primary', disabled: true }, 'Speichern');
    const enable = () => { saveBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', enable);
    const remember = L.canRemember(b) ? h('input', { type: 'checkbox', checked: true }) : null;
    const name = who.label;
    body = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); if (!input.value.trim()) return; L.setCategory(state, b.id, input.value, !!remember?.checked); commit(); } },
      h('p', { class: 'q-ask' }, L.isProvider(b) && !who.key ? `${name} ist nur der Zahlungsweg. Wofür hast du bezahlt?` : 'Wofür war das?'),
      h('label', { for: 'antwort', class: 'label' }, 'Kategorie'),
      input,
      chipBox(input, b, enable),
      remember ? h('label', { class: 'check' }, remember,
        q.same ? `Auch die ${q.same} weiteren und alle künftigen Umsätze von „${name}“ so zuordnen` : `Künftige Umsätze von „${name}“ automatisch so zuordnen`) : null,
      h('div', { class: 'row2' }, later, saveBtn));
  }
  return h('div', { class: 'screen' }, head(`${all.length} offen`), card, body);
}

// ---------- Einblendfenster ----------

function balanceForm(dlg) {
  const cur = L.balanceNow(state);
  const input = h('input', { id: 'kontostand', class: 'field', inputmode: 'decimal', autocomplete: 'off', placeholder: 'z. B. 1.284,50',
    value: cur == null ? '' : Math.abs(cur).toFixed(2).replace('.', ',') });
  const minus = h('input', { type: 'checkbox', checked: cur != null && cur < 0 });
  return h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    const v = L.parseAmount(input.value);
    if (v == null) { alert('Bitte einen Betrag eingeben, z. B. 1.284,50'); return; }
    L.setBalance(state, minus.checked ? -Math.abs(v) : Math.abs(v));
    dlg.close();
    commit();
  } },
  h('label', { for: 'kontostand', class: 'label' }, 'Kontostand laut Sparkasse'), input,
  h('label', { class: 'check' }, minus, 'Konto ist im Minus'),
  h('p', { class: 'hint' }, 'Am besten direkt nach dem CSV-Import eintragen. Danach rechnet die App mit jedem neuen Import selbst weiter.'),
  h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'));
}

function openBalance() {
  const dlg = sheet('Kontostand');
  dlg.add(balanceForm(dlg));
}

function openCategory(r) {
  const name = r.pot || r.name;
  const items = L.overview(state, ui.month).list.filter((t) => t.label === name);
  const dlg = sheet(r.name);
  const input = h('input', { id: 'kat-name', class: 'field', value: name, maxlength: 40, autocomplete: 'off' });
  const pot = h('input', { type: 'checkbox', checked: L.isPotLabel(state, name) });
  dlg.add(
    r.pot ? h('p', { class: 'hint' }, `${eur(r.amt)} wurden diesen Monat abgehoben bzw. aufgeladen, aber noch keiner Ausgabe zugeordnet. Trag Barausgaben auf der Startseite ein, dann wird dieser Betrag kleiner.`) : null,
    items.length ? h('div', { class: 'list' }, items.map((t) => txRow(t, dlg))) : null,
    h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const to = input.value.trim();
      if (!to) return;
      if (to !== name) L.renameCategory(state, name, to);
      L.setPot(state, L.canonical(state, to), pot.checked);
      dlg.close();
      commit();
    } },
    h('label', { for: 'kat-name', class: 'label' }, 'Name – gleicher Name wie eine andere Kategorie führt beide zusammen'), input,
    h('label', { class: 'check' }, pot, 'Ist ein Topf (z. B. Bargeld, Mensakarte): Abheben/Aufladen zählt nicht als Ausgabe, sondern deine Einträge.'),
    h('button', { type: 'submit', class: 'btn primary' }, 'Speichern')));
}

function openTx(t) {
  const dlg = sheet(t.title);
  const rows = [['Betrag', signed(t.amt)], ['Datum', dmy(t.date, true)], ['Herkunft', TAGS[t.type] + (t.pending ? ' · vorgemerkt' : '')]];
  const details = () => h('dl', { class: 'details' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  if (t.kind === 'bank') {
    const b = L.findBank(state, t.id);
    if (!b) return dlg.close();
    rows.push(['Empfänger / Auftraggeber', b.name || '–'], ['Buchungstext', b.text || '–'], ['Verwendungszweck', b.zweck || '–']);
    const m = b.match && L.findManual(state, b.match);
    if (m) rows.push(['Deine Eingabe', `${m.label} · ${eur(m.amt)} · ${dmy(m.date)}`]);
    dlg.add(details());
    if (b.amt >= 0) return;
    dlg.add(m
      ? h('button', { type: 'button', class: 'btn', onclick: () => { L.unlink(state, b.id); dlg.close(); commit(); } }, 'Verknüpfung mit deiner Eingabe lösen')
      : labelForm(dlg, b.cat || '', b, (label) => L.setCategory(state, b.id, label)));
    return;
  }
  const m = L.findManual(state, t.id);
  if (!m) return dlg.close();
  dlg.add(details(),
    labelForm(dlg, m.label, null, (label) => L.updateManual(state, m.id, label)),
    h('button', { type: 'button', class: 'btn danger', onclick: () => {
      if (!confirm('Diesen Eintrag wirklich löschen?')) return;
      L.deleteManual(state, m.id);
      dlg.close();
      commit();
    } }, 'Eintrag löschen'));
}

function labelForm(dlg, value, bankTx, onSave) {
  const input = h('input', { id: 'kategorie', class: 'field', value, maxlength: 40, autocomplete: 'off', placeholder: 'Kategorie' });
  return h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    onSave(input.value);
    dlg.close();
    commit();
  } },
  h('label', { for: 'kategorie', class: 'label' }, 'Kategorie'), input, chipBox(input, bankTx),
  h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'));
}

// ---------- Import, Sicherung ----------

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

async function importCsv(file) {
  if (!file) return;
  if (file.size > MAX_CSV) { alert('Die Datei ist zu groß (höchstens 10 MB).'); return; }
  let parsed;
  try { parsed = L.parseSparkasse(decode(await file.arrayBuffer())); } catch (err) {
    alert(err.message || 'Die Datei konnte nicht gelesen werden.');
    return;
  }
  if (!parsed.rows.length) { alert('In der Datei wurden keine Umsätze gefunden.'); return; }
  const opts = {};
  if (!state.bank.length && !state.since) {
    const first = parsed.rows.reduce((a, r) => (r.date < a ? r.date : a), parsed.rows[0].date);
    if (L.dayDiff(first, L.localISO()) > 62) {
      const since = await chooseStart(first);
      if (since === undefined) return;
      opts.since = since;
    }
  }
  const r = L.importRows(state, parsed.rows, opts);
  commit();
  showImportResult(r, parsed.bad);
}

/** Erster Import mit langer Vorgeschichte: ab wann übernehmen? undefined = abgebrochen, null = alles. */
function chooseStart(first) {
  return new Promise((resolve) => {
    const now = L.localISO().slice(0, 7), prev = shiftMonth(now, -1);
    let choice;
    const dlg = sheet('Ab wann übernehmen?');
    const pick = (v) => () => { choice = v; dlg.close(); };
    dlg.addEventListener('close', () => resolve(choice));
    dlg.add(
      h('p', { class: 'hint' }, `Die Datei reicht zurück bis ${dmy(first, true)}. Für jeden älteren Umsatz ohne Kategorie würde die App nachfragen. Du kannst auch frisch starten – ältere Umsätze werden dann dauerhaft ignoriert.`),
      h('button', { type: 'button', class: 'btn primary', onclick: pick(`${now}-01`) }, `Ab diesem Monat (${monthName(now)})`),
      h('button', { type: 'button', class: 'btn', onclick: pick(`${prev}-01`) }, `Ab letztem Monat (${monthName(prev)})`),
      h('button', { type: 'button', class: 'btn', onclick: pick(null) }, 'Alles übernehmen'));
  });
}

function showImportResult(r, bad) {
  const open = L.questions(state).length;
  const dlg = sheet('Import fertig');
  const lines = [
    `${r.added} neue Umsätze übernommen`,
    r.known ? `${r.known} waren schon da (nicht doppelt gezählt)` : null,
    r.replaced ? `${r.replaced} vorgemerkte durch die gebuchte Fassung ersetzt` : null,
    r.old ? `${r.old} vor dem Startdatum ignoriert` : null,
    bad ? `${bad} Zeilen waren nicht lesbar` : null,
  ].filter(Boolean);
  dlg.add(
    h('div', { class: 'stack' }, lines.map((l) => h('p', {}, l))),
    open ? h('button', { type: 'button', class: 'btn primary', onclick: () => { dlg.close(); go('questions'); } }, `${open} offene Fragen beantworten`) : null,
    h('h2', { class: 'label' }, state.balance ? 'Kontostand prüfen (optional)' : 'Kontostand eintragen (optional)'),
    balanceForm(dlg));
}

async function exportBackup() {
  const name = `finanzen-sicherung-${L.localISO()}.json`;
  const file = new File([JSON.stringify(state)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Finanzen-Sicherung' }); return; }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP) { alert('Die Datei ist zu groß.'); return; }
  let next;
  try { next = L.validateState(JSON.parse(await file.text())); } catch (err) {
    alert(err instanceof SyntaxError ? 'Die Datei ist keine gültige Sicherung.' : err.message);
    return;
  }
  if (!confirm(`Sicherung laden? Sie enthält ${next.manual.length} Eingaben und ${next.bank.length} Bankumsätze und ersetzt alle aktuellen Daten auf diesem Gerät.`)) return;
  state = next;
  ui.skip.clear();
  commit();
}

function wipe() {
  if (!confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Das lässt sich nicht rückgängig machen. Tipp: vorher eine Sicherung exportieren.')) return;
  state = L.emptyState();
  ui.skip.clear();
  commit();
}

// ---------- Start ----------

if ('serviceWorker' in navigator) {
  // Trusted Types: nur genau diese eine Skript-Adresse ist erlaubt
  const url = window.trustedTypes
    ? window.trustedTypes.createPolicy('sw', { createScriptURL: (u) => { if (u !== './sw.js') throw new TypeError('blockiert'); return u; } }).createScriptURL('./sw.js')
    : './sw.js';
  navigator.serviceWorker.register(url).catch(() => { /* offline-Funktion optional */ });
}
Promise.resolve(navigator.storage?.persist?.()).catch(() => {}); // bittet iOS, die Daten nicht aufzuräumen
render();
