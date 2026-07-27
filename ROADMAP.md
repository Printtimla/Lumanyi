# Lumanyi ROADMAP (manual build)

Work top-to-bottom in this chat. Check off items with `[x]` only after `npm run ci` passes.
Do not start Print Ops or Xactimate-depth estimating until Field Ops Release 1 is complete.
**Manual only** — no Cursor Automations / cloud agents unless the owner re-enables them.
Skip items marked **external** until the owner asks to connect Cloudflare/GitHub again.

## Release 1 — Field Ops MVP (current)

- [x] Project scaffold (Workers + Hono + D1)
- [x] Auth (cookie session) + seed owner user
- [x] Customers + sites
- [x] Jobs (restoration / hard_floor) + status pipeline
- [x] Job checklists + field notes
- [x] Simple estimate / invoice dollar fields
- [x] Calendar list by day
- [x] Change default password flow / force password change on first login
- [x] Assign job to a tech user (user picker)
- [x] Create additional users (owner-only)
- [ ] Photo uploads to R2 on job notes — **external (Cloudflare R2)** — deferred
- [x] Soften secure-cookie for local HTTP without breaking production
- [x] Basic Vitest coverage for health + login redirect
- [ ] Replace placeholder D1 `database_id` after `wrangler d1 create` — **external** — deferred
- [x] GitHub Actions CI workflow file added
- [ ] Staging deploy on Cloudflare — **external** — deferred
- [x] Mobile-first tech job view (`/tech`)
- [x] Error page + request id logging

## Release 1.1 — Daily ops polish

- [ ] Recurring hard-floor jobs
- [ ] Job filters by tech / date range
- [ ] CSV export of jobs

## Later — Estimating track

- [ ] Room / area line-item estimates (internal, not Xactimate)
- [ ] Claim fields (claim #, carrier, date of loss)
- [ ] Estimate PDF
- [ ] Evaluate Xactimate import/export only after vendor terms verified

## Later — Print Ops (separate product shell)

- [ ] Print job types + production statuses
- [ ] Do not mix into Field Ops nav until shell exists

## Bug triage rules (always)

1. P0 (cannot sign in / schedule / save job): fix same session before new features
2. P1: fix before the next feature
3. P2: append to Release 1.1
