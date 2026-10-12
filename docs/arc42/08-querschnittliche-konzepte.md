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
2. **Jede Schleife hat eine feste Obergrenze.** Kein `while (true)`, keine Rekursion über externe Aufrufe. Tool-Loop: `AI_MAX_TOOL_ITERATIONS`, Ortsabfragen: `PLACES_MAX_LOOKUPS_PER_PLAN` (bezahlt) + `PLACES_MAX_FREE_LOOKUPS_PER_PLAN` (kostenlose Ideen).
3. **Jeder Claude-Request hat `max_tokens`, Timeout und bei Websuche `max_uses`.** Tool-Loop-Aufrufe werden gestreamt (erlaubt größere `max_tokens`, z. B. 32.000 für Ausflüge).
4. **Retries begrenzt:** SDK-Retries max. 2; keine eigenen Retry-Schleifen um kostenpflichtige Aufrufe. Weil das SDK auch Timeouts wiederholt, hat jede Anfrage eine **Frist unter dem Funktionslimit** (Chat und Ideen 105 s bei 120 s, Ausflüge 260 s bei 300 s), die alle Versuche zusammen begrenzt. Sonst bricht die Plattform die Funktion ab, bevor Ergebnis und Abrechnung gespeichert sind.
5. **Circuit Breaker:** Nach 5 aufeinanderfolgenden Fehlern eines Anbieters 10 Minuten Pause statt weiterer Versuche.
6. **Notbremse:** `PAID_CALLS_PER_MINUTE` über alle Anbieter – fängt auch Schleifen im Frontend ab (z. B. fehlerhafter React-Effect).
7. **Kostenpflichtige Aufrufe nur durch explizite Nutzeraktion** (Button/Absenden), nie automatisch beim Rendern, Polling oder Hintergrund-Job.
8. **Reservierung ist atomar** (eine DB-Transaktion), damit parallele Anfragen das Limit nicht gemeinsam überschreiten.
9. **Fail closed:** Ist der Verbrauch nicht ermittelbar (DB-Fehler), wird der Aufruf abgelehnt.
10. **Bezahltes bleibt erhalten:** Scheitert nach einem erfolgreichen Aufruf nur die Abrechnung, wird das Ergebnis trotzdem geliefert (die Reservierung bleibt mit der höheren Schätzung stehen). Wird im Tool-Loop eine spätere Runde abgelehnt oder ist die Frist erreicht, liefert der Loop die bisherigen Runden (Status `interrupted`) statt eines Fehlers.
11. **Prompt Caching** im Tool-Loop: System-Prompt, Werkzeuge und bisheriger Verlauf werden in jeder Runde erneut gesendet und deshalb gecacht; die Reservierung rechnet mit dem Cache-Schreibpreis.

### Pflicht-Tests

| Test                                                     | Erwartung                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Claude-Mock liefert immer einen Tool-Aufruf              | Loop endet nach `AI_MAX_TOOL_ITERATIONS`, Anzahl API-Aufrufe = Limit                                             |
| Tagesbudget / Monatsbudget erreicht                      | Kein weiterer Aufruf an den Mock, verständliche Fehlermeldung                                                    |
| Parallele Reservierungen knapp unter Limit               | Insgesamt nie über Limit                                                                                         |
| Jeder Claude-Request (Chat, Generieren, Ausflug)         | enthält `max_tokens`; mit Websuche auch `max_uses` ≤ konfiguriertem Wert                                         |
| Places-Mock liefert nie Treffer                          | Planner beendet mit ≤ `PLACES_MAX_LOOKUPS_PER_PLAN` Abfragen und liefert trotzdem einen Plan (Zu-Hause-Fallback) |
| Kostenlose Ideen antworten über Google (OSM ausgefallen) | Zählen zum bezahlten Limit; danach keine weiteren kostenlosen Suchen über Google                                 |
| Places-Tageslimit erreicht                               | Kein `fetch` an Google, Umschalten auf Fallback                                                                  |
| Mehr als `PAID_CALLS_PER_MINUTE` Aufrufe                 | Überzählige werden abgelehnt                                                                                     |
| 5 Fehler in Folge                                        | Circuit Breaker offen, kein weiterer Aufruf für 10 Minuten                                                       |
| `AI_ENABLED=false`                                       | Kein Claude-Aufruf, UI zeigt Import-Fallback                                                                     |
| DB nicht erreichbar beim Reservieren                     | Aufruf wird abgelehnt (fail closed)                                                                              |

## Sicherheit

- **Ein Account**, keine Registrierungsseite. Passkeys hinzufügen oder entfernen geht nur mit einer Anmeldung, die höchstens 10 Minuten alt ist (ein gestohlenes Session-Cookie reicht nicht, um sich dauerhaft Zugang zu verschaffen); auf einem neuen Gerät erfolgt der erste Login per Notfall-Passwort.
- **Passkeys** (WebAuthn) für alle Geräte; **Notfall-Passwort** (scrypt-Hash in Environment-Variable) als Fallback.
- **Sessions:** zufälliges Token, nur Hash in der DB; Cookie `httpOnly`, `Secure`, `SameSite=Lax`; Laufzeit 30 Tage; Logout invalidiert die Session. Eine per Passkey begonnene Session endet, wenn dieser Passkey entfernt wird; „Sign out on all devices“ beendet alle. Abgelaufene Sessions und Login-Versuche älter als 24 h werden beim nächsten Login gelöscht.
- **Login-Rate-Limit:** max. 5 Fehlversuche pro IP und 15 Minuten; zusätzlich max. 20 Fehlversuche insgesamt, aber nur für das Notfall-Passwort (Passkeys sind nicht erratbar – eine globale Sperre würde nur Aussperren ermöglichen). Ein Versuch wird vor der Prüfung als Fehlversuch gezählt (unter DB-Lock) und erst bei Erfolg umgeschrieben, damit parallele Anfragen das Limit nicht umgehen. Fehlt die Challenge (abgelaufen oder verdrängt), zählt der Versuch nicht als Fehlversuch. Die IP kommt nur auf Vercel aus den Forwarding-Headern; anderswo teilen sich alle Anfragen einen Zähler. Höchstens 200 offene Passkey-Challenges; darüber fallen die ältesten weg (statt neue abzulehnen – sonst könnte jeder per Schleife alle Passkey-Logins blockieren).
- **Alle Seiten, Server Actions und APIs** außer Login prüfen die Session selbst (`requireSession`). Der Proxy (`src/proxy.ts`) prüft nur, ob ein Session-Cookie existiert, und leitet sonst zum Login; ohne Login erreichbar sind nur die exakt gelisteten öffentlichen Dateien (Icons, Manifest, `robots.txt`).
- **Eingaben vom Client** werden serverseitig geprüft (Zod), auch ein zu speichernder Plan samt Orten und Links (nur `https`, Website `http(s)`).
- **Kein Indexieren:** `robots.txt` Disallow + `noindex`.
- **Secrets** nur serverseitig; Claude- und Google-Keys nie im Browser.

## Datenschutz

- An Such- und Wetterdienste gehen nur Stadt bzw. auf ~1 km gerundete Koordinaten. Ein optionaler **Wohnort-Pin** (Admin, per Klick auf die Karte, keine Adresseingabe) bleibt in der eigenen DB und wird nur für Wegzeiten und Route-Links genutzt, die der Nutzer selbst öffnet (ADR-012).
- Keine personenbezogenen Daten, Tokens oder vollständigen Request-Bodies in Logs. Fehler werden nur mit Klasse und Code geloggt (`src/lib/result.ts`), weil Meldungen fehlgeschlagener Datenbankabfragen deren Parameter enthalten (Notizen, Wohnort).
- Google-Places-Daten: dauerhaft gespeichert wird nur die Place-ID und der Anzeigename im gespeicherten Plan; weitere Ortsdaten werden bei Bedarf neu abgefragt bzw. nur kurzfristig zwischengespeichert (Google-Nutzungsbedingungen).

## Austauschbarkeit (Ports & Adapters)

- Jeder externe Dienst hat ein Interface in `ports/` mit eigenen, anbieterneutralen Typen.
- Adapter übersetzen Anbieter-Datenformate in diese Typen; nichts außerhalb eines Adapters kennt Anbieter-Formate.
- Auswahl per Environment-Variable (z. B. `PLACES_PROVIDER=google|osm`) in einer zentralen Factory.
- OpenStreetMap-Kacheln werden mit `Referrer-Policy: strict-origin-when-cross-origin` geladen (OSM verlangt einen Referer); app-weit gilt `same-origin`.
- Für Ortstypen mit Google-Entsprechung (Park, Kino, Minigolf, Bowling, Restaurant …) sucht Google zusätzlich per `includedType` + `strictTypeFiltering` – sonst liefert z. B. „Park“ auch Skateparks. Ohne Entsprechung (Escape Room, Bouldern, Therme) entscheidet die Textsuche.
- Google-Textsuche ist per `locationRestriction` (Rechteck um den Suchkreis) auf das Suchgebiet beschränkt, sonst liefert Google bekannte Orte weit außerhalb.
- Kostenlose Ideen (Park, Bücherei, Kirche …) werden zuerst über OpenStreetMap gesucht, um Google-Kontingent zu sparen; sie haben ein eigenes Limit pro Plan, damit lange Tage nicht am bezahlten Limit scheitern. Die öffentliche Overpass-API ist oft langsam (gemessen bis 18 s) oder antwortet mit 429: Zeitlimit 4 s, Suchradius max. 15 km, nach einem Fehler wird OSM 10 min übersprungen (Schutzschalter) und Google antwortet direkt.
- Jeder Adapter hat eigene Tests mit aufgezeichneten Beispielantworten (`src/adapters/*.test.ts`); eine gemeinsame Contract-Test-Suite je Port gibt es nicht.

## Planner-Logik

1. **Harte Filter:** Budget, Verkehrsmittel, Wetter-Eignung (für die Stunden des jeweiligen Programmpunkts, nicht das ganze Zeitfenster), Dauer passt ins Zeitfenster, Tageszeit/Saison, gesperrte Aktivitäten.
2. **Score:** Basis + Übereinstimmung mit Vorlieben (je passender Stimmung +2, eine passende Idee wiegt also dreifach) + gelernte Tag-Gewichte (allgemein und für die erwartete Wetterlage, zusammen max. ±1,5) − Abwechslungs-Abzug (abklingend mit Tagen seit letzter Durchführung/Vorschlag; bei geliebten Ideen schwächer). Das Ergebnis wird mit dem Bewertungsfaktor der Aktivität (geliebt bis ×2,8, abgelehnt bis ×0,35), einem kleinen Bonus für noch nie gemachte Ideen (×1,15) und dem Wetterfaktor multipliziert (→ Wetter).
3. **Gewichteter Zufall** über die Scores (seedbar für Tests).
4. **Planformat** aus Zeitfenster (< 3 h eine Aktivität, 3–6 h zwei Programmpunkte, > 6 h Tagesplan), manuell überschreibbar. **Essen** per Filter (Auto / kein Essen / Snack / Mahlzeit); bei „Auto“ zufällige Vorlage inkl. Reihenfolge, Mahlzeiten nur ab 40 € Budget. Passt gewünschtes Essen nicht, gibt es einen Hinweis.
5. **Route statt Zickzack:** Erster Ort rund um Wohnort bzw. optionalen Zielort (Geocoding über Open-Meteo). Mittelpunkt und Radius über eine Karte (Leaflet + OpenStreetMap-Kacheln, kostenlos) wählbar: Zuhause, gesuchte Stadt oder Klick auf die Karte; Radius frei per Regler (1–150 km); bei „Fit to time“ darf die Anreise etwa ein Viertel des Zeitfensters dauern (15–120 min), umgerechnet über ein grobes Durchschnittstempo je Verkehrsmittel. Jeder weitere Ort liegt entweder nah am vorherigen (Auto 20 km, ÖPNV 10 km, Rad 6 km, zu Fuß 2 km) oder im Korridor Richtung Ziel (Zielort, danach Zuhause) mit max. 25 % Umweg. Mit gewähltem Zielort beginnt das Date immer dort; ohne Zielort wird meist am aktuellen Ort gesucht, in ~25 % der Fälle entlang des Wegs. **Wege** je Abschnitt mit Verkehrsmittel (zu Fuß < 1,2 km, ÖPNV < 25 km, sonst Zug bzw. Auto) und Zeit; Anreise-Routine nur ab Zuhause.
6. **Budget und Zeit einteilen:** Für noch geplante Punkte wird Budget (Mahlzeit ~25 €, Snack ~8 €) und Zeit (Programmpunkt ~75 min, Mahlzeit ~90 min, Snack ~40 min) zurückgehalten; günstigere Ideen werden relativ zum Restbudget bevorzugt.
7. **Lange Tage auffüllen:** Bleiben vor der Heimfahrt ≥ 90 min frei, werden weitere Punkte ergänzt (max. 5 insgesamt), bevorzugt kostenlose (Bücherei, Park, Markt, Kirche …).
8. **Kein Heimfahren zwischendurch:** Unterwegs sind Aktivitäten zu Hause nur als letzter geplanter Punkt erlaubt; danach darf zu Hause aufgefüllt werden.
9. **Budget überziehen (immer aktiv):** Jeder Punkt wird zuerst im Budget gesucht; nur wenn sonst nichts passt, darf bis 50 % über Budget geplant werden. Der Mehrbetrag wird angezeigt.
10. **Rückfall ohne Rücklage:** Passt ein Punkt nur nicht, weil Zeit/Geld für spätere Punkte reserviert ist, wird er ohne Rücklage geplant (lieber ein Punkt als keiner). Gefundene Orte werden pro Planung zwischengespeichert, Wiederholungen kosten keine neuen Abfragen. Vor jeder Ortsabfrage wird geprüft, ob die Idee selbst am günstigsten Punkt des Suchgebiets in Zeit und Budget passt; sonst wird sie ohne Abfrage übersprungen (wichtig bei weit entfernten Zielorten).
11. **Sonnenstand:** Ideen mit Tag `sunset` müssen den Sonnenuntergang einschließen, `after_dark` beginnen ≥ 45 min danach; dafür darf bis 90 min gewartet werden. Sonnenuntergang wird lokal astronomisch berechnet (keine API, jedes Datum).
12. **Abgelehnte Orte:** Orte, die bei einer Bewertung als Problem markiert wurden, bleiben möglich, rangieren aber ganz hinten (×0,02).
13. **Neu würfeln:** ganzer Plan oder ein Programmpunkt (Aufbau des bisherigen Plans bleibt erhalten); abgelehnte Aktivitäten werden für die laufende Planung ausgeschlossen.

## Wetter

- **Je Programmpunkt:** Der Planner bekommt die stündliche Vorhersage und prüft jede Idee für die Stunden, in denen sie stattfände (Regen am Nachmittag sperrt Minigolf am Vormittag nicht). Ohne stündliche Daten gilt die Zusammenfassung des ganzen Zeitfensters.
- **Wetterlagen** aus Open-Meteo (Temperatur, Niederschlag, Bewölkung, Wind, Schnee): `rain`, `snow`, `sunny` (trocken, Bewölkung < 40 %), `hot` (≥ 27 °C), `cold` (≤ 6 °C), `windy` (≥ 40 km/h).
- **Standard-Vorlieben** (Faktor auf den Score, im Code festgelegt): Regen → indoor/zu Hause ×1,5, outdoor ×0,4; Sonne → outdoor ×1,5, indoor ×0,75, Biergarten/Aussichtspunkt/Park/See ×1,3; Hitze → Badesee/Schwimmen/Eis ×1,8, aktiv ×0,7; Kälte → Therme/Café ×1,5, outdoor ×0,6; Schnee → indoor ×1,3, outdoor ×0,7; Wind → outdoor ×0,8. Gelernte Tag-Gewichte je Wetterlage kommen hinzu (→ Bewertungen).
- **Gespeicherte Pläne:** Beim Ansehen wird das Wetter aktualisiert; passt ein Punkt nicht mehr (Regen/Schnee bei outdoor, zu kalt/warm), erscheint ein Hinweis mit „Swap for something else“ (Neu würfeln dieses Punkts).

## Bewertungen und Lernen

- **Skala:** 👎 Not for us / 👍 Good / ❤️ Loved it (ADR-013). Bewertet wird das ganze Date, optional jeder Programmpunkt. Erneutes Antippen entfernt die Bewertung; nicht bewerten ist erlaubt und zählt nie negativ.
- **Ab Beginn des Dates** bewertbar. Die Startseite zeigt 14 Tage lang einen Hinweis für das letzte Date ohne jede Bewertung (weder Date noch Punkt); „Skip“ blendet ihn aus, danach verschwindet er ohne Erinnerung. Über „Our dates“ bleibt Bewerten jederzeit möglich; ohne Bewertung zählt ein Date nur für die Abwechslung, nie negativ. Die Wetterlage wird nur bis 90 Tage zurück erfasst.
- **„We didn't go“** nimmt das Date aus Abwechslung (`suggestion_log.accepted`) und Lernen heraus; rückgängig machbar.
- **„It was the place, not the idea“** (nur bei 👎 mit Ort): Der Ort wird gemieden, die Idee selbst nicht abgewertet.
- **Lernen** (ADR-014, `core/planner/learning.ts`): bei jeder Planung neu aus allen Bewertungen berechnet, dadurch wirken Änderungen und Löschungen sofort und ohne Reste. Werte: 👎 −1, 👍 +0,4, ❤️ +1; Punkt-Bewertung Gewicht 1, geerbte Date-Bewertung 0,5; Halbwertszeit 180 Tage. Mittelwert je Aktivität mit 1 neutralen Pseudo-Bewertung, je Tag (allgemein und je Wetterlage) mit 3, damit einzelne Bewertungen nicht dominieren.
- **Wetterlage beim Bewerten:** Beim ersten Bewerten holt die App das tatsächliche Wetter des Dates (Open-Meteo, auf ~10 km gerundeter Punkt) und speichert die Wetterlage je Programmpunkt.
- **Sperren vorschlagen:** Nach zwei 👎 für dieselbe Idee bietet die App „Block idea“ an; gesperrt wird nie automatisch.

## Selbst gewählte Programmpunkte

- **Auswahl** (Bottom Sheet „Choose“): Die eigenen aktiven Ideen werden auf dem Gerät gefiltert (Titel, Tags, Kategorie, Suchbegriff) – kostenlos. Nur auf ausdrücklichen Tipp „Search Google for …“ folgt **eine** bezahlte Ortssuche (Textsuche, 15 km um Zielort bzw. Wohnort, über den Budget-Wächter); ist das Tageslimit erreicht, sagt die App das.
- **Google-Treffer** werden zum einmaligen Programmpunkt (Name, Art, Dauer, Kosten für beide einstellbar). Optional „Add to our ideas“: legt eine **aktive** Idee an (Ortstyp `custom` = nur Suchbegriff, Google), gleicher Titel wird wiederverwendet. Danach findet die Auswahl sie ohne Google, und Bewertungen lernen für sie.
- **Im Wizard** („Anything set already?“): bis zu drei Punkte, je „Any time“ oder feste Uhrzeit im Zeitfenster. Ohne Uhrzeit wie bisher als Pflichtpunkt (zuerst eingeplant), mit Uhrzeit als **fester Block**.
- **Feste Blöcke:** Der Ort wird vorab gesucht (der nächstgelegene, der zu dieser Zeit geöffnet ist). Punkte davor müssen inkl. Weg rechtzeitig enden und suchen im Korridor Richtung Block; Lücken ≥ 90 min davor werden aufgefüllt. Ein Block ersetzt einen geplanten Slot seiner Art (feste Reservierung = Mahlzeit). Ist er nicht rechtzeitig erreichbar, beginnt er bei Ankunft mit Hinweis.
- **Ersetzen eines Punkts:** „Keep the rest“ – übrige Punkte behalten ihre Orte, Zeiten werden neu berechnet; was nicht mehr passt, wird ersetzt bzw. weggelassen und benannt. „Re-plan around it“ – der gewählte Punkt wird fester Block zur Startzeit des ersetzten Punkts, alles andere neu.
- **Kurze Öffnungszeiten:** Ist der gewählte Ort zu Beginn des Zeitfensters nicht geöffnet (z. B. öffentliches Eislaufen), wird der Punkt zur ersten Zeit fester Block, ab der er für die ganze Dauer geöffnet ist (15-min-Raster). Gibt es keine, nennt der Plan das ausdrücklich.
- Selbst gewählte Punkte unterliegen nicht Budget-, Wetter- und Abwechslungsfiltern (ausdrücklicher Wunsch), wohl aber Zeit und Öffnungszeiten. Ohne vorgegebenen Ort gewinnt der nächstgelegene passende statt eines gewichteten Zufalls.
- **Gespeicherte Pläne** behalten Punkte mit fester Uhrzeit als festen Block bei späteren Änderungen; einmalige Punkte (ohne Idee) werden beim Bearbeiten aus dem gespeicherten Punkt wiederhergestellt. Wird ein fester Punkt selbst ersetzt oder neu gewürfelt, ist er nicht mehr fest.

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
- Suchergebnisse, Webseiten und Werkzeug-Ergebnisse (z. B. Ortsnamen aus OpenStreetMap) sind fremder Text: Der System-Prompt stellt klar, dass darin enthaltene Anweisungen nicht befolgt werden.
- „Edit“ an der letzten eigenen Nachricht: entfernt Frage und Antwort aus dem Verlauf und legt den Text zum Nachbessern wieder ins Eingabefeld.

## Mehrtägige Ausflüge

- Ein Tool-Loop mit serverseitiger Websuche (max. `AI_MAX_WEB_SEARCHES_TRIP`) und max. 4 Runden; Claude liefert das Ergebnis über das Werkzeug `submit_trip_plan`, dessen Eingabe gegen ein Schema geprüft wird (fehlerhafte Einreichung → Claude bekommt den Fehler und korrigiert). Nur `https`-Links, und nur solche, die in den Suchergebnissen vorkamen – andere entfernt der Server (Schutz vor eingeschleusten Links). Wird der Plan wegen `max_tokens` abgeschnitten, sagt die Fehlermeldung das.
- Nur Vorschläge – keine Buchung; Hinweis in der Oberfläche.
- Gemessen: ~20 Cent für ein Wochenende.
- Anreise wählbar oder offen (dann entscheidet Claude nach Budget und Entfernung): Deutschlandticket, jeder Zug, Fernbus (z. B. FlixBus), Auto, Flug. Für Fernbusse gibt es keine öffentliche API; Claude sucht Verbindungen und Links per Websuche.
- Darstellung: Anreise als Ticket (bei echtem Zug mit Zeiten, Gleis und bahn.de-Link), Tage als Zeitleiste.

## Zugverbindungen

- **Quelle:** offizielle DB Timetables API (Free-Plan) für Abfahrten/Ankünfte mit Echtzeit, Bahnhofsliste aus StaDa (einmalig per `npm run rail:stations`, im Repo). Kein Routing der API: **Direktverbindungen**, sonst **ein Umstieg** (eigene Suche).
- **Suche:** Hinweg ab dem Startbahnhof – Züge, deren Laufweg einen Bahnhof nahe dem Ziel enthält; Ankunft über die Fahrt-ID im Fahrplan des Zielbahnhofs. Heimweg gespiegelt ab den Ankünften am Heimatbahnhof, damit nicht die nächste S-Bahn-Station ohne Direktzug gewählt wird. Exakte Bahnhofsnummer über den Namen aus dem Laufweg (z. B. „München Hbf Gl.5-10“).
- **Umstieg:** Nur wenn kein Direktzug fährt. Umstiegsbahnhöfe sind Bahnhöfe auf dem Laufweg eines abfahrenden Zugs am Start und eines ankommenden Zugs am Ziel (die zwei häufigsten), mind. 6 min Umsteigezeit. Große Bahnhöfe haben mehrere Namen/Nummern („München Hbf Gl.5-10“), alle werden zusammengeführt. Kostet zusätzliche Abfragen; bei Fehler oder Rate Limit bleibt die Schätzung.
- **Plan:** Nach der Planung werden geschätzte Zugabschnitte durch echte Züge ersetzt; spätere Punkte rücken bei Bedarf nach hinten. Scheitert die Suche für einen Abschnitt (z. B. Rate Limit), behält nur dieser seine Schätzung; bereits gefundene Züge bleiben. Losgehzeit nach planmäßiger Abfahrt minus Weg zum Bahnhof (Anreise-Routine bzw. Fußweg).
- **Voraussichtliche Zeiten:** Geplante Fahrpläne reichen gemessen ~18 h voraus und ~6 h zurück. Liegt die Abfahrt mehr als 16 h entfernt (Puffer für die 2–4 h Suchfenster), werden die Züge eines Referenztags (heute oder morgen zur selben Uhrzeit, innerhalb des Horizonts, möglichst gleiche Tagesart Werktag/Samstag/Sonntag) auf das Datum übertragen und als „expected“ markiert; ohne Echtzeit, kein Live-Status.
- **Gespeicherte Pläne:** Beim Ansehen (und für die Live-Karte bei Dates in den nächsten 12 h) werden Abschnitte ohne echten Zug neu gesucht, höchstens alle 6 h pro Plan (nach einem Fehler nach 20 min erneut); bereits echte Züge bleiben unverändert. Voraussichtliche Züge werden erst innerhalb des Horizonts ersetzt. Wurde der Plan während der Suche bearbeitet, wird das Ergebnis verworfen (optimistisches Sperren über `updated_at`).
- **Deutschlandticket:** Fernverkehr (ICE, IC, EC, RJ, Flix …) ausgeschlossen; passt nur ein Fernzug, wird er mit Hinweis gezeigt.
- **Live:** Startseite zeigt den nächsten Zug eines gespeicherten Dates (bis 12 h vorher, inkl. Anschlusszug) mit Verspätung, Gleis und Ausfall; Abfrage alle 60 s nur bei sichtbarer Seite.
- **Trips:** Hin- (1. Tag ab 8 Uhr) und Rückfahrt (letzter Tag ab 14 Uhr) bekommen einen echten Direktzug, sonst bleiben Claudes Hinweise.
- **Datenschutz/Quote:** Für den Heimatbahnhof nur das ~1-km-Raster; max. 50 Abfragen/min (API: 60), Fahrpläne 6 h, Echtzeit 30 s gecacht. Fehler → Schätzung bleibt, Hinweis im Plan.

## Gespeicherte Pläne

- **Upcoming:** gespeicherte Pläne mit Datum in der Zukunft, mehrere parallel; auf der Startseite als Karten, Detailseite `/plans/[id]`.
- **Bearbeiten** (nur kommende Pläne): Punkt neu würfeln, ersetzen („Choose“), entfernen, hinzufügen, Alternative wählen, Datum/Zeit und Verkehrsmittel ändern („Change plan“), Notiz. Änderungen planen mit festgehaltenen Punkten neu; ein festgehaltener Punkt wird notfalls auch ohne Zeitreserve für spätere Punkte eingeplant. Was nicht mehr passt, wird ersetzt und als Toast genannt.
- **Entfernen:** der Punkt wird für diese Planung ausgeschlossen; danach bleibt freie Zeit frei (`fillGaps: false`, im Plan gespeichert) – sonst würde die Lückenfüllung den Punkt sofort wieder einsetzen.
- **Hinzufügen:** In Lücken ≥ 60 min (inkl. Wege; vor dem ersten, zwischen, nach dem letzten Punkt; max. 5 Punkte) erscheint „Add a stop“. „Surprise us“ lässt den Planner wählen – erst eine Aktivität, sonst Snack, sonst Mahlzeit; alternativ eigene Idee bzw. Google-Suche. Der Punkt nach der Lücke behält seine Startzeit, damit der neue in die Lücke passt; passt nichts, bleibt der Plan unverändert mit Hinweis.
- **Verschieben / Verkehrsmittel ändern:** Punkte behalten ihre Tageszeit, wenn sie im neuen Fenster liegen (haben Vorrang); andere rücken so nah wie möglich und werden – wenn kein Platz bleibt oder der Ort geschlossen ist – weggelassen statt ersetzt (Toast nennt sie). Zusätzliche Zeit bleibt frei („Add a stop“).
- **Hinweise** (z. B. „passt nicht mehr“, „Note saved“) erscheinen als Toast über der Tab-Leiste, damit sie unabhängig von der Scrollposition sichtbar sind.
- **Löschen** entfernt den Plan endgültig samt Bewertungen; Einträge im Vorschlagsverlauf bleiben (Abwechslung).
- **Ansehen kostet nichts:** Plan, Orte, Wege kommen aus der DB; nur das Wetter (kostenlos) wird bei kommenden Plänen aktualisiert.
- **Past:** Status ergibt sich aus dem Datum (kein Löschen; Verlauf dient Abwechslung und Bewertungen). Löschen ist manuell möglich.
- **Wetter-Hinweis:** kommende Pläne zeigen je Punkt, wenn die aktuelle Vorhersage nicht mehr passt (→ Wetter).
- **Favoriten:** Stern pro Plan; **Plan again** übernimmt Punkte und Orte für ein neues Datum.
- **Archivierung (Google-Nutzungsbedingungen):** Nach dem Datum werden bei Google-Orten nur Place-ID und Name behalten, Koordinaten/Adresse/Öffnungszeiten/Alternativen sowie alle Routen-Links (enthalten Koordinaten) entfernt. „Plan again“ lädt archivierte Google-Orte per Place Details neu (1 Abfrage pro Ort über den Budget-Wächter). OpenStreetMap-Daten bleiben vollständig erhalten.

## Oberfläche

- Heller, schlichter Stil (Apple-ähnlich): Farb-Tokens in `src/app/globals.css` (paper, ink, butter, cream …), kein Dark Mode.
- Mobil: Tab-Leiste unten (Home, Our dates, Trips); Desktop: Navigation oben.
- Startseite: Suchfeld = Frage an Claude (öffnet den Chat), Kacheln „Plan a date“ (Wizard) und „Surprise us tonight“ (Sofortplan), dazu anstehende Dates und Ideen für heute Abend.
- Wizard `/new` in sechs Schritten (Wann, Wo, Feste Programmpunkte, Wie, Stimmung, Essen); jeder Schritt überspringbar, danach der Plan. Die Zeit-Vorschläge werden auf dem Server berechnet, damit Server und Browser dieselben Zeiten rendern.
- **Fehler:** Server Actions liefern Fehler als Ergebnis (`Result`) statt sie zu werfen; die Oberfläche zeigt sie an und setzt optimistische Änderungen (Bewertungen, Favorit) zurück. Unerwartete Fehler fängt eine Error Boundary mit „Try again“ auf (`error.tsx`). Beim Planen zählt nur die neueste Anfrage; ältere Antworten werden verworfen.
- **Nächster Ausflug** (Kachel „Surprise us …“, „Ideas for …“, Wizard-Vorauswahl): Start bis 16 Uhr → „today“ (ab 10 bis 22 Uhr), bis 21 Uhr → „tonight“ (max. 5 h, Ende spätestens 2 Uhr), danach → „tomorrow“ (18–23 Uhr).
- **Start/Ende am Zielort:** Mit gewähltem Ort wählbar „From home / Already there“ und „Back home / Staying there“. Schon dort = keine Hinfahrt, der erste Ort wird um den Zielort gesucht; dort bleiben = kein Heimweg und keine Ideen zu Hause. Zu Fuß oder mit dem Rad gilt „schon dort“ bei einem Zielort außerhalb der Reichweite vom Wohnort (4 bzw. 20 km) automatisch auch als „dort bleiben“: Ihr seid anders hingekommen, ein Fußweg nach Hause wäre unrealistisch; der Plan nennt das als Hinweis.
- Radius „Fit to time“ statt „Auto“, damit es nicht mit dem Verkehrsmittel Auto verwechselt wird.
- **Programmpunkt-Karte:** links Zeitleiste (Start groß, Ende grau), Ortsname öffnet Google Maps, andere Orte als volle Zeilen darunter (Namen werden nicht abgeschnitten), runde Buttons für Auswählen, Neu würfeln, Entfernen.
- **Bedienung am Handy:** Bedienelemente mind. 44 px hoch, Suchfelder 16 px Schrift (kein Zoom unter iOS), ein gemeinsames Suchfeld (`search-field.tsx`).
- **Installierbar (PWA):** Manifest mit Farben der Oberfläche (`paper`), Icons 192/512 und maskierbarer Variante; dazu `favicon.ico`, `icon.svg` und `apple-icon.png` (180 px). Quellen als SVG in `assets/icons/` (Anleitung dort). Alle Icon-Pfade sind ohne Login erreichbar (`src/proxy.ts`).
- **Dauern** einheitlich kompakt: „45min“, „2h“, „1h 55min“ (`src/lib/duration.ts`).

## Tests

- **Unit:** `core/planner` (Filter, Scoring, Ablauf, seedbarer Zufall), `guard`.
- **Adapter:** je Adapter mit aufgezeichneten Beispielantworten (keine Live-Aufrufe in CI).
- **Offen:** Integrationstests für Server Actions und Route Handlers mit Test-Datenbank; bisher werden datenbanknahe Abläufe manuell gegen eine Entwicklungsdatenbank geprüft.
- Externe APIs werden in Tests **nie** live aufgerufen.
