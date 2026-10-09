# 8. Querschnittliche Konzepte

## Kostenschutz

Gilt für alle kostenpflichtigen Anbieter (Claude API, Google Places). Einrichtung der Anbieter-Limits und alle App-Limits: [Runbook Kostenlimits](../betrieb/kostenlimits.md).

### Drei Schutzschichten

| Schicht               | Mechanismus                                                                                                                | Greift bei                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1. Anbieter           | Anthropic Workspace-Spend-Limit (20 $/Monat), Google Quotas (30/Tag)                                                       | App komplett defekt, Key geleakt          |
| 2. App-Budget-Wächter | Jeder kostenpflichtige Aufruf läuft über `guard`: vorher reservieren, nachher tatsächlichen Verbrauch buchen (`api_usage`) | Viele einzelne, für sich korrekte Aufrufe |
| 3. Code-Obergrenzen   | Max. Iterationen, max. Suchen, Timeouts, begrenzte Retries                                                                 | Endlosschleifen, Retry-Stürme             |

### Regeln für den Code

1. **Kein kostenpflichtiger Aufruf ohne Wächter.** Adapter für Claude und Google erhalten den HTTP-Client nur über den Wächter; ein direkter Aufruf ist strukturell nicht vorgesehen.
2. **Jede Schleife hat eine feste Obergrenze.** Kein `while (true)`, keine Rekursion über externe Aufrufe. Tool-Loop: `AI_MAX_TOOL_ITERATIONS`, Ortsabfragen: `PLACES_MAX_LOOKUPS_PER_PLAN`.
3. **Jeder Claude-Request hat `max_tokens`, Timeout und bei Websuche `max_uses`.**
4. **Retries begrenzt:** SDK-Retries max. 2; keine eigenen Retry-Schleifen um kostenpflichtige Aufrufe.
5. **Circuit Breaker:** Nach 5 aufeinanderfolgenden Fehlern eines Anbieters 10 Minuten Pause statt weiterer Versuche.
6. **Notbremse:** `PAID_CALLS_PER_MINUTE` über alle Anbieter – fängt auch Schleifen im Frontend ab (z. B. fehlerhafter React-Effect).
7. **Kostenpflichtige Aufrufe nur durch explizite Nutzeraktion** (Button/Absenden), nie automatisch beim Rendern, Polling oder Hintergrund-Job.
8. **Reservierung ist atomar** (eine DB-Transaktion), damit parallele Anfragen das Limit nicht gemeinsam überschreiten.
9. **Fail closed:** Ist der Verbrauch nicht ermittelbar (DB-Fehler), wird der Aufruf abgelehnt.

### Pflicht-Tests

| Test                                             | Erwartung                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Claude-Mock liefert immer einen Tool-Aufruf      | Loop endet nach `AI_MAX_TOOL_ITERATIONS`, Anzahl API-Aufrufe = Limit                                             |
| Tagesbudget / Monatsbudget erreicht              | Kein weiterer Aufruf an den Mock, verständliche Fehlermeldung                                                    |
| Parallele Reservierungen knapp unter Limit       | Insgesamt nie über Limit                                                                                         |
| Jeder Claude-Request (Chat, Generieren, Ausflug) | enthält `max_tokens`; mit Websuche auch `max_uses` ≤ konfiguriertem Wert                                         |
| Places-Mock liefert nie Treffer                  | Planner beendet mit ≤ `PLACES_MAX_LOOKUPS_PER_PLAN` Abfragen und liefert trotzdem einen Plan (Zu-Hause-Fallback) |
| Places-Tageslimit erreicht                       | Kein `fetch` an Google, Umschalten auf Fallback                                                                  |
| Mehr als `PAID_CALLS_PER_MINUTE` Aufrufe         | Überzählige werden abgelehnt                                                                                     |
| 5 Fehler in Folge                                | Circuit Breaker offen, kein weiterer Aufruf für 10 Minuten                                                       |
| `AI_ENABLED=false`                               | Kein Claude-Aufruf, UI zeigt Import-Fallback                                                                     |
| DB nicht erreichbar beim Reservieren             | Aufruf wird abgelehnt (fail closed)                                                                              |

## Sicherheit

- **Ein Account**, keine Registrierungsseite. Passkeys können nur mit gültiger Session hinzugefügt werden; auf einem neuen Gerät erfolgt der erste Login per Notfall-Passwort.
- **Passkeys** (WebAuthn) für alle Geräte; **Notfall-Passwort** (scrypt-Hash in Environment-Variable) als Fallback.
- **Sessions:** zufälliges Token, nur Hash in der DB; Cookie `httpOnly`, `Secure`, `SameSite=Lax`; Laufzeit 30 Tage; Logout invalidiert die Session.
- **Login-Rate-Limit:** max. 5 Fehlversuche pro 15 Minuten, danach Sperre.
- **Alle Seiten und APIs** außer Login hinter der Session-Prüfung (zentral in der Middleware).
- **Kein Indexieren:** `robots.txt` Disallow + `noindex`.
- **Secrets** nur serverseitig; Claude- und Google-Keys nie im Browser.

## Datenschutz

- An Such- und Wetterdienste gehen nur Stadt bzw. auf ~1 km gerundete Koordinaten. Ein optionaler **Wohnort-Pin** (Admin, per Klick auf die Karte, keine Adresseingabe) bleibt in der eigenen DB und wird nur für Wegzeiten und Route-Links genutzt, die der Nutzer selbst öffnet (ADR-012).
- Keine personenbezogenen Daten, Tokens oder vollständigen Request-Bodies in Logs.
- Google-Places-Daten: dauerhaft gespeichert wird nur die Place-ID und der Anzeigename im gespeicherten Plan; weitere Ortsdaten werden bei Bedarf neu abgefragt bzw. nur kurzfristig zwischengespeichert (Google-Nutzungsbedingungen).

## Austauschbarkeit (Ports & Adapters)

- Jeder externe Dienst hat ein Interface in `ports/` mit eigenen, anbieterneutralen Typen.
- Adapter übersetzen Anbieter-Datenformate in diese Typen; nichts außerhalb eines Adapters kennt Anbieter-Formate.
- Auswahl per Environment-Variable (z. B. `PLACES_PROVIDER=google|osm`) in einer zentralen Factory.
- OpenStreetMap-Kacheln werden mit `Referrer-Policy: strict-origin-when-cross-origin` geladen (OSM verlangt einen Referer); app-weit gilt `same-origin`.
- Für Ortstypen mit Google-Entsprechung (Park, Kino, Minigolf, Bowling, Restaurant …) sucht Google zusätzlich per `includedType` + `strictTypeFiltering` – sonst liefert z. B. „Park“ auch Skateparks. Ohne Entsprechung (Escape Room, Bouldern, Therme) entscheidet die Textsuche.
- Google-Textsuche ist per `locationRestriction` (Rechteck um den Suchkreis) auf das Suchgebiet beschränkt, sonst liefert Google bekannte Orte weit außerhalb.
- Kostenlose Ideen (Park, Bücherei, Kirche …) werden zuerst über OpenStreetMap gesucht, um Google-Kontingent zu sparen. Die öffentliche Overpass-API ist oft langsam (gemessen bis 18 s) oder antwortet mit 429: Zeitlimit 4 s, Suchradius max. 15 km, nach einem Fehler wird OSM 10 min übersprungen (Schutzschalter) und Google antwortet direkt.
- Für jeden Port gibt es eine gemeinsame Contract-Test-Suite, die alle Adapter erfüllen müssen.

## Planner-Logik

1. **Harte Filter:** Budget, Verkehrsmittel, Wetter-Eignung, Dauer passt ins Zeitfenster, Tageszeit/Saison, gesperrte Aktivitäten.
2. **Score:** Basis + Übereinstimmung mit Vorlieben (je passender Stimmung +2, eine passende Idee wiegt also dreifach) − Abwechslungs-Abzug (abklingend mit Tagen seit letzter Durchführung/Vorschlag); Phase 2 zusätzlich Bewertungs-Bonus und gelernte Tag-Gewichte.
3. **Gewichteter Zufall** über die Scores (seedbar für Tests).
4. **Planformat** aus Zeitfenster (< 3 h eine Aktivität, 3–6 h zwei Programmpunkte, > 6 h Tagesplan), manuell überschreibbar. **Essen** per Filter (Auto / kein Essen / Snack / Mahlzeit); bei „Auto“ zufällige Vorlage inkl. Reihenfolge, Mahlzeiten nur ab 40 € Budget. Passt gewünschtes Essen nicht, gibt es einen Hinweis.
5. **Route statt Zickzack:** Erster Ort rund um Wohnort bzw. optionalen Zielort (Geocoding über Open-Meteo). Mittelpunkt und Radius über eine Karte (Leaflet + OpenStreetMap-Kacheln, kostenlos) wählbar: Zuhause, gesuchte Stadt oder Klick auf die Karte; Radius frei per Regler (1–150 km); bei „Fit to time“ darf die Anreise etwa ein Viertel des Zeitfensters dauern (15–120 min), umgerechnet über ein grobes Durchschnittstempo je Verkehrsmittel. Jeder weitere Ort liegt entweder nah am vorherigen (Auto 20 km, ÖPNV 10 km, Rad 6 km, zu Fuß 2 km) oder im Korridor Richtung Ziel (Zielort, danach Zuhause) mit max. 25 % Umweg. Mit gewähltem Zielort beginnt das Date immer dort; ohne Zielort wird meist am aktuellen Ort gesucht, in ~25 % der Fälle entlang des Wegs. **Wege** je Abschnitt mit Verkehrsmittel (zu Fuß < 1,2 km, ÖPNV < 25 km, sonst Zug bzw. Auto) und Zeit; Anreise-Routine nur ab Zuhause.
6. **Budget und Zeit einteilen:** Für noch geplante Punkte wird Budget (Mahlzeit ~25 €, Snack ~8 €) und Zeit (Programmpunkt ~75 min, Mahlzeit ~90 min, Snack ~40 min) zurückgehalten; günstigere Ideen werden relativ zum Restbudget bevorzugt.
7. **Lange Tage auffüllen:** Bleiben vor der Heimfahrt ≥ 90 min frei, werden weitere Punkte ergänzt (max. 5 insgesamt), bevorzugt kostenlose (Bücherei, Park, Markt, Kirche …).
8. **Kein Heimfahren zwischendurch:** Unterwegs sind Aktivitäten zu Hause nur als letzter geplanter Punkt erlaubt; danach darf zu Hause aufgefüllt werden.
9. **Budget überziehen (immer aktiv):** Jeder Punkt wird zuerst im Budget gesucht; nur wenn sonst nichts passt, darf bis 50 % über Budget geplant werden. Der Mehrbetrag wird angezeigt.
10. **Rückfall ohne Rücklage:** Passt ein Punkt nur nicht, weil Zeit/Geld für spätere Punkte reserviert ist, wird er ohne Rücklage geplant (lieber ein Punkt als keiner). Gefundene Orte werden pro Planung zwischengespeichert, Wiederholungen kosten keine neuen Abfragen. Vor jeder Ortsabfrage wird geprüft, ob die Idee selbst am günstigsten Punkt des Suchgebiets in Zeit und Budget passt; sonst wird sie ohne Abfrage übersprungen (wichtig bei weit entfernten Zielorten).
11. **Sonnenstand:** Ideen mit Tag `sunset` müssen den Sonnenuntergang einschließen, `after_dark` beginnen ≥ 45 min danach; dafür darf bis 90 min gewartet werden. Sonnenuntergang wird lokal astronomisch berechnet (keine API, jedes Datum).
12. **Neu würfeln:** ganzer Plan oder ein Programmpunkt (Aufbau des bisherigen Plans bleibt erhalten); abgelehnte Aktivitäten werden für die laufende Planung ausgeschlossen.

## Essen

- Mahlzeiten und Snacks sind eigene Slot-Typen; optionaler Filter **Cuisine** (Bavarian, Italian, Asian, Burger, Mexican, Greek, Indian, Veggie) beschränkt Mahlzeiten auf passend getaggte Aktivitäten.
- **Kosten:** Kennt Google eine Preisspanne pro Person (`priceRange`, gleiche Enterprise-SKU wie Bewertung, daher ohne Mehrkosten), zählt deren Mitte × 2; sonst die Mitte der Kostenspanne der Aktivität. Nur für Essen, da Google-Preise bei anderen Orten nicht vergleichbar sind.
- Jeder Punkt mit Ort zeigt bis zu **2 Alternativen** aus derselben Ortssuche (ohne Zusatzabfrage), die ebenfalls ins Zeitfenster passen und geöffnet sind; Antippen tauscht den Ort und berechnet Zeiten/Wege neu.

## Ideen generieren (Admin)

- **Claude API:** ein einzelner Aufruf (Sonnet 5.5, `effort: medium`, max. 8.000 Output-Tokens, keine Websuche) mit strukturierter Ausgabe (Zod-Schema); nur gültige Ortstypen/Küchen/Tags möglich. Ergebnis landet als **Entwurf** und wird erst nach Freigabe vorgeschlagen.
- **Ablehnungen:** `fallbacks: "default"` lässt eine abgelehnte Anfrage serverseitig auf einem passenden Modell wiederholen. Weil das ein teureres Modell sein kann, reserviert der Budget-Wächter vorab den höchsten Listenpreis; abgerechnet wird der tatsächliche Verbrauch.
- **Ohne API:** Prompt-Export für die Claude-App (Abo) und JSON-Import; gleiche Validierung, Duplikate (Titel) werden übersprungen.
- An Claude geht nur der Ortsname des Wohnorts und die Liste vorhandener Ideen-Titel.

## Claude-Chat

- Teil des Reiters „Plan“: oben Freitext an Claude, darunter aufklappbar „Plan with filters“ (ohne KI). Beide Wege liefern den Plan in denselben Ergebnisbereich (Neu würfeln, Alternativen, Speichern).

- Tool-Loop (max. `AI_MAX_TOOL_ITERATIONS` Runden, max. `AI_MAX_WEB_SEARCHES_CHAT` Websuchen, 4.000 Output-Tokens, `effort: low`) mit eigenen Werkzeugen: `plan_date` (nutzt den Planner, Ergebnis als Karte mit „Speichern“), `get_weather`, `find_ideas`, `save_idea` (nur als Entwurf), `list_plans`.
- Werkzeug-Eingaben sind strikt (JSON-Schema, alle Felder Pflicht) und werden vor Ausführung zusätzlich mit Zod geprüft.
- Pro Nachricht werden nur die letzten 12 Nachrichten mitgeschickt (begrenzt Input-Tokens). Gespeichert wird nur Text; Plankarten enthalten Ortsdaten und werden nicht dauerhaft abgelegt.
- Antworten als Klartext in der Sprache der letzten Nachricht; Links werden nur als `https`-Links klickbar gemacht, kein HTML vom Modell.
- Claude übersetzt Wünsche in Stimmungen (cozy → chill, auch ein kurzer Spaziergang bis ~1 h; sporty → active …).
- Fehlen Budget oder Verkehrsmittel, fragt Claude einmal kurz nach (mit Standardwerten als Vorschlag). Ausdrücklich gewünschte Stopps (z. B. Shopping) gehen als `must_include` an den Planner; sie werden zuerst eingeplant (eigene Slots, Warnung falls nicht möglich).
- Interne Fehler (SQL, Hosts, Stacktraces) werden nie an Claude weitergegeben, sondern nur geloggt; Claude erhält eine allgemeine Meldung.
- „Edit“ an der letzten eigenen Nachricht: entfernt Frage und Antwort aus dem Verlauf und legt den Text zum Nachbessern wieder ins Eingabefeld.

## Mehrtägige Ausflüge

- Ein Tool-Loop mit serverseitiger Websuche (max. `AI_MAX_WEB_SEARCHES_TRIP`) und max. 4 Runden; Claude liefert das Ergebnis über das Werkzeug `submit_trip_plan`, dessen Eingabe gegen ein Schema geprüft wird (fehlerhafte Einreichung → Claude bekommt den Fehler und korrigiert). Nur `https`-Links aus Suchergebnissen.
- Nur Vorschläge – keine Buchung; Hinweis in der Oberfläche.
- Gemessen: ~20 Cent für ein Wochenende.

## Gespeicherte Pläne

- **Upcoming:** gespeicherte Pläne mit Datum in der Zukunft, mehrere parallel; auf der Startseite als Karten, Detailseite `/plans/[id]`.
- **Bearbeiten** (nur kommende Pläne): Punkt neu würfeln, entfernen, Alternative wählen, Datum ändern, Notiz. Änderungen planen mit festgehaltenen Punkten neu; passt ein Ort nicht mehr (z. B. geschlossen), wird er ersetzt und ein Hinweis angezeigt.
- **Ansehen kostet nichts:** Plan, Orte, Wege kommen aus der DB; nur das Wetter (kostenlos) wird bei kommenden Plänen aktualisiert.
- **Past:** Status ergibt sich aus dem Datum (kein Löschen; Verlauf dient Abwechslung und späteren Bewertungen). Löschen ist manuell möglich.
- **Favoriten:** Stern pro Plan; **Plan again** übernimmt Punkte und Orte für ein neues Datum.
- **Archivierung (Google-Nutzungsbedingungen):** Nach dem Datum werden bei Google-Orten nur Place-ID und Name behalten, Koordinaten/Adresse/Öffnungszeiten/Alternativen sowie alle Routen-Links (enthalten Koordinaten) entfernt. „Plan again“ lädt archivierte Google-Orte per Place Details neu (1 Abfrage pro Ort über den Budget-Wächter). OpenStreetMap-Daten bleiben vollständig erhalten.

## Oberfläche

- Heller, schlichter Stil (Apple-ähnlich): Farb-Tokens in `src/app/globals.css` (paper, ink, butter, cream …), kein Dark Mode.
- Mobil: Tab-Leiste unten (Home, Our dates, Trips); Desktop: Navigation oben.
- Startseite: Suchfeld = Frage an Claude (öffnet den Chat), Kacheln „Plan a date“ (Wizard) und „Surprise us tonight“ (Sofortplan), dazu anstehende Dates und Ideen für heute Abend.
- Wizard `/new` in fünf Schritten (Wann, Wo, Wie, Stimmung, Essen); jeder Schritt überspringbar, danach der Plan.
- Radius „Fit to time“ statt „Auto“, damit es nicht mit dem Verkehrsmittel Auto verwechselt wird.

## Tests

- **Unit:** `core/planner` (Filter, Scoring, Ablauf, seedbarer Zufall), `guard`.
- **Contract:** je Port für alle Adapter, mit aufgezeichneten Beispielantworten (keine Live-Aufrufe in CI).
- **Integration:** Route Handlers mit Test-Datenbank und gemockten Adaptern.
- Externe APIs werden in Tests **nie** live aufgerufen.
