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

- An externe Dienste gehen nur Stadt bzw. auf das PLZ-Gebiet gerundete Koordinaten.
- Keine personenbezogenen Daten, Tokens oder vollständigen Request-Bodies in Logs.
- Google-Places-Daten: dauerhaft gespeichert wird nur die Place-ID und der Anzeigename im gespeicherten Plan; weitere Ortsdaten werden bei Bedarf neu abgefragt bzw. nur kurzfristig zwischengespeichert (Google-Nutzungsbedingungen).

## Austauschbarkeit (Ports & Adapters)

- Jeder externe Dienst hat ein Interface in `ports/` mit eigenen, anbieterneutralen Typen.
- Adapter übersetzen Anbieter-Datenformate in diese Typen; nichts außerhalb eines Adapters kennt Anbieter-Formate.
- Auswahl per Environment-Variable (z. B. `PLACES_PROVIDER=google|osm`) in einer zentralen Factory.
- Für jeden Port gibt es eine gemeinsame Contract-Test-Suite, die alle Adapter erfüllen müssen.

## Planner-Logik

1. **Harte Filter:** Budget, Verkehrsmittel, Wetter-Eignung, Dauer passt ins Zeitfenster, Tageszeit/Saison, gesperrte Aktivitäten.
2. **Score:** Basis + Übereinstimmung mit Vorlieben − Abwechslungs-Abzug (abklingend mit Tagen seit letzter Durchführung/Vorschlag); Phase 2 zusätzlich Bewertungs-Bonus und gelernte Tag-Gewichte.
3. **Gewichteter Zufall** über die Scores (seedbar für Tests).
4. **Planformat** aus Zeitfenster: < 3 h eine Aktivität, 3–6 h Aktivität + Essen, > 6 h Tagesplan; manuell überschreibbar.
5. **Ablauf bauen:** Uhrzeiten aus Dauer + Anreise (Anreise-Routinen, Entfernung × Verkehrsmittel).
6. **Neu würfeln:** ganzer Plan oder ein Programmpunkt; abgelehnte Aktivitäten werden für die laufende Planung abgewertet.

## Tests

- **Unit:** `core/planner` (Filter, Scoring, Ablauf, seedbarer Zufall), `guard`.
- **Contract:** je Port für alle Adapter, mit aufgezeichneten Beispielantworten (keine Live-Aufrufe in CI).
- **Integration:** Route Handlers mit Test-Datenbank und gemockten Adaptern.
- Externe APIs werden in Tests **nie** live aufgerufen.
