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

## ADR-009: Zugverbindungen über inoffizielle DB-Schnittstelle (Phase 2)

- **Status:** vorgeschlagen
- **Entscheidung:** Verbindungssuche über die von bahn.de genutzte Schnittstelle mit Filter auf Regionalverkehr; vorher Machbarkeits-Spike. Fallback: Link auf bahn.de.
- **Begründung:** Offizielle DB-API liefert nur Abfahrtstafeln, keine Verbindungssuche.
- **Risiko:** Kann sich jederzeit ändern (→ Kapitel 11).

## ADR-010: Abhängigkeiten mit 7 Tagen Mindestalter

- **Status:** angenommen (2026-10-09)
- **Entscheidung:** Neue Pakete/Versionen erst, wenn sie mindestens 7 Tage veröffentlicht sind; exakte Versionen im Lockfile; `npm audit` nach jeder Installation, bei `critical` zurückrollen.
- **Begründung:** Schutz vor kompromittierten Releases (Supply-Chain).
