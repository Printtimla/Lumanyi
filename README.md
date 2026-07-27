# Lumanyi

Internal Field Ops for **water restoration** and **hard floor cleaning**.

Print Ops is a later product on the same platform idea — not in Release 1.

## Stack

- Cloudflare Workers + Hono
- D1 (SQLite)
- Cookie sessions (internal only)

## Cloudflare

| Resource | Name / id |
|----------|-----------|
| D1 prod | `lumanyi` · `88d1c1e4-255d-4d32-a44c-509f065f997c` |
| D1 staging | `lumanyi-staging` · `422f351b-819e-447e-88b2-630d06521bf2` |
| R2 | `lumanyi-uploads` |
| Worker staging | `lumanyi-staging` · https://lumanyi-staging.timla-uploads.workers.dev |
| Worker prod | `lumanyi` · https://lumanyi.timla-uploads.workers.dev |

```bash
npm run db:migrate:local
npm run db:migrate:staging   # after code changes that add migrations
npm run deploy:staging
npm run db:migrate:prod      # before/with prod deploy
npm run deploy
```

## Local

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787  

Default login: `owner@lumanyi.local` / `Lumanyi1!`

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local Worker |
| `npm run ci` | Typecheck + tests |
| `npm run deploy` | Deploy Worker (needs real D1 id + `wrangler login`) |
| `npm run db:migrate:local` | Apply D1 migrations locally |

## Cloudflare deploy (first time)

1. `npx wrangler login`
2. `npx wrangler d1 create lumanyi` — paste the `database_id` into `wrangler.jsonc`
3. `npx wrangler d1 migrations apply lumanyi --remote`
4. `npm run deploy`

## Automation

Manual build in chat by default. Cursor Automations / cloud agents are optional and off unless re-enabled.
