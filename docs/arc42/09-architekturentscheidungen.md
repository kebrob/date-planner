# 9. Architekturentscheidungen

## ADR-001: Next.js + TypeScript als Fullstack

- **Status:** angenommen (2026-10-09)
- **Kontext:** Ein Entwickler, Frontend + Backend + Claude-Chat mit Streaming.
- **Entscheidung:** Next.js (App Router) mit TypeScript für UI und Server in einem Projekt.
- **Begründung:** Ein Deployment, eine Sprache, ausgereiftes Claude-SDK für TypeScript, einfache Streaming-UI. PHP/Laravel ausdrücklich nicht gewünscht.

## ADR-002: Vercel + Neon Postgres

- **Status:** angenommen (2026-10-09)
- **Kontext:** Kostenloses Hosting, Domain bei Cloudflare vorhanden.
- **Entscheidung:** Vercel Hobby, Neon Postgres Free Tier, Drizzle ORM.
- **Begründung:** Vercel hat kein persistentes Dateisystem, daher kein SQLite. Neon ist mit Vercel direkt integrierbar und ohne Zahlungsmethode kostenfrei. Drizzle ist leichtgewichtig und typsicher.
- **Verworfen:** Eigener VPS (Betriebsaufwand).

## ADR-003: Ports & Adapters für externe Dienste

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Jeder externe Dienst hinter einem Interface, Auswahl per Environment-Variable.
- **Begründung:** Anbieter (Google ↔ OSM, DB inoffiziell ↔ offiziell) müssen ohne Änderung an Planner und UI austauschbar sein.

## ADR-004: Ein gemeinsamer Account mit Passkeys

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Ein Account, mehrere Passkeys (je Gerät), Notfall-Passwort, eigene Session-Verwaltung.
- **Begründung:** Face ID-Login gewünscht. Basic Auth verworfen: kein Logout, kein Brute-Force-Schutz, keine Passkeys, Probleme mit PWA auf iOS.

## ADR-005: Google Places als Standard, OpenStreetMap als Fallback

- **Status:** angenommen (2026-10-09)
- **Kontext:** Vorgeschlagene Aktivitäten müssen vor Ort existieren und zur geplanten Zeit geöffnet sein.
- **Entscheidung:** `PlacesProvider` mit Google Places (Standard) und OSM Overpass (Fallback bei Limit/Fehler).
- **Begründung:** Google hat zuverlässige Öffnungszeiten und Bewertungen; bei der erwarteten Nutzung im Freikontingent. OSM ist kostenlos, aber bei Öffnungszeiten lückenhaft.

## ADR-006: Deterministischer Planner, Claude nur für Ideen, Chat und Texte

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Auswahl und Zusammenstellung des Plans erfolgen durch eigene Logik; Claude erzeugt Aktivitäten (als Entwurf), führt den Chat (über Tools, die den Planner nutzen) und plant mehrtägige Ausflüge als Vorschlag mit Links.
- **Begründung:** Kostenlos pro Vorschlag, testbar, nachvollziehbar; funktioniert auch bei deaktivierter KI.

## ADR-007: Kostenschutz in drei Schichten

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Anbieter-Limits + App-Budget-Wächter + Code-Obergrenzen, abgesichert durch Pflicht-Tests (→ Kapitel 8).
- **Begründung:** Kosten dürfen auch bei Bugs oder geleaktem Key nicht über das freigegebene Maß steigen.

## ADR-008: Claude API im MVP, Prompt-Export/Import als Fallback

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Claude API (Sonnet 5.5) für Chat, Ideen und Ausflüge im MVP; zusätzlich Prompt-Export/JSON-Import über das Claude-Abo, aktiv wenn `AI_ENABLED=false` oder Budget erschöpft.
- **Begründung:** Hochrechnung ~4 $/Monat normal, ~19 $ Worst Case; hartes Limit 20 $.
- **Ergänzung (2026-10-09):** Ideen-Generierung ohne Websuche (allgemeine Ideen, echte Orte kommen aus der Ortssuche); gemessen ~1–2 Cent pro Aufruf mit 3 Ideen. Ablehnungen über `fallbacks: "default"`.

## ADR-009: Zugverbindungen über offizielle DB-APIs (nur Direktzüge)

- **Status:** angenommen (2026-10-09), ersetzt den Vorschlag „inoffizielle DB-Schnittstelle“
- **Kontext:** Die inoffizielle bahn.de-/Navigator-Schnittstelle (`db-vendo-client`) wird von der DB aktiv blockiert (`OPS_BLOCKED`); die Maintainer raten ab. Transitous erlaubt nur Open-Source-Projekte, RIS::Stations ist nicht dauerhaft kostenlos, Overpass für Bahnhöfe zu unzuverlässig.
- **Entscheidung:** DB Timetables API (Free) für Fahrpläne und Echtzeit; Bahnhofsliste aus StaDa (Free) als Datei im Repo. Nur Direktverbindungen; Umstiege bleiben Schätzung bzw. Link auf bahn.de.
- **Begründung:** Offiziell, kostenlos, stabil; für Rosenheim → München/Salzburg/Kufstein meist direkt.
- **Risiko:** API im Beta-Status, Horizont gemessen ~18 h voraus und ~6 h zurück (2026-10-12, → Kapitel 11).
- **Ergänzung (2026-10-12):** Verbindungen mit einem Umstieg über eine eigene Suche auf denselben Tafeln; für Dates jenseits des Horizonts voraussichtliche Züge aus einem Referenztag, die gespeicherte Pläne innerhalb des Horizonts durch echte ersetzen. Bundesweite GTFS-Daten mit eigenem Routing wären vollständiger (Busse, beliebig weit voraus), aber Import, Aktualisierung und Routing-Engine sind für zwei Nutzer zu aufwendig.

## ADR-010: Abhängigkeiten mit 7 Tagen Mindestalter

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Neue Pakete/Versionen erst, wenn sie mindestens 7 Tage veröffentlicht sind; exakte Versionen im Lockfile; `npm audit` nach jeder Installation, bei `critical` zurückrollen.
- **Begründung:** Schutz vor kompromittierten Releases (Supply-Chain).

## ADR-011: Chat und Ausflüge ohne serverseitigen Modell-Fallback

- **Status:** angenommen (2026-10-09)
- **Kontext:** Für Sonnet 5.5 empfiehlt Anthropic `fallbacks: "default"` (abgelehnte Anfragen laufen auf einem anderen Modell weiter). In Tool-Loops entstehen dabei zusätzliche Antwortblöcke, die beim nächsten Request korrekt zurückgegeben werden müssen.
- **Entscheidung:** „Ideen generieren“ (einzelner Aufruf) nutzt den Fallback; Chat und Ausflüge (Tool-Loops) nicht. Eine Ablehnung beendet die Anfrage mit verständlicher Meldung.
- **Begründung:** Ablehnungen sind bei Date-Planung praktisch ausgeschlossen; der einfachere Loop ist robuster und leichter zu testen.

## ADR-012: Optionaler exakter Wohnort-Pin

- **Status:** angenommen (2026-10-09)
- **Kontext:** Mit auf ~1 km gerundetem Wohnort sind Fußwege und Route-Links ungenau (z. B. 14 min zum Lokal um die Ecke).
- **Entscheidung:** Im Admin lässt sich der Wohnort per Klick auf die Karte pinnen (ohne Adresseingabe, ohne Geocoding-Dienst). Der Pin wird nur in der eigenen DB gespeichert und für Wegzeiten (lokal berechnet) und Route-Links genutzt. Orts- und Wettersuchen bekommen weiterhin ein ~1-km-Raster. Ein Wechsel der Stadt löscht den Pin.
- **Begründung:** Genaue Wege bei minimalem Datenabfluss; die Hausadresse verlässt die App nur, wenn der Nutzer selbst einen Route-Link öffnet.

## ADR-013: Bewertung mit drei Stufen, für das Date und optional je Programmpunkt

- **Status:** angenommen (2026-10-12)
- **Kontext:** Zwei Nutzer, wenige Dates pro Monat; Bewertungen sollen schnell gehen und trotzdem zeigen, welche Idee gut war.
- **Entscheidung:** 👎 / 👍 / ❤️ statt Sternen. Eine Bewertung für das ganze Date (ein Tipp), Programmpunkte optional; die Date-Bewertung gilt mit halbem Gewicht für alle Punkte ohne eigene Bewertung. Bewertungen sind änderbar und entfernbar; dazu „We didn't go“ und „It was the place“.
- **Begründung:** Bei fünf Sternen landen die meisten Bewertungen bei 4–5, der Unterschied „3 vs. 4“ ist kein verlässliches Signal; drei Stufen sind eindeutig und mit einem Tipp erledigt. Nur das ganze Date zu bewerten würde nicht zeigen, welche Idee es war; nur Punkte zu bewerten kostet zu viele Tipps.
- **Verworfen:** Sterne (1–5), nur Daumen hoch/runter (unterscheidet gut nicht von großartig).

## ADR-014: Lernen über transparentes Scoring statt Machine Learning

- **Status:** angenommen (2026-10-12)
- **Kontext:** Bewertungen sollen Vorschläge verbessern. Erwartet werden < 100 Bewertungen pro Jahr von einem gemeinsamen Account.
- **Entscheidung:** Geglättete Mittelwerte je Aktivität, je Tag und je Wetterlage, mit Zeitverfall, als Faktoren im bestehenden Score. Bei jeder Planung neu aus allen Bewertungen berechnet (reine Funktion in `core/planner`), nichts wird inkrementell gespeichert.
- **Begründung:** Mit so wenigen Daten würde ein ML-Modell Rauschen lernen und wäre nicht nachvollziehbar. Neuberechnung macht Änderungen und Löschungen exakt und ist bei wenigen hundert Zeilen schneller als jede Synchronisation.
- **Verworfen:** ML-Modell (z. B. Regression), inkrementell gespeicherte Tag-Gewichte (Tabelle `tag_weight`, entfernt).
