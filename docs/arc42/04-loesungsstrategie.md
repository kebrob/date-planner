# 4. Lösungsstrategie

| Ziel                          | Ansatz                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wenig Betriebsaufwand         | Next.js-Fullstack (Frontend + API in einem Projekt), Vercel + Neon im Free Tier                                                                               |
| Austauschbarkeit              | Ports & Adapters: Jeder externe Dienst hinter einer Schnittstelle, Auswahl per Environment-Variable                                                           |
| Kostensicherheit              | Drei Schutzschichten: Anbieter-Limit, App-Budget-Wächter, technische Obergrenzen im Code                                                                      |
| Nachvollziehbare Vorschläge   | Planner ist eine eigene, deterministische Logik (Filter + Scoring + gewichteter Zufall); Claude erzeugt Ideen und Texte, entscheidet aber nicht über den Plan |
| Vorschläge existieren vor Ort | Aktivitäten sind allgemeine Ideen mit Ortstyp; der Planner sucht echte Orte im Umkreis und verwirft Aktivitäten ohne Treffer                                  |
| Zugriffsschutz                | Ein Account, Passkeys + Notfall-Passwort, Session-Cookies, Login-Rate-Limit, keine Registrierung                                                              |
| Abwechslung                   | Abwechslungs-Abzug für kürzlich gemachte/vorgeschlagene Aktivitäten, gewichteter Zufall statt bester Treffer                                                  |
