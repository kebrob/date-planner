# 11. Risiken und technische Schulden

| Risiko                                            | Auswirkung                            | Maßnahme                                                                        |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Inoffizielle DB-Schnittstelle ändert sich         | Zugverbindungen fallen aus            | Adapter austauschbar, Fallback-Link bahn.de, Spike vor Umsetzung                |
| Preisänderungen Anthropic/Google                  | Hochrechnung stimmt nicht mehr        | Harte Anbieter-Limits; monatliche Kontrolle laut Runbook                        |
| Google-Nutzungsbedingungen (Caching, Darstellung) | Verstoß bei Speicherung von Ortsdaten | Nur Place-ID dauerhaft speichern; Bedingungen vor Umsetzung des Adapters prüfen |
| Claude erfindet lokale Details                    | Falsche Vorschläge                    | Claude erzeugt allgemeine Ideen; konkrete Orte kommen ausschließlich aus Places |
| Wettervorhersage > 7 Tage unsicher                | Unpassende Outdoor-Vorschläge         | Hinweis in der UI, Outdoor-Aktivitäten mit Alternative                          |
| Verlust aller Passkeys                            | Kein Zugang                           | Notfall-Passwort                                                                |
| Neon Free Tier: Pausieren bei Inaktivität         | Erster Aufruf langsamer               | Akzeptiert                                                                      |
