# Deployment – Vercel + Neon + Cloudflare

Ziel: App unter `https://dates.robertkebinger.com`, gehostet auf Vercel (Hobby), Datenbank Neon, DNS bei Cloudflare.

> Vorher: [Kostenlimits & Kontingente](kostenlimits.md) einrichten (Anthropic-Workspace-Limit, Google-Key-Beschränkung, Budget-Alarm).

## 1. Code zu GitHub

1. Auf GitHub ein **privates** Repository `date-planner` anlegen.
2. Lokal Remote setzen und pushen (Branch `main` per Merge/PR aus den Feature-Branches):
   ```bash
   git remote add origin git@github.com:<user>/date-planner.git
   git push -u origin main
   ```

## 2. Vercel-Projekt

1. Vercel → **Add New → Project** → GitHub-Repo `date-planner` importieren. Framework: Next.js (automatisch erkannt).
2. Region: Durch `vercel.json` (`fra1`, Frankfurt) festgelegt – nah an Neon (eu-central-1).
3. **Environment Variables** (Scope _Production_) setzen:

| Variable                | Wert                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Neon Connection String (gepoolt, Host mit `-pooler`)                                               |
| `AUTH_PASSWORD_HASH`    | Ausgabe von `npm run auth:hash-password` – **unverändert einfügen** (in Vercel kein `\$`-Escaping) |
| `WEBAUTHN_RP_ID`        | `dates.robertkebinger.com`                                                                         |
| `WEBAUTHN_ORIGIN`       | `https://dates.robertkebinger.com`                                                                 |
| `ANTHROPIC_API_KEY`     | eigener Key `date-planner-prod` aus dem Workspace `date-planner`                                   |
| `GOOGLE_PLACES_API_KEY` | eigener Prod-Key, beschränkt auf Places API (New)                                                  |
| `DB_CLIENT_ID`          | Client ID der Anwendung im DB API Marketplace (Abos: Timetables, StaDa – je Free)                  |
| `DB_API_KEY`            | API Key derselben Anwendung                                                                        |
| `PLACES_DAILY_LIMIT`    | z. B. `35` (siehe Runbook)                                                                         |
| weitere Limits          | nur falls abweichend von den Defaults (`.env.example`)                                             |

4. **Keine Zahlungsmethode** bei Vercel hinterlegen (Hobby-Plan).
5. Deploy starten. Build-Befehl und Output erkennt Vercel selbst.

## 3. Datenbank

Lokal und Production nutzen aktuell dieselbe Neon-Datenbank; Migrationen und Seed sind dort bereits eingespielt. Bei künftigen Schema-Änderungen vor dem Deploy lokal ausführen:

```bash
npm run db:migrate
```

Optional: Für Experimente einen Neon-**Branch** als Entwicklungsdatenbank anlegen und dessen URL lokal in `.env.local` verwenden.

## 4. Domain über Cloudflare

1. Vercel → Project → **Settings → Domains** → `dates.robertkebinger.com` hinzufügen.
2. Cloudflare → DNS → **CNAME** `dates` → `cname.vercel-dns.com`, **Proxy aus** (graue Wolke).
3. Warten, bis Vercel das Zertifikat ausgestellt hat (Status „Valid Configuration“).

## 5. Erster Login in Production

1. `https://dates.robertkebinger.com` öffnen → mit dem Notfall-Passwort anmelden.
2. **Admin → Security & passkeys** → auf jedem Gerät einen Passkey hinzufügen. Lokale Passkeys (`localhost`) gelten in Production nicht. Passkeys lassen sich nur innerhalb von 10 Minuten nach der Anmeldung hinzufügen oder entfernen; danach ab- und wieder anmelden.

## 6. Prüfen nach dem Deploy

- Login per Passkey funktioniert, Logout funktioniert.
- Plan erstellen (Google Places), Admin → Usage zeigt den Aufruf.
- `https://dates.robertkebinger.com/robots.txt` liefert `Disallow: /`.
- Ohne Login leitet jede Seite auf `/login` um; `/api/...` liefert 401.

## Hinweise

- **Laufzeiten:** Chat und Ideen dürfen bis 120 s, Ausflüge bis 300 s laufen (Route-Segment-Config `maxDuration`, Grenze des Hobby-Plans). Die Claude-Aufrufe haben eigene Fristen knapp darunter (105 s bzw. 260 s, in `chat/service.ts`, `admin/service.ts`, `trips/service.ts`); bei Änderung von `maxDuration` mit anpassen.
- **`$` in `.env`-Dateien:** Next.js expandiert `$` in Env-Dateien, daher lokal als `\$` schreiben; das Hash-Skript zeigt beide Varianten an.
- **Rollback:** Vercel → Deployments → älteres Deployment → „Promote to Production“.
