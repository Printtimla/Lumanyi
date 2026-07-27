# Lumanyi — agent notes

STOP. Prefer current Cloudflare docs over memorized APIs when (and only when) the owner asks for Cloudflare work:
https://developers.cloudflare.com/workers/
https://developers.cloudflare.com/d1/

## Mode

- **Manual build in chat** unless the owner re-enables Automations.
- Do **not** push, deploy, create cloud resources, or open external editors unless asked.
- Local: `npm run ci`, `npm run db:migrate:local`, `npm run dev`.

## Product boundary

- This repo is **Field Ops** (water restoration + hard floor cleaning).
- Do **not** build Print Ops UI here until ROADMAP says so.
- Do **not** claim Xactimate parity; estimating track is internal line items only.

## Work style

1. Read `ROADMAP.md` — take the next unchecked **non-external** Release 1 item.
2. Implement the smallest useful change.
3. Run `npm run ci`.
4. Update ROADMAP checkboxes when done.
5. Prefer fixing P0/P1 bugs before new features.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local Worker (http://localhost:8787) |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run ci` | Typecheck + Vitest |

## Auth seed

Default user on empty DB: `owner@lumanyi.local` / `changeme` (forced password change on login).

## Schema

SQL migrations live in `migrations/`. Do not edit applied migrations; add a new numbered file.
