// Tests der Rechenlogik mit ERFUNDENEN Daten. Start: npm test (oder: node --test tests/)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const HEAD = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const row = (date, text, zweck, name, amt, info = 'Umsatz gebucht') =>
  `"DE00000000000000000000";"${date}";"";"${text}";"${zweck}";"";"";"";"";"";"";"${name}";"DE00000000000000000000";"XXXXDEXX";"${amt}";"EUR";"${info}"`;
const csv = (...rows) => [HEAD, ...rows].join('\r\n') + '\r\n';
const load = (state, ...rows) => L.importRows(state, L.parseSparkasse(csv(...rows)).rows);

test('Beträge und Daten', () => {
  assert.equal(L.parseAmount('22'), 22);
  assert.equal(L.parseAmount('21,99'), 21.99);
  assert.equal(L.parseAmount('22.50'), 22.5);
  assert.equal(L.parseAmount('1.234,56'), 1234.56);
  assert.equal(L.parseAmount('-15,58'), -15.58);
  assert.equal(L.parseAmount(' 4,5 € '), 4.5);
  for (const bad of ['', 'abc', '1,2,3', '22.', '1e5']) assert.equal(L.parseAmount(bad), null, bad);
  assert.equal(L.parseDate('09.11.26'), '2026-11-09');
  assert.equal(L.parseDate('01.02.2025'), '2025-02-01');
  assert.equal(L.parseDate('31.02.26'), null);
});

test('CSV lesen: nur benötigte Felder, IBANs werden verworfen', () => {
  const { rows, bad } = L.parseSparkasse(csv(
    row('04.11.26', 'KARTENZAHLUNG', 'Einkauf ""Filiale""; Nr. 1', 'ALDI SUED//Heidelberg/DE', '-21,99'),
    row('05.11.26', 'SONSTIGER EINZUG', 'x', '', '-5,00', 'Umsatz vorgemerkt'),
    row('kaputt', 'X', 'x', 'x', '1'),
  ));
  assert.equal(bad, 1);
  assert.deepEqual(rows[0], { date: '2026-11-04', amt: -21.99, name: 'ALDI SUED//Heidelberg/DE', text: 'KARTENZAHLUNG', zweck: 'Einkauf "Filiale"; Nr. 1', pending: false });
  assert.equal(rows[1].pending, true);
  assert.ok(!JSON.stringify(rows).includes('DE000000'), 'keine IBAN gespeichert');
  assert.throws(() => L.parseSparkasse('a;b\n1;2'), /Sparkassen/);
});

test('Import: keine Doppelten, echte Doppelbuchungen bleiben', () => {
  const s = L.emptyState();
  const a = row('03.11.26', 'KARTENZAHLUNG', 'x', 'Mensa', '-4,50');
  let r = load(s, a, a, row('04.11.26', 'GUTSCHRIFT', 'Lohn', 'Firma', '800,00'));
  assert.deepEqual([r.added, r.known], [3, 0]);
  r = load(s, a, a);
  assert.deepEqual([r.added, r.known], [0, 2]);
  assert.equal(s.bank.length, 3);
});

test('Vorgemerkt → gebucht: wird ersetzt und behält die Kategorie', () => {
  const s = L.emptyState();
  load(s, row('05.11.26', 'LASTSCHRIFT', 'vorl.', 'FITX GmbH', '-24,99', 'Umsatz vorgemerkt'));
  L.setCategory(s, s.bank[0].id, 'Fitnessstudio');
  const r = load(s, row('06.11.26', 'FOLGELASTSCHRIFT', 'Mitgliedsbeitrag', 'FITX GmbH', '-24,99'));
  assert.equal(r.replaced, 1);
  assert.equal(s.bank.length, 1);
  assert.equal(s.bank[0].pending, false);
  assert.equal(s.bank[0].cat, 'Fitnessstudio');
});

test('Abgleich: gleicher Betrag → automatisch eine Ausgabe, nicht zwei', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-03', amt: 22, label: 'Aldi' });
  load(s, row('04.11.26', 'KARTENZAHLUNG', 'x', 'ALDI SUED', '-22,00'));
  assert.ok(s.bank[0].match);
  const o = L.overview(s, '2026-11');
  assert.equal(o.spent, 22);
  assert.equal(o.list.length, 1);
  assert.equal(L.questions(s).length, 0);
});

test('Abgleich: 22 € „Lebensmittel“ ↔ 21,99 € ALDI → Nachfrage, danach gelernt', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-03', amt: 22, label: 'Lebensmittel' });
  load(s, row('04.11.26', 'KARTENZAHLUNG', 'x', 'ALDI SUED', '-21,99'));
  let q = L.questions(s);
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'match');
  L.answerMatch(s, q[0].b.id, q[0].cands[0].id);
  assert.equal(L.overview(s, '2026-11').spent, 21.99);
  // Nächstes Mal erkennt die App ALDI ↔ Lebensmittel selbst
  L.addManual(s, { date: '2026-11-10', amt: 15, label: 'Lebensmittel' });
  load(s, row('11.11.26', 'KARTENZAHLUNG', 'y', 'ALDI SUED', '-14,80'));
  assert.equal(L.questions(s).length, 0);
});

test('Mehrere Kandidaten → Nachfrage statt Raten', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-03', amt: 22, label: 'Lebensmittel' });
  L.addManual(s, { date: '2026-11-04', amt: 22.3, label: 'Lebensmittel' });
  load(s, row('05.11.26', 'KARTENZAHLUNG', 'x', 'REWE', '-22,10'));
  const q = L.questions(s);
  assert.equal(q[0].kind, 'match');
  assert.equal(q[0].cands.length, 2);
  L.rejectMatch(s, q[0].b.id);
  assert.equal(L.questions(s)[0].kind, 'cat');
});

test('PayPal ohne Händler → Frage, keine Regel, nie Kategorie „PayPal“', () => {
  const s = L.emptyState();
  load(s, row('06.11.26', 'ONLINE-UEBERWEISUNG', 'PP.1234.PP . M. Beispiel', 'PayPal Europe S.a.r.l. et Cie S.C.A', '-6,00'));
  const [q] = L.questions(s);
  assert.equal(q.kind, 'cat');
  assert.equal(L.canRemember(q.b), false);
  assert.equal(L.merchant(q.b).label, 'PayPal');
  L.setCategory(s, q.b.id, 'Mensa', true);
  assert.equal(Object.keys(s.rules).length, 0);
  assert.equal(L.overview(s, '2026-11').rows[0].name, 'Mensa');
});

test('PayPal mit Händler im Zweck → Händler zählt', () => {
  const pp = (zweck) => L.merchant({ name: 'PayPal Europe', text: 'LASTSCHRIFT', zweck });
  assert.deepEqual(pp('1234 PP.5555.PP . Spotify AB, Ihr Einkauf bei Spotify AB'), { key: 'SPOTIFY AB', label: 'PayPal · Spotify AB' });
  assert.deepEqual(pp('1234/PP.5555.PP/. Lieferando, Ihr Einkauf bei'), { key: 'LIEFERANDO', label: 'PayPal · Lieferando' });
  // so sieht es bei David meistens aus: kein Händler → nur „PayPal“, nie die Referenznummer
  assert.deepEqual(pp('1043620012345/PP.5555.PP/. , Ihr Einkauf bei'), { key: '', label: 'PayPal' });
  assert.deepEqual(pp('1234 PP.5555.PP . , Ihr Einkauf bei'), { key: '', label: 'PayPal' });
});

test('Regel: Fitnessstudio einmal zuordnen, danach automatisch + wiederkehrend', () => {
  const s = L.emptyState();
  load(s, row('01.10.26', 'FOLGELASTSCHRIFT', 'Beitrag', 'FITX GmbH', '-24,99'));
  L.setCategory(s, s.bank[0].id, 'Fitnessstudio', true);
  load(s, row('01.11.26', 'FOLGELASTSCHRIFT', 'Beitrag 11', 'FITX GmbH', '-24,99'));
  assert.equal(s.bank[1].cat, 'Fitnessstudio');
  assert.equal(s.bank[1].src, 'auto');
  assert.equal(L.questions(s).length, 0);
  assert.deepEqual(L.recurring(s).map((r) => [r.label, r.amt, r.cat]), [['FITX GmbH', 24.99, 'Fitnessstudio']]);
});

test('Bargeld: Abheben ist keine Ausgabe, eigene Einträge zählen, Rest sichtbar', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-02', amt: 4.5, label: 'Mensa' });
  load(s,
    row('01.11.26', 'BARGELDAUSZAHLUNG', 'GA 1', 'Sparkasse', '-20,00'),
    row('20.11.26', 'KARTENZAHLUNG', 'z', 'REWE', '-10,00'));
  const o = L.overview(s, '2026-11');
  const rows = Object.fromEntries(o.rows.map((r) => [r.name, r.amt]));
  assert.equal(rows.Mensa, 4.5);
  assert.equal(rows['Bargeld ohne Eintrag'], 15.5);
  assert.equal(o.open, 10);
  assert.equal(o.spent, 30); // = alles, was vom Konto ging – nichts doppelt, nichts verschwunden
});

test('0,00-€-Buchungen erscheinen weder in der Liste noch als Frage', () => {
  const s = L.emptyState();
  load(s, row('01.11.26', 'ENTGELTABSCHLUSS', 'Hinweis', '', '0,00'));
  assert.equal(L.overview(s, '2026-11').list.length, 0);
  assert.equal(L.questions(s).length, 0);
});

test('Kontostand rechnet mit neuen Importen weiter', () => {
  const s = L.emptyState();
  load(s, row('01.11.26', 'GUTSCHRIFT', 'x', 'Firma', '100,00'));
  L.setBalance(s, 500);
  load(s, row('02.11.26', 'KARTENZAHLUNG', 'x', 'REWE', '-30,00'), row('03.11.26', 'KARTENZAHLUNG', 'y', 'REWE', '-5,00', 'Umsatz vorgemerkt'));
  assert.equal(L.balanceNow(s), 470);
  assert.equal(L.pendingSum(s), -5);
});

test('Kategorien zusammenführen', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-01', amt: 5, label: 'Aldi' });
  L.addManual(s, { date: '2026-11-02', amt: 7, label: 'lebensmittel' });
  L.renameCategory(s, 'Aldi', 'Lebensmittel');
  assert.deepEqual(L.overview(s, '2026-11').rows, [{ name: 'lebensmittel', amt: 12 }]);
  assert.equal(L.canonical(s, 'LEBENSMITTEL'), 'lebensmittel');
  L.renameCategory(s, 'lebensmittel', 'Lebensmittel'); // nur Schreibweise
  assert.deepEqual(L.allLabels(s), ['Lebensmittel']);
});

test('Oberkategorien: Aldi + Rewe → Einkaufen, einzeln weiter sichtbar', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-01', amt: 20, label: 'Aldi' });
  L.addManual(s, { date: '2026-11-02', amt: 15, label: 'Rewe' });
  L.addManual(s, { date: '2026-11-03', amt: 8, label: 'Mensa' });
  L.setGroup(s, 'Aldi', 'Einkaufen');
  L.setGroup(s, 'rewe', 'einkaufen'); // Schreibweise wird angeglichen
  assert.deepEqual(L.overview(s, '2026-11').rows, [
    { name: 'Einkaufen', amt: 35, children: [{ name: 'Aldi', amt: 20 }, { name: 'Rewe', amt: 15 }] },
    { name: 'Mensa', amt: 8 },
  ]);
  // Kategorie, die selbst „Einkaufen“ heißt, landet in der Gruppe
  L.addManual(s, { date: '2026-11-04', amt: 5, label: 'Einkaufen' });
  assert.equal(L.overview(s, '2026-11').rows[0].amt, 40);
  // Umbenennen der Kategorie behält die Gruppe, Umbenennen der Gruppe wirkt überall
  L.renameCategory(s, 'Aldi', 'ALDI Süd');
  assert.equal(L.groupOf(s, 'ALDI Süd'), 'Einkaufen');
  L.renameGroup(s, 'Einkaufen', 'Supermarkt');
  assert.deepEqual([L.groupOf(s, 'ALDI Süd'), L.groupOf(s, 'Rewe')], ['Supermarkt', 'Supermarkt']);
  assert.deepEqual(L.suggestGroups(s, 'sup'), ['Supermarkt']);
  // Gruppe entfernen
  L.setGroup(s, 'Rewe', '');
  assert.equal(L.groupOf(s, 'Rewe'), '');
  // übersteht Sicherung
  assert.equal(L.groupOf(L.validateState(JSON.parse(JSON.stringify(s))), 'ALDI Süd'), 'Supermarkt');
});

test('Vorschläge: zuletzt benutzt zuerst, Töpfe (Bargeld) nie', () => {
  const s = L.emptyState();
  load(s, row('01.11.26', 'BARGELDAUSZAHLUNG', 'GA', 'Sparkasse', '-20,00'));
  L.addManual(s, { date: '2026-11-01', amt: 5, label: 'Kino' });
  L.addManual(s, { date: '2026-11-03', amt: 5, label: 'Alkohol' });
  assert.deepEqual(L.suggest(s, ''), ['Alkohol', 'Kino', 'Lebensmittel', 'Mensa']);
  assert.deepEqual(L.suggest(s, 'ki'), ['Kino']);
  assert.ok(!L.suggest(s, 'bar').includes('Bargeld'));
});

test('Startdatum: ältere Umsätze werden ignoriert, auch bei späteren Importen', () => {
  const s = L.emptyState();
  let r = L.importRows(s, L.parseSparkasse(csv(row('01.09.26', 'X', 'x', 'A', '-1,00'), row('01.11.26', 'X', 'x', 'B', '-2,00'))).rows, { since: '2026-11-01' });
  assert.deepEqual([r.added, r.old], [1, 1]);
  r = load(s, row('02.09.26', 'X', 'x', 'C', '-3,00'));
  assert.deepEqual([r.added, r.old], [0, 1]);
});

test('Sicherung: nur gültige Daten, keine Prototyp-Tricks', () => {
  const s = L.emptyState();
  L.addManual(s, { date: '2026-11-01', amt: 5, label: 'Aldi' });
  const back = L.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(back.manual.length, 1);
  const evil = JSON.parse('{"v":1,"manual":[{"id":"x","date":"2026-11-01","amt":5,"label":"<img src=x onerror=alert(1)>"}],"bank":[{"id":"../../x","date":"2026-11-01","amt":1}],"rules":{"__proto__":"x","ALDI":"Essen"},"hints":{"__proto__":{"a":1}}}');
  const v = L.validateState(evil);
  assert.equal(v.bank.length, 0);
  assert.equal(v.rules.ALDI, 'Essen');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(v.rules), null);
  assert.equal(v.manual[0].label, '<img src=x onerror=alert(1)>'); // bleibt reiner Text; app.js setzt nur textContent
  assert.throws(() => L.validateState({ v: 2, manual: [], bank: [] }));
  assert.throws(() => L.validateState(null));
});
