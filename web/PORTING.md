# Porting LISTD to the new UI

This app (`web/`) is the new LISTD in Next.js. It combines two sources:

| Source | What it provides |
|---|---|
| `Deskstop/ListdPro` (production) | Database layer, auth, API routes, Stripe, reports, crons, integrations |
| `UI/LISTD` (client prototype) | Design system, website, screen designs and the business rules below |

**Where they differ, the new interface wins** (decided Nov 2026). This app runs on its own Supabase project (`qflhjivpwgujfliqalvt`) for database, auth and storage. It is separate from the one ListdPro uses. ListdPro is unchanged, and its data is not being moved.

## Status

### Backend: built and tested

Domain code lives in `src/lib/listd/`. Tests: `npm test` (pure logic) and `npm run test:staging` (real database).

| Area | What's built |
|---|---|
| Rate card pricing | `pricing.ts`. Every figure in the website's inspection table is pinned by a test. Editable at Admin > Pricing. Old tier matrices and the platform fee no longer apply to new bookings |
| Booking | `POST /api/jobs/create`. One job per service, linked by `group_id`, one shared checkout. Priority set by the date. Coverage refused by postcode |
| Client approval | `lifecycle.ts`. LISTD review opens a 48-hour window; the client approves; or it auto-completes, recorded as AUTO |
| Weekly payouts | `runWeeklyPayouts`. Pays approved jobs, can't double-pay, skips disputed jobs. A Pro without payouts set up is retried next week |
| Disputes | Stop the clock, block approval, freeze the payout. Settling gives a fresh window |
| Roles and levels | `pro-levels.ts`. Three levels per role. Checked in the job feed and again on accept, along with vetting: an unverified Pro is refused. The fee is set from the accepting Pro's level |
| Standards check, level applications, training | Built, including "no override" on required training |
| Quotes | `quotes.ts`. Versioned, expire after 7 days, an update needs a reason |
| Repairs & Maintenance, Pro Trades | Booking, £50 diagnosis, fixed quotes, repair report, LISTD review |
| Change orders | Propose, price, approve, with the diagnosis credit applied once. **Payment for approved extra work is not built yet** |
| Cleaning | Standard, Deep, End of Tenancy, Office, with add-ons and checklists. Estimate, then a fixed quote |
| Portfolio rebates | Monthly tiers and rebate calculation, recorded once per client and month. No admin screen yet (API only) |

### Screens

| Area | State |
|---|---|
| Website, sign-in and password screens, app shell and navigation | Done |
| Booking wizard | New |
| Client booking page: quote, approve, corrections, dispute, extra work | New panel on the existing page |
| Admin: quote builder, change-order pricing, rate card, training, Pro levels | New |
| Pro: training and level, repair report | New |
| About 95 other signed-in screens | **Restyled only.** They work, with the new look on their old layouts. See "Screens still to rebuild" |

### How this was checked

Run against the app's Supabase project, on a local production build, with no Stripe, email or SMS keys:

- `npm test`, `npm run test:staging` and the production build pass, plus types.
- Signed in through Supabase Auth as each role and loaded 76 pages, including job detail pages, with no server errors. Other roles' pages are refused.
- Real requests: create a property, book each kind of service, issue and accept a quote, a Pro accepting a job, both new crons.
- Security: the public key alone reads nothing, a client can't make themselves admin or edit another profile, and storage folders are private to their owner.
- **Not checked:** clicking through in a real browser, the booking wizard screen, the report editor and photo upload, any email or SMS (sign-up confirmation and password reset included).
- **Real Stripe payments have never run** through the new checkout, webhooks, weekly payouts or refunds. The tests stand in for Stripe.

## What's needed next

| Needed | Why |
|---|---|
| Stripe test keys | Checkout, webhooks, payouts, refunds |
| Supabase Auth settings: Site URL, Redirect URLs (`https://app.listd.co.uk/**`), SMTP | Sign-up confirmation and password reset links. Set in the Supabase dashboard |
| Resend and Twilio keys | Email and SMS |

## Before go-live

### Decisions still open

1. **Legal text.** Terms and the client onboarding agreement still say "escrow" and describe the old release of funds. They need a legal review, and must reflect client approval, auto-complete after 48 hours and weekly payouts.
2. **Placeholders the client marked "to confirm":** level rules, hourly rates, mid-term prices, Pro minutes, weekly payouts, South West postcode areas.
3. **The client's tiered-price idea** (client picks a level band). Contradicts "one service standard". Not built.
4. **NatWest Accelerator and the phone number:** both removed, following the prototype. Confirm.

### Existing data

**Fresh start** (decided Nov 2026). Nothing is copied from ListdPro's project: users sign up again, and Pros are verified and given levels from scratch. ListdPro's records stay where they are.

- Jobs, payments and payouts still in progress on ListdPro at switch-over have to be finished there, or handled by hand.
- `0042`'s level backfill does nothing on an empty database. Every new Pro starts at Level 1.

### Known gaps

- Change orders: approved extra work can't be paid yet.
- Repair reports take written notes only. Before and after photos aren't built, so a repair report can't yet carry the evidence the website promises.
- Promo codes apply to fixed-price services only, not to quoted ones.
- `/api/cleaning/jobs/create` is retired (returns 410). HMO invoicing there needs checking against the new flow.
- A property's floor area, outbuildings and outdoor flags are priced, but the property form doesn't collect them yet.
- Report rating still uses the old condition scale. The prototype's New to Very poor scale isn't ported.
- Not built: staff roles (Main, Sub-admin, Operations), phone codes for key decisions, two-factor sign-in, the analytics drivers page, the client properties page, per-role Pro onboarding documents.

## Kept from production, not in the prototype

Tenant portal and tenant signing · invoicing, recurring invoices, reconciliation, statements, credit notes · Xero · InventoryBase · promo codes and invoice-later billing · teams (organisations and workers) · SMS, WhatsApp, push and email · AI assistant and report drafting · SEO admin and site scripts · careers admin and applications · data subject requests and retention · impersonation · Trustpilot · jobs map and calendar · all crons.

Confirm with the client if any of these can be dropped. Nothing has been removed.

## Screens still to rebuild

Suggested order, by how much users see them. The prototype reference is in `platform/src/`.

1. Client: dashboard, bookings list and detail (`client.js`, `job.js`)
2. Pro: dashboard, jobs, schedule, earnings (`pro.js`), and cleaner equivalents
3. Inspection report editor (`inspect.js`). High risk, so reuse the existing logic and test carefully
4. Admin: overview and work queues, bookings, report reviews, Pros, finance (`admin.js`, `levels.js`)
5. Onboarding for clients and Pros
6. Settings (`settings.js`)

## Database rules

- `npm run db:setup` builds or updates the app's Supabase project. Safe to re-run: applied files are tracked in `_app_migrations`. `scripts/supabase/env.cjs` names the only project it accepts.
- Do not run `db:migrate` or `db:push` from this app without review.
- The migrations alone can't rebuild the schema. `scripts/staging/` holds the legacy functions, triggers and dashboard tables, from the old repo's April 2026 export and `schema.ts`. `sql/` holds the hand-run bucket scripts. A schema-only dump of ListdPro's database would show any drift.
- `generated-reports` and `signatures` were created by hand on ListdPro, so `db:setup` creates them, private. Only `avatars` and `organisation-logos` are public.
- **`DATABASE_URL` password:** it contains literal `%` characters, which must be written as `%25` in the URL. `scripts/supabase/env.cjs` does this locally. In Vercel, enter the escaped form, or the app can't connect.
- The app reads `SUPABASE_SERVICE_ROLE_KEY`. In Vercel, set it to the value `.env.local` calls `SUPABASE_SECRET_KEY`.
- **Crons are off here on purpose.** Schedules are in `vercel.crons.cutover.json`, including the new `auto-approve` and `weekly-payouts`.
- **Webhooks stay on ListdPro until cutover** (Stripe, Resend, Twilio, Make, InventoryBase).

## Running it

```
cd web
npm ci
npm run db:setup                          # build or update the schema
node scripts/supabase/test-users.cjs add  # one test account per role
npm run app:build
node scripts/supabase/with-env.cjs next start -p 3100
```

`npm run app:dev` runs the dev server instead. These commands load no Stripe, email or SMS keys.

Test account passwords are generated into `../.env.test-users.local`. Emails are `test-<role>@listd-test.invalid`.

**Database tests** create and delete rows. Put a Neon URL in `../.env.local` as `TEST_DATABASE_URL`, or set `ALLOW_TESTS_ON_APP_DB=1` to use the app's project. Never set that once it holds real customers. The tests remove their users and jobs but leave log rows (notifications, audit events, payout runs).

No secrets are stored in this folder, and `.env*` is git-ignored.

## Cutover checklist

- [ ] Open decisions above settled, and legal text updated
- [ ] Stripe test keys in place, with the full flow tested for each role
- [ ] Supabase Auth settings and email in place; sign-up and password reset tested
- [ ] Plan for jobs and payouts still open on ListdPro at switch-over, and for telling existing users to sign up again
- [ ] Vercel env set, including the escaped `DATABASE_URL`
- [ ] Test accounts removed: `node scripts/supabase/test-users.cjs remove`
- [ ] Domains pointed at this app; `lib/hosts.ts` confirmed
- [ ] Crons moved back into `vercel.json` and removed from the old deployment, in the same release
- [ ] Webhook endpoints checked in Stripe, Resend and Twilio
- [ ] Mobile app checked against these API routes, and pointed at the new Supabase project
- [ ] Old deployment retired
