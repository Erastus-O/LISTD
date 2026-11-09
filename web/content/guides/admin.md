---
title: Admin Operations Guide
role: admin
summary: Quality review, dispute handling, clerk verification, platform settings.
updated: 2026-05-17
---

This is the internal-operations guide for LISTD admins. It assumes you
already understand the platform mechanics; the guide focuses on the
day-to-day workflows, escalation paths, and how to handle the cases
the automation doesn't cover.

Public-facing material lives in the [Client](/help/client),
[Worker](/help/worker), and [Clerk](/help/clerk) guides.

## Daily morning checklist

Open `/admin/dashboard` and triage in this order:

1. **Alerts panel** - unaccepted jobs older than 6h (warning) or 24h
   (error), expiring clerk documents, quality-review backlog. Each
   has a one-click drill-down.
2. **Quality review queue** - `/admin/quality-review`. Anything older
   than 4h is overdue; anything older than 12h is the error tone.
   These are SLA-sensitive: the client is waiting on you to sign off.
3. **Disputes** - `/admin/disputes`. Any new dispute lands here.
   Same-day acknowledgement is the target.
4. **Pending invoices** - the dashboard "Outstanding invoices" KPI
   links straight into `/admin/invoices?status=overdue`.

The dashboard KPIs are cached for 60s, so if you refresh and don't see
a number move immediately, give it a minute.

## Quality review

### What you're checking

Every submitted report comes here. The job's clerk has captured photos
+ ratings; you decide whether the work meets LISTD standards before
the client sees it.

Look for:

- **Coverage.** Every room template item has at least one photo.
- **Photo quality.** Sharp, well-lit, framed. Reject pixelated /
  motion-blurred / wrong-room captures.
- **Ratings sanity.** A room marked "excellent" with damage photos
  attached is inconsistent.
- **Special instructions.** If the client asked for a specific focus,
  it must be addressed.

### Decisions you can make

| Decision | Effect |
|---|---|
| **Sign off** | Status → `signed`, PDF generation kicks in, payout schedules, client notified |
| **Return for revision** | Status → `returned`, clerk gets the comment thread, can resubmit |
| **Reject** | Status → `rejected`, clerk loses the job, no payout, dispute path |

Be explicit in return comments - clerks can't read between the lines.
Reference the specific room and item name, not a generic "needs more
photos".

### Sign-off mechanics

Your sign-off triggers:

1. Invoice generation (provider chosen via `/admin/settings/billing`)
2. Clerk payout scheduling (Friday of the next pay-cycle)
3. Email to the client with the report PDF
4. `job_lifecycle/job.signed` audit row

If anything in that chain fails, you'll see an alert in the activity
feed within ~30 seconds. The most common failure is a missing email
on the client's auth record - fix it via `/admin/clients/[id]` then
re-trigger the sign-off side-effects via the "Replay sign-off" button.

## Disputes

### Flow

Disputes are raised by clients (or admins on a client's behalf) when
they're unhappy with a report. The dispute lives independently of the
job's status - a `signed` job can still have an open dispute.

Each dispute has:

- A reason chosen from a fixed list (poor photo quality, missed
  rooms, factual errors, scheduling issues, etc.)
- A free-text description
- Optional photos / attachments
- A status: `open` → `investigating` → `resolved` (or `rejected`)

### Resolution

Resolution outcomes:

- **Uphold dispute** - typically refund + payout claw-back. The
  clerk gets a strike (see Strikes below).
- **Reject dispute** - explain the reasoning in the resolution note;
  client gets the response in their notifications.
- **Partial uphold** - split refund + retain payout; case-by-case.

Resolution writes an audit row + notification to all parties.
**Strikes** are separate - adding one is a deliberate second action
on `/admin/clerks/[id]`.

## Clerk verification

`/admin/clerks` lists every clerk by verification status:

- **Pending** - applied, awaiting your review
- **Verified** - active, can accept jobs
- **Restricted** - flagged; can't accept new jobs
- **Suspended** - same but harder; explicit reinstatement needed

### Verifying a new clerk

Open the clerk detail page. The verification panel checks:

1. **Identity document** - passport / driving licence / settled-status
   share code. We don't store the document, just the verification
   outcome.
2. **Insurance** - public liability + professional indemnity. Note
   the expiry date - the cron `clerk-doc-expiry` will email them at
   30-day warning intervals.
3. **DBS / criminal record check** - for clerks working in occupied
   properties (mid-term inspections especially).
4. **Qualifications** - ARLA / NRLA / similar; required for level
   2+ payouts.
5. **References** - at least two from prior clerk / inspection roles.

Sign-off promotes them to `verified`. They get a welcome email + can
log in immediately.

### Restricting or suspending

Use **Restrict** for soft warnings - too many disputes in a window,
slow response time. The clerk keeps their existing jobs but can't
accept new ones.

Use **Suspend** for hard cases - fraud suspicion, serious complaint,
incident report. Suspended clerks can't log in.

Both write `account_status/clerk.<verb>` audit rows.

## Strikes

Per the clerk agreement, clerks accumulate strikes for serious
issues:

| Strikes | Consequence |
|---|---|
| 1 | Warning email; written record |
| 2 | Restricted for 30 days |
| 3 | Suspended pending review |

Strikes are issued from `/admin/clerks/[id]` → **Issue strike**.
Always pair with a written reason - strikes without context are
impossible to defend in an unfair-dismissal challenge.

## Pricing changes

`/admin/pricing` shows the canonical pricing matrix (size × tier ×
furnished status). Changing a value writes a
`platform_setting/pricing.updated` audit row and busts the cached
matrix on the next quote.

**Don't change pricing without sign-off** - pricing changes affect
all future bookings, and clients who got quoted under the old prices
may dispute if they discover later that a different number was
applied.

## Platform settings

`/admin/settings` is the catch-all surface:

- **Trustpilot** - embed code + review link. Visible on the public
  landing.
- **Social** - Instagram / Facebook / LinkedIn / TikTok / X /
  WhatsApp links shown in the footer.
- **Tax rates** - VAT bands used by the invoice generator.
- **Company details** - registered address, VAT number, company
  number for invoices.
- **Billing provider** - Inbuilt (Stripe) vs Xero. Switching
  providers mid-cycle is supported but creates a one-time
  reconciliation task.

### Announcement banner

`/admin/notifications` controls the platform announcement banner -
the strip that appears across every authenticated page. Use it for:

- Service outages ("Image uploads delayed - investigating")
- Maintenance windows ("Read-only 02:00–04:00 GMT Sunday")
- Important policy changes (new fee schedule, terms update)

Set an expiry date - banners that hang around past their relevance
train users to ignore them.

### Notification automation settings

Same page, lower section. Tune the cron behaviour:

- **Upsell reminder cadences** - days between completed inventory →
  suggested check-in, check-in → mid-term, etc.
- **Recycle cadence** - how often unaccepted jobs get re-published
  with the urgent flag.
- **Quality-review SLA** - affects the dashboard alert thresholds.

Changes take effect on the next cron tick (15 min for recycle, daily
for the others).

## Cron jobs reference

| Cron | Schedule | Purpose |
|---|---|---|
| recycle-jobs | every 15min | Re-publishes stale unaccepted jobs with urgent flag |
| inventorybase-drift | hourly @ :05 | Detects iCal drift between LISTD + InventoryBase |
| clerk-doc-expiry | daily 06:00 UTC | Warns clerks about expiring docs |
| mark-overdue | daily 06:30 UTC | Flips overdue invoices |
| xero-invoice-reconciliation | daily 07:00 UTC | Pulls payment status from Xero |
| issue-recurring | daily 07:15 UTC | Issues invoices from recurring templates |
| upsell-reminders | daily 09:00 UTC | Sends "next service due" prompts |
| appointment-reminders | daily 17:00 UTC | Day-before reminders to clients + clerks |
| appointment-reminders-soon | every 10min | 2h-before push to clerks (when scheduled_at is set) |

All authorized via `CRON_SECRET`. Manual trigger by hitting the
endpoint with `Authorization: Bearer ${CRON_SECRET}` is supported for
testing.

## Email + SMS deliverability

`/admin/email-logs` shows every Resend send + bounce. Hard bounces
auto-disable email channels for the affected user. If a user reports
"I'm not getting emails":

1. Check `email_logs` for their address - recent failures?
2. If hard-bounced, their `notification_preferences.email*` toggles
   were auto-flipped to false. Confirm with them whether the bounce
   was real (typo / closed account) before re-enabling.
3. If no recent failure, check their `notification_preferences` -
   they may have opted out in their account.

The equivalent surface for SMS is `sms_logs`. Twilio STOP replies
auto-disable both `smsJobUpdates` and `smsPaymentUpdates` via the
inbound webhook.

## Impersonation

`/admin/impersonation` lets you sign in as another user to reproduce
a bug or verify a UI state. Use sparingly:

- Every impersonation start + end writes an audit row
- The impersonated user's session is unaffected (you're not "logging
  them out")
- You can't impersonate another admin - break-glass requires a
  second-admin co-sign

End the session via the "Exit impersonation" banner at the top of
every page you visit while impersonating.

## Getting help

- **Engineering Slack channel** - for app bugs and feature requests.
- **Operations runbook** (separate Notion doc) - for incidents,
  on-call rotation, and post-mortems.
- **Legal escalation** - `legal@listd.co.uk` for any dispute that
  references regulatory issues or threatens court action.
