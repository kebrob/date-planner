# Kostenlimits & Kontingente – Runbook

Ziel: Keine externe API kann mehr kosten als bewusst freigegeben – auch nicht bei Bugs (Endlosschleifen), Fehlbedienung oder geleaktem Key.

Prinzip: **Drei Schutzschichten**, jede für sich ausreichend:

1. **Anbieter-Limit** (hartes Limit beim Anbieter – greift auch, wenn die App komplett kaputt ist)
2. **App-Budget-Wächter** (zählt jede kostenpflichtige Anfrage in der DB und blockt vor dem Anbieter-Limit)
3. **Technische Obergrenzen im Code** (max. Iterationen, max. Suchen, Timeouts – verhindern Schleifen, durch Tests abgesichert)

Die App-Limits liegen bewusst **unter** den Anbieter-Limits, damit die App sauber mit Hinweis abbricht, bevor der Anbieter hart abschneidet.

---

## 1. Checkliste Ersteinrichtung

| #   | Wo                                                      | Was                                                                                                                                                   | Empfohlener Wert                   | Erledigt |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| 1   | Anthropic Console → Workspaces                          | Eigenen Workspace `date-planner` anlegen                                                                                                              | –                                  | ☐        |
| 2   | Anthropic Console → Workspace `date-planner` → Limits   | **Monatliches Spend-Limit** des Workspaces                                                                                                            | **20 $**                           | ☐        |
| 3   | Anthropic Console → Workspace `date-planner` → API Keys | API-Key **nur in diesem Workspace** erzeugen                                                                                                          | –                                  | ☐        |
| 4   | Anthropic Console → Billing                             | Auto-Reload **aus**, Guthaben manuell aufladen (z. B. 20 $)                                                                                           | aus                                | ☐        |
| 5   | Google Cloud → neues Projekt `date-planner`             | Billing-Konto verknüpfen, nur **Places API (New)** aktivieren                                                                                         | –                                  | ☐        |
| 6   | Google Maps Platform → Kontingente → Places API (New)   | Tageskontingente `SearchTextRequest per day`, `SearchNearbyRequest per day`, `GetPlaceRequest per day` (Checkbox anhaken → ⋮ → Kontingent bearbeiten) | je **30 / Tag**                    | ☐        |
| 7   | Google Maps Platform → Kontingente → Places API (New)   | Nicht genutzte Tageskontingente `AutocompletePlacesRequest per day`, `GetPhotoMediaRequest per day`                                                   | **1**                              | ☐        |
| 8   | Google Cloud → Credentials                              | API-Key auf **Places API (New)** beschränken (API restriction)                                                                                        | –                                  | ☐        |
| 9   | Google Cloud → Billing → Budgets & alerts               | Budget mit Mail-Alarm                                                                                                                                 | **1 €**, Alarm bei 50 / 90 / 100 % | ☐        |
| 10  | Vercel / Neon                                           | **Keine** Zahlungsmethode hinterlegen (Free Tier stoppt statt zu berechnen)                                                                           | –                                  | ☐        |
| 11  | Vercel → Project → Settings → Environment Variables     | App-Limits aus Abschnitt 3 setzen                                                                                                                     | siehe unten                        | ☐        |

### Warum diese Werte

- **Anthropic 20 $/Monat:** Worst-Case-Hochrechnung liegt bei ~19 $ (Sonnet 5.5), Normalfall ~4 $. Das Spend-Limit ist hart – darüber lehnt die API ab.
- **Eigener Workspace:** Limit und Key gelten nur für diese App; andere Projekte bleiben unberührt, und ein geleakter Key kann nicht mehr als das Workspace-Limit verbrauchen.
- **Google 30/Tag:** Abfragen mit Öffnungszeiten/Bewertungen laufen über die Enterprise-SKU mit **1.000 kostenlosen Abfragen/Monat**. 30 × 31 = 930 → bleibt garantiert im Freikontingent.
- **Google Places (New):** Text Search, Nearby Search und Place Details haben getrennte Kontingente und getrennte Freikontingente – deshalb jedes einzeln begrenzen.
- **Google-Testzeitraum:** Im kostenlosen Testzeitraum lassen sich Kontingente ggf. nicht bearbeiten. Kein Kostenrisiko, solange nicht manuell auf ein vollständiges Konto umgestellt wird. **Vor dem Upgrade** Schritte 6 und 7 erledigen.
- **Google Budget ≠ Limit:** Google-Budgets **alarmieren nur, sie stoppen nichts**. Das harte Limit sind ausschließlich die Quotas (Schritt 6/7).

---

## 2. Anbieterpreise (Stand 2026-10)

| Anbieter               | Leistung                        | Freikontingent              | Preis danach                                          |
| ---------------------- | ------------------------------- | --------------------------- | ----------------------------------------------------- |
| Anthropic              | Claude Sonnet 5.5               | –                           | 2 $ / 10 $ pro 1 Mio. Input-/Output-Tokens            |
| Anthropic              | Websuche                        | –                           | 10 $ pro 1.000 Suchen (+ Ergebnisse als Input-Tokens) |
| Google                 | Places Text Search Enterprise   | 1.000 / Monat               | 35 $ pro 1.000                                        |
| Google                 | Places Nearby Search Enterprise | 1.000 / Monat               | 35 $ pro 1.000                                        |
| Google                 | Places Details Enterprise       | 1.000 / Monat               | 20 $ pro 1.000                                        |
| Google                 | Maps URLs (Links) / Maps Embed  | unbegrenzt                  | kostenlos                                             |
| Open-Meteo             | Wetter                          | Fair Use, nicht-kommerziell | kostenlos                                             |
| OpenStreetMap Overpass | Ortssuche (Fallback)            | Fair Use                    | kostenlos                                             |

Quellen: [Google Maps Platform Pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Claude Web Search Pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

---

## 3. App-Limits (Environment-Variablen)

Gesetzt in Vercel (Production) bzw. lokal in `.env.local`. Vorlage: `.env.example`.

| Variable                       | Default  | Bedeutung                                                                                        |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `AI_ENABLED`                   | `true`   | Kill-Switch: `false` deaktiviert alle Claude-Aufrufe sofort (Fallback: Prompt kopieren / Import) |
| `AI_MONTHLY_BUDGET_USD`        | `15`     | App-Budget Claude pro Kalendermonat (unter Anthropic-Limit 20 $)                                 |
| `AI_DAILY_BUDGET_USD`          | `2`      | App-Budget Claude pro Tag                                                                        |
| `AI_MAX_TOOL_ITERATIONS`       | `8`      | Max. Runden im Tool-Loop pro Anfrage                                                             |
| `AI_MAX_WEB_SEARCHES_CHAT`     | `3`      | Max. Websuchen pro Chat-Nachricht                                                                |
| `AI_MAX_WEB_SEARCHES_GENERATE` | `5`      | Max. Websuchen pro „10 Ideen generieren“                                                         |
| `AI_MAX_WEB_SEARCHES_TRIP`     | `15`     | Max. Websuchen pro Ausflugsplanung                                                               |
| `AI_MAX_API_CALLS_PER_DAY`     | `200`    | Max. Claude-API-Aufrufe pro Tag; jede Runde im Tool-Loop zählt einzeln                           |
| `AI_REQUEST_TIMEOUT_MS`        | `90000`  | Timeout pro API-Request                                                                          |
| `PLACES_PROVIDER`              | `google` | `google` oder `osm`                                                                              |
| `PLACES_DAILY_LIMIT`           | `25`     | Max. Google-Places-Abfragen pro Tag (unter Google-Quota 30)                                      |
| `PLACES_MAX_LOOKUPS_PER_PLAN`  | `6`      | Max. Ortsabfragen pro Plan-Generierung inkl. Neu würfeln                                         |
| `PAID_CALLS_PER_MINUTE`        | `20`     | Notbremse: max. kostenpflichtige Aufrufe pro Minute über alle Anbieter                           |

Ist ein Limit erreicht, zeigt die App einen Hinweis („Tageslimit erreicht – morgen wieder verfügbar“) und fällt, wo möglich, auf kostenlose Alternativen zurück (OSM statt Google, Plan ohne Claude-Text).

Im Admin-Bereich zeigt eine Übersicht den aktuellen Verbrauch (heute / Monat) je Anbieter gegen die Limits.

---

## 4. Notfall: Kosten laufen unerwartet hoch

1. Vercel → Environment Variables: `AI_ENABLED=false` bzw. `PLACES_PROVIDER=osm` setzen → Redeploy (wirkt sofort nach Deploy).
2. Anthropic Console: API-Key des Workspaces `date-planner` deaktivieren.
3. Google Cloud: API-Key löschen oder Places API (New) deaktivieren.
4. Admin → Verbrauch prüfen; Ursache als Bug erfassen.

---

## 5. Regelmäßige Kontrolle

- Monatlich: Anthropic Console → Usage, Google Cloud → Billing Report kurz prüfen.
- Bei Preisänderungen der Anbieter: Tabelle in Abschnitt 2 und Limits in Abschnitt 1/3 anpassen.
