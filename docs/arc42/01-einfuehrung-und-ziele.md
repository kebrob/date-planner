# 1. Einführung und Ziele

## Aufgabenstellung

Private Web-App (PWA) für ein Paar, die passende Date-Ideen vorschlägt und daraus einen konkreten Ablaufplan erstellt – damit man nicht mangels Ideen zu Hause bleibt.

Eingaben:

- Zeitfenster (jetzt, später heute, bestimmter Tag, ganzer Tag)
- Budget
- Verkehrsmittel (Deutschlandticket → nur Regionalverkehr, Auto, zu Fuß/Rad)
- Vorlieben (indoor/outdoor, aktiv/chillig, sozial)
- Wetter (automatisch ermittelt)
- Wohnort (Rosenheim, 83026) als Ausgangspunkt

Ausgabe: Ablaufplan mit Uhrzeiten, konkreten Orten, Kosten, Wetterhinweis, Anreise und Links (Google Maps, bahn.de). Auch „zu Hause bleiben“-Dates sind gültige Vorschläge.

## Funktionsumfang nach Phasen

### MVP

- Login für einen gemeinsamen Account per Passkey (Face ID) + Notfall-Passwort
- Admin: Einstellungen (Wohnort, Verkehrsmittel, Budget, Anreise-Routinen), Aktivitäten-Verwaltung, Kosten-/Verbrauchsübersicht
- Aktivitäten erzeugen: manuell, per Claude-Button („10 Ideen generieren“) oder per Prompt-Export/JSON-Import über das Claude-Abo; neue Ideen landen als Entwurf
- Planner: Formular, Planformat abhängig von Zeitfenster (eine Aktivität / Aktivität + Essen / Tagesplan), Neu würfeln (ganz oder einzelner Programmpunkt)
- Wetter (Open-Meteo), Ortssuche (Google Places, Fallback OpenStreetMap)
- Claude-Chat mit Zugriff auf Planner-Funktionen (Tool Use)
- Mehrtägige Ausflüge als Vorschlag mit Links (keine Buchung)
- Plan speichern, Verlauf, Abwechslungslogik
- Kostenschutz für alle kostenpflichtigen APIs (→ [Kapitel 8](08-querschnittliche-konzepte.md#kostenschutz))

### Phase 2

- Bewertungen nach dem Date, lernendes Scoring (Tag-Gewichte), Aktivität sperren
- Zugverbindungen über inoffizielle DB-Schnittstelle (Filter Regionalverkehr), kombiniert mit Anreise-Routinen
- Wetterabhängige Vorlieben

### Phase 3

- Eingebettete Karte, echte Fahrzeiten (Routes)
- Swipe-Matching, Überraschungsmodus
- Kalender-Export (.ics), Date-Tagebuch, Bucket List, saisonale Aktivitäten, lokale Events

## Qualitätsziele

| Priorität | Qualitätsziel                | Bedeutung                                                                    |
| --------- | ---------------------------- | ---------------------------------------------------------------------------- |
| 1         | Kostensicherheit             | Keine unkontrollierten Kosten durch externe APIs, auch nicht bei Bugs        |
| 2         | Vertraulichkeit              | Nur die beiden Nutzer haben Zugriff                                          |
| 3         | Austauschbarkeit             | Externe Dienste ohne Änderung an Planner/Frontend austauschbar               |
| 4         | Brauchbarkeit der Vorschläge | Vorschläge passen zu Wetter, Zeit, Budget und existieren tatsächlich vor Ort |
| 5         | Mobile Bedienbarkeit         | Schnell am Handy nutzbar, installierbar als PWA                              |

## Stakeholder

| Rolle                       | Erwartung                                   |
| --------------------------- | ------------------------------------------- |
| Robert (Entwickler, Nutzer) | Wartbare, günstige App, schnell erweiterbar |
| Partnerin (Nutzerin)        | Einfache Bedienung, gute Vorschläge         |
