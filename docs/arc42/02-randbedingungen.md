# 2. Randbedingungen

## Technisch

| Randbedingung                       | Erläuterung                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| Hosting Vercel (Hobby, kostenlos)   | Kein persistentes Dateisystem → externe Datenbank nötig      |
| Datenbank Neon Postgres (Free Tier) | Keine Zahlungsmethode hinterlegt → stoppt statt zu berechnen |
| Domain `dates.robertkebinger.com`   | DNS bei Cloudflare, CNAME auf Vercel, Proxy aus              |
| Browser + installierbare PWA        | Keine native App, kein App Store                             |
| UI-Sprache Englisch                 | Doku deutsch, Code/README englisch                           |

## Organisatorisch

| Randbedingung                   | Erläuterung                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Ein Entwickler, Freizeitprojekt | Wenig Betriebsaufwand, möglichst wenig Abhängigkeiten                                                                      |
| Kostenrahmen                    | Claude API ≤ 20 $/Monat (hartes Limit), Google im Freikontingent, sonst 0 €                                                |
| Abhängigkeiten                  | Neue npm-Pakete nur nach Freigabe; nur Versionen, die mindestens 7 Tage veröffentlicht sind; `npm audit` nach Installation |
| Commits                         | Conventional Commits, nie direkt auf `main`                                                                                |

## Konventionen

- Code, Code-Kommentare, `README.md`: Englisch
- Architekturdoku (arc42): Deutsch
- Architektur- und Business-Entscheidungen in [Kapitel 9](09-architekturentscheidungen.md), nicht im Code
