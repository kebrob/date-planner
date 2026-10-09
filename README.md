# date-planner

Private date planner PWA: suggests date ideas and builds a concrete schedule based on time window, budget, transport, weather and preferences.

## Documentation

- Architecture (arc42, German): [docs/arc42](docs/arc42/README.md)
- **Cost limits & provider quotas — set these up before deploying:** [docs/betrieb/kostenlimits.md](docs/betrieb/kostenlimits.md)

## Local setup

Requires Node 24 (`nvm use`).

```bash
npm ci
cp .env.example .env.local        # fill in DATABASE_URL etc.
npm run auth:hash-password        # paste the output into AUTH_PASSWORD_HASH
npm run db:migrate
npm run dev
```

Sign in with the emergency password, then add a passkey under _Security_.

`npm run db:seed` only adds missing seed activities. `npm run db:seed -- --update` overwrites seed activities with the seed values – including changes made in the admin area.

## Checks

```bash
npm run lint && npm run typecheck && npm test
```

Dependencies: only versions published at least 7 days ago (`npm install --before=<date>`), run `npm audit` afterwards.
