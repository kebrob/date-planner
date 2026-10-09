# 10. Qualitätsanforderungen

| ID  | Qualität         | Szenario                                            | Erwartung                                                                          |
| --- | ---------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1  | Kostensicherheit | Bug lässt den Chat-Tool-Loop endlos laufen          | Abbruch nach `AI_MAX_TOOL_ITERATIONS`, max. Kosten pro Anfrage < 0,50 $            |
| Q2  | Kostensicherheit | Frontend-Bug löst Planer-Anfragen in Schleife aus   | Notbremse nach `PAID_CALLS_PER_MINUTE`, Google-Tageslimit hält, 0 € Mehrkosten     |
| Q3  | Kostensicherheit | API-Key geleakt                                     | Max. Schaden = Anthropic-Workspace-Limit (20 $) bzw. Google-Quota (Freikontingent) |
| Q4  | Vertraulichkeit  | Unbekannte Person ruft die Domain auf               | Sieht nur die Login-Seite; keine Daten, keine API ohne Session                     |
| Q5  | Austauschbarkeit | Wechsel Google Places → OSM                         | Nur Environment-Variable ändern, keine Code-Änderung außerhalb `adapters/`         |
| Q6  | Brauchbarkeit    | Date „heute 20 Uhr, Regen, 30 €, Deutschlandticket“ | Nur Indoor-Vorschläge, erreichbar mit Regionalverkehr, geöffnet, im Budget         |
| Q7  | Verfügbarkeit    | Claude-Budget erschöpft                             | Planner funktioniert weiter, Chat zeigt Hinweis + Import-Fallback                  |
| Q8  | Bedienbarkeit    | Plan am Handy erstellen                             | ≤ 3 Interaktionen bis zum Vorschlag mit Standardwerten                             |
