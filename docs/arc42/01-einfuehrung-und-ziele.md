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

### MVP (umgesetzt, Stand 2026-10-09)

- Login für einen gemeinsamen Account per Passkey (Face ID) + Notfall-Passwort
- Admin: Einstellungen (Wohnort, Verkehrsmittel, Budget, Anreise-Routinen), Aktivitäten-Verwaltung, Kosten-/Verbrauchsübersicht
- Aktivitäten erzeugen: manuell, per Claude-Button („10 Ideen generieren“) oder per Prompt-Export/JSON-Import über das Claude-Abo; neue Ideen landen als Entwurf
- Planner: Formular, Planformat abhängig von Zeitfenster (eine Aktivität / Aktivität + Essen / Tagesplan), Neu würfeln (ganz oder einzelner Programmpunkt)
- Wetter (Open-Meteo), Ortssuche (Google Places, Fallback OpenStreetMap)
- Claude-Chat mit Zugriff auf Planner-Funktionen (Tool Use)
- Mehrtägige Ausflüge als Vorschlag mit Links (keine Buchung)
- Pläne speichern (mehrere kommende Pläne), bearbeiten, Favoriten, „Plan again“, automatisches Archiv; Abwechslungslogik
- Essen konkret mit 2 Alternativen, optionaler Küchen-Filter
- Kostenschutz für alle kostenpflichtigen APIs (→ [Kapitel 8](08-querschnittliche-konzepte.md#kostenschutz))

### Nach dem MVP umgesetzt (Stand 2026-10-12)

- Karte zur Wahl von Mittelpunkt und Radius, optionaler exakter Wohnort-Pin (ADR-012)
- Zielort zuerst planen, Start bzw. Ende am Zielort („Already there“, „Staying there“)
- Preise der Lokale (Google `priceRange`), Sonnenstand-Ideen (`sunset`, `after_dark`)
- Startseite mit Kacheln („Plan a date“, „Surprise us …“), Wizard (Wann, Wo, Feste Programmpunkte, Wie, Stimmung, Essen)
- Programmpunkte selbst wählen: eigene Ideen oder – auf ausdrücklichen Tipp – Google-Ortssuche, optional zu fester Uhrzeit; Programmpunkt ersetzen mit „Keep the rest“ oder „Re-plan around it“; Suchtreffer als neue Idee speichern (2026-10-12)

### Phase 2 (umgesetzt, Stand 2026-10-12)

- Bewertungen nach dem Date (👎 / 👍 / ❤️ für das ganze Date, optional je Programmpunkt, änderbar, „We didn't go“, „It was the place“) und daraus lernendes Scoring inkl. Tag-Gewichten je Wetterlage (ADR-013, ADR-014)
- Aktivität sperren (Admin; nach zwei 👎 schlägt die App das Sperren vor)
- Zugverbindungen: Direktzüge und Verbindungen mit einem Umstieg, voraussichtliche Zeiten für Dates mehr als einen Tag voraus, Aktualisierung gespeicherter Pläne (ADR-009)
- Wetterabhängige Vorlieben: Wetter je Programmpunkt, Standard-Vorlieben je Wetterlage, Hinweis mit „Tauschen“ bei gespeicherten Plänen
- Getrennte Limits für bezahlte und kostenlose Ortssuchen

### Phase 3

| Thema                                 | Status                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Eingebettete Karte                    | teilweise – Karte zur Orts-/Radiuswahl; offen: Karte mit Plan und Route   |
| Echte Fahrzeiten (Routes)             | offen – Wege sind Schätzungen                                             |
| Swipe-Matching                        | offen                                                                     |
| Überraschungsmodus                    | teilweise – Kachel „Surprise us …“ (Sofortplan mit Standardwerten)        |
| Saisonale Aktivitäten                 | teilweise – Saison-Filter je Aktivität; offen: datierte Saison-Ereignisse |
| Kalender-Export (.ics), Date-Tagebuch | offen                                                                     |
| Bucket List, lokale Events            | offen                                                                     |

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
