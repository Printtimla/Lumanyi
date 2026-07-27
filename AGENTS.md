# Lumanyi — agent notes

STOP. Prefer current Cloudflare docs over memorized APIs:
https://developers.cloudflare.com/workers/
https://developers.cloudflare.com/d1/

## Product boundary

- This repo is **Field Ops** (water restoration + hard floor cleaning).
- Do **not** build Print Ops UI here until ROADMAP says so.
- Do **not** claim Xactimate parity; estimating track is internal line items only.

## Work style

1. Read `ROADMAP.md` — take the next unchecked Release 1 item.
2. Implement the smallest useful change.
3. Run `npm run ci` (typecheck + tests).
4. Update ROADMAP checkboxes when done.
5. Prefer fixing P0/P1 bugs before new features.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local Worker (http://localhost:8787) |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run ci` | Typecheck + Vitest |
| `npm run deploy` | Deploy (requires real D1 database_id) |
| `npx wrangler types` | Regenerate `worker-configuration.d.ts` after binding changes |

## Auth seed

Default user created on empty DB: `owner@lumanyi.local` / `changeme`

## Schema

SQL migrations live in `migrations/`. Do not edit applied migrations; add a new numbered file.
