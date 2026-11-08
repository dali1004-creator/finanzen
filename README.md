# Finanzen

Schlichte Ausgaben-App fürs iPhone (Web-App, offline-fähig) mit Abgleich gegen den Sparkassen-CSV-Export.

- **Startseite:** Betrag + „An wen / Kategorie“ eintippen → Senden.
- **Übersicht** (Symbol oben rechts): Kontostand, Einnahmen/Ausgaben/Übrig, „Wohin das Geld geht“, wiederkehrende Kosten, alle Umsätze.
- **Abgleich:** Eigene Eingaben und Bankumsätze werden zusammengeführt (±1 € bzw. ±5 %, Bank bis 5 Tage später). Jede Ausgabe zählt genau einmal.
- **Offene Fragen:** Jeder Bankumsatz ohne Kategorie wird nachgefragt (z. B. PayPal ohne Händler). Antworten können als Regel für den Händler gemerkt werden. „PayPal“ ist nie eine Kategorie.
- **Töpfe (Bargeld, Mensakarte):** Abheben/Aufladen ist keine Ausgabe; eigene Einträge zählen, der Rest erscheint als „… ohne Eintrag“.

## Sicherheit und Datenschutz

- **Keine Abhängigkeiten.** Kein Framework, keine npm-Pakete, kein CDN, keine Web-Fonts. Nur die Dateien in diesem Ordner.
- **Keine Verbindungen nach außen.** Die Content-Security-Policy in `index.html` verbietet jede Netzwerkverbindung (`connect-src 'none'`) und erlaubt nur eigene Skripte.
- **Kein HTML aus Daten.** Die Oberfläche setzt Texte nur als Text (kein `innerHTML`); zusätzlich erzwingt Trusted Types das im Browser.
- **Daten nur auf dem Gerät** (`localStorage` der installierten App). Kein Server, keine Cloud, kein Konto.
- **Datensparsam:** Aus der CSV werden nur Datum, Betrag, Name, Buchungstext, Verwendungszweck und „vorgemerkt“ übernommen. IBAN, BIC, Mandatsreferenz und Gläubiger-ID werden verworfen.
- **Sicherungen** (JSON) enthalten deine Umsätze im Klartext – nur an vertrauenswürdigen Orten ablegen (z. B. iCloud Drive), nie in dieses Repo (per `.gitignore` gesperrt).
- **Repo ist öffentlich, enthält aber nur Code.** CSV-Dateien und Sicherungen liegen außerhalb dieses Ordners und sind zusätzlich per `.gitignore` ausgeschlossen.

## Benutzen

1. iPhone: Adresse der App in **Safari** öffnen → Teilen → **Zum Home-Bildschirm**.
2. Ausgaben auf der Startseite eintragen.
3. Etwa monatlich: Im Sparkassen-Online-Banking (Safari) Umsätze als **CSV-CAMT** exportieren → in der App Übersicht → *Sparkassen-CSV importieren* → offene Fragen beantworten.
4. Ab und zu *Sicherung exportieren* (z. B. nach iCloud Drive). Ohne Sicherung sind die Daten weg, wenn die App gelöscht wird.

## Entwickeln

- Tests: `npm test` (Node ≥ 20, keine Installation nötig)
- Lokal ansehen: beliebigen statischen Server im Ordner starten, z. B. `npx serve` oder `python -m http.server`, dann `http://localhost:8000`
- **Nach jeder Code-Änderung `VERSION` in `sw.js` erhöhen**, sonst zeigt das iPhone weiter die alte Fassung.
- Aufbau: `logic.js` (Rechenlogik, ohne Bildschirm, getestet) · `app.js` (Oberfläche) · `styles.css` · `sw.js` (Offline-Cache)
