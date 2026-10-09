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
- **Risiko:** API im Beta-Status, Horizont ~1 Tag (→ Kapitel 11).

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
