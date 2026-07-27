# Lumanyi

Internal Field Ops for **water restoration** and **hard floor cleaning**.

Print Ops is a later product on the same platform idea — not in Release 1.

## Stack

- Cloudflare Workers + Hono
- D1 (SQLite)
- Cookie sessions (internal only)

## Local

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787  

Default login: `owner@lumanyi.local` / `changeme`

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

See `ROADMAP.md`. Scheduled Cursor agents should pick the next unchecked Release 1 / polish item, implement, run `npm run ci`, and open a PR (or commit to `dev`).
