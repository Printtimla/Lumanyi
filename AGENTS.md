# Lumanyi — agent notes

STOP. Prefer current Cloudflare docs over memorized APIs when (and only when) the owner asks for Cloudflare work:
https://developers.cloudflare.com/workers/
https://developers.cloudflare.com/d1/

## Mode

- **Manual build in chat** unless the owner re-enables Automations.
- Do **not** push, deploy, create cloud resources, or open external editors unless asked.
- Local: `npm run ci`, `npm run db:migrate:local`, `npm run dev`.

## Product boundary

- One kernel + three product shells: **Restoration & Remediation**, **Hard Floor Cleaning**, **Print Ops**.
- Restoration service types live in `src/lib/products.ts` (IICRC-aligned dropdown).
- Do **not** mix floors into restoration job lists, or invent taxonomy outside `products.ts` / `data` equivalents.
- Do **not** claim Xactimate parity; estimating track is internal line items only.

## Work style

1. Read `ROADMAP.md` — take the next unchecked **non-external** item.
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

Default user on empty DB: `owner@lumanyi.local` / `Lumanyi1!`

## Schema

SQL migrations live in `migrations/`. Do not edit applied migrations; add a new numbered file.
