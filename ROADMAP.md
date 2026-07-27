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
- [x] Photo uploads to R2 on job notes
- [x] Soften secure-cookie for local HTTP without breaking production
- [x] Basic Vitest coverage for health + login redirect
- [x] Replace placeholder D1 `database_id` after `wrangler d1 create`
- [x] GitHub Actions CI workflow file added
- [x] Staging deploy on Cloudflare (`lumanyi-staging` + `npm run deploy:staging`)
- [x] Mobile-first tech job view (`/tech`)
- [x] Error page + request id logging

## Release 1.1 — Daily ops polish

- [x] Recurring hard-floor jobs
- [x] Job filters by tech / date range
- [x] CSV export of jobs

## Later — Estimating track

- [x] Room / area line-item estimates (internal, not Xactimate)
- [x] Claim fields (claim #, carrier, date of loss)
- [x] Estimate PDF
- [ ] Evaluate Xactimate import/export only after vendor terms verified — **deferred**

## Later — Print Ops (separate product shell)

- [x] Print job types + production statuses
- [x] Print Ops nav shell (`/print`) separate from Field Ops jobs
- [x] Proof workflow (send / revise / approve) + revise count
- [x] Press / production board (`/print/board`)
- [x] File uploads on print jobs (R2)
- [x] Quote line items (sync to job estimate)
- [x] Pickup / delivery method + notes

## Bug triage rules (always)

1. P0 (cannot sign in / schedule / save job): fix same session before new features
2. P1: fix before the next feature
3. P2: append to Release 1.1
