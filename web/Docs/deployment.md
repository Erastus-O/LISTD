# Listd-NEXT — Deployment Notes

Walk-through for the first deploy to Vercel and the cutover from the Lovable-hosted app. Pair with [vercel.json](../vercel.json) which holds region + function timeouts + cron schedules.

---

## Pre-flight

Before pushing to Vercel, the following must be true:

- [ ] DNS for the LISTD production domain is reachable but pointing at Lovable (we don't cut over until verification passes).
- [ ] All env-var values in [.env.example](../.env.example) are gathered locally and ready to paste — see "Secrets origin" below.
- [ ] Three cron-related SQL migrations applied to the Supabase project (M-Pre task #14 blocker — see [Docs/LISTD_M-Pre_Tasks.md](../../Docs/LISTD_M-Pre_Tasks.md)).
- [ ] Xero OAuth app's redirect URI list has both old and new entries during the transition (see "Xero re-registration" below).

## Vercel project creation

1. Connect Vercel to the GitHub repo.
2. **Root Directory** → `Listd-NEXT`. (The Lovable repo at the root is *not* the deploy target; setting this prevents Vercel inferring the wrong project.)
3. **Framework Preset** → Next.js (auto-detected).
4. **Build Command** → leave default (`next build`).
5. **Output Directory** → leave default.
6. **Install Command** → leave default (`npm install`).

## Environment variables

Paste each from `.env.example` into Vercel's Environment Variables UI. Use the same names; values come from the sources below.

| Variable | Origin |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Project Settings → API → Publishable key |
| `NEXT_PUBLIC_SITE_URL` | The Vercel deployment URL (or custom domain once attached) |
| `DATABASE_URL` | Supabase Dashboard → Database → Connection string → **Transaction pooler** (port 6543, append `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase Dashboard → Database → Connection string → **Session pooler or direct** (port 5432) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role secret |
| `RESEND_API_KEY` | Existing Supabase Edge Function secret, or Resend dashboard |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | Existing Supabase Edge Function secrets, or Xero developer app |
| `EXTERNAL_API_KEY` | Existing Supabase Edge Function secret |
| `INVENTORYBASE_CALENDAR_KEY` | Existing Supabase Edge Function secret |
| `MAKE_WEBHOOK_SECRET` | Generate fresh: `openssl rand -base64 32` |
| `CRON_SECRET` | Vercel auto-generates this when cron is detected, or set manually with `openssl rand -base64 32` |

**Scope:** mark all as available to Production, Preview, and Development unless noted otherwise. URL passwords / connection strings should differ between Preview and Production if you have a separate staging Supabase project.

## Cron registration

Crons in [vercel.json](../vercel.json):

| Path | Schedule (UTC) | Maps to |
|---|---|---|
| `/api/cron/recycle-jobs` | `*/15 * * * *` (every 15 min) | M-Pre task #14, blocked |
| `/api/cron/upsell-reminders` | `0 9 * * *` (daily at 09:00) | M-Pre task #14, blocked |

The schedule is registered with Vercel even though the handler files are not yet present. After the schema migrations and the cron port land, the schedule fires on the existing entries — no second deploy needed for the schedule itself.

Vercel sends `Authorization: Bearer ${CRON_SECRET}` to scheduled handlers. The DAL helper [verifyCronAuth](../src/lib/webhooks.ts) handles validation.

## Xero re-registration

Xero requires the OAuth redirect URI list on the developer app to include the URL the callback will be invoked at. Two-step transition:

1. **Before cutover:** add `${NEXT_PUBLIC_SITE_URL}/api/xero/callback` to Xero's "Redirect URIs" alongside the existing `${SUPABASE_URL}/functions/v1/xero-callback`. Both are valid during the transition.
2. **After cutover** (M-Pre task #17): remove the old `/functions/v1/xero-callback` entry to revoke the legacy path.

Until step 1 is done, any new Xero connect flow from the Vercel-hosted app will fail with `redirect_uri_mismatch`.

## Domain cutover (M-Pre task #17)

Defer until:

- The 21 ported route handlers are smoke-tested against the production Supabase project from the Vercel deployment URL.
- Cron handlers exist and have fired at least once on the cron schedule.
- Xero round-trip is verified end-to-end (authorize → callback → invoice → payment).
- Page count target for #10 phases 1–6 is met.

Then:

1. Add the custom domain in Vercel.
2. Update DNS A/AAAA/CNAME records per Vercel's instructions.
3. Update `NEXT_PUBLIC_SITE_URL` to the production domain (re-deploy required for the env-var change to take effect).
4. Update Xero redirect URIs to use the production domain (drop the Vercel preview URL if you used it during step 1).
5. Set the Lovable project to read-only.

## Post-deploy smoke checklist

- [ ] `/` renders the LISTD landing placeholder.
- [ ] `/auth` page loads (still a stub until #10 Phase 1).
- [ ] `/admin/dashboard` 401s for an unauthenticated browser.
- [ ] `POST /api/contact` with valid body returns 204 and an email lands at `hello@listd.co.uk`.
- [ ] `POST /api/auth/password-reset` for an existing email triggers a Resend email.
- [ ] `GET /api/jobs/published` with the correct `x-api-key` returns the published job list.
- [ ] Vercel function logs show no `RESEND_API_KEY is not set` or `DATABASE_URL is not set` errors.
- [ ] Cron entries appear in **Project → Cron Jobs** in the Vercel dashboard.

## Rollback plan

If post-deploy verification fails badly:

1. **Domain is still on Lovable** if you followed the order above — Vercel deploy can be left running while you debug.
2. If the domain has already been cut over, revert the DNS records (TTL-dependent — keep a small TTL during cutover for a fast rollback).
3. The Lovable Edge Functions remain running in Supabase until explicitly disabled, so the old API surface is still alive.
