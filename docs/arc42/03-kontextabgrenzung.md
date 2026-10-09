# 3. Kontextabgrenzung

```mermaid
flowchart LR
    U[Nutzer:innen<br/>Browser / PWA] -->|HTTPS, Passkey-Login| APP[Date Planner<br/>Next.js auf Vercel]
    APP --> DB[(Neon Postgres)]
    APP -->|Ideen, Chat, Ausflüge| CLAUDE[Claude API<br/>Anthropic]
    APP -->|Ortssuche| GP[Google Places API]
    APP -.->|Fallback Ortssuche| OSM[OpenStreetMap Overpass]
    APP -->|Vorhersage, Geocoding| OM[Open-Meteo]
    APP -.->|Phase 2| DBV[DB-Verbindungen<br/>inoffiziell]
    U -.->|Links| GM[Google Maps / bahn.de]
```

| Partner                | Zweck                                         | Gesendete Daten                                                        | Kosten                             |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| Claude API             | Aktivitäten generieren, Chat, Ausflugsplanung | Stadt/Region, Aktivitäten-Katalog, Planparameter, Chat-Text            | nutzungsabhängig, Limit 20 $/Monat |
| Google Places          | Konkrete Orte, Öffnungszeiten, Bewertungen    | Suchbegriff + grobe Koordinaten                                        | Freikontingent, Quota-begrenzt     |
| OpenStreetMap Overpass | Fallback Ortssuche                            | Ortstyp + grobe Koordinaten                                            | kostenlos                          |
| Open-Meteo             | Wettervorhersage bis 16 Tage                  | grobe Koordinaten                                                      | kostenlos                          |
| Open-Meteo Geocoding   | Zielort („München“) in Koordinaten umwandeln  | eingegebener Ortsname                                                  | kostenlos, Quellenangabe GeoNames  |
| DB (Phase 2)           | Zugverbindungen, Regionalverkehr              | Start-/Zielbahnhof, Zeit                                               | kostenlos, inoffiziell             |
| OpenStreetMap-Kacheln  | Kartenanzeige zur Wahl von Ort und Radius     | Kachelabrufe des Browsers (Kartenausschnitt um den gerundeten Wohnort) | kostenlos, Quellenangabe, Fair Use |
| Google Maps / bahn.de  | Route/Verbindung öffnen                       | nur per Klick im Browser                                               | kostenlos                          |

**Datenschutz:** An Such- und Wetterdienste gehen nur Stadt bzw. auf ~1 km gerundete Koordinaten, nie eine Hausadresse. Route-Links (Google Maps) können den optionalen Wohnort-Pin enthalten; sie werden nur per Klick im Browser geöffnet (ADR-012).
