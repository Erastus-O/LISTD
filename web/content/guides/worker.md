---
title: Worker Guide
role: worker
summary: Manage bookings on behalf of your organisation.
updated: 2026-05-17
---

This guide is for **org members** who book and manage inspections on
behalf of an organisation client - typically letting-agency
coordinators, property managers, or admin assistants at a portfolio
owner.

If you're booking inspections for yourself (a solo client), use the
[Client Guide](/help/client) instead.

## How worker access works

When an organisation signs up with LISTD, the owner invites team
members ("workers") who can book, track, and manage jobs under the
org's shared invoice + payout setup. Workers don't see the org's
billing settings or invite other workers - those stay with owners -
but they see everything that matters for getting jobs done.

| You can | You can't |
|---|---|
| Book new jobs against any of the org's properties | Change org-wide billing or tax details |
| See every job posted by anyone on the org | Invite or remove other workers |
| Cancel jobs (up to the same point a solo client could) | See payouts to clerks (admin/internal data) |
| Sign off reports on the org's behalf | Issue refunds or credit notes |
| Edit your own profile + notification settings | Edit other workers' profiles |

The org owner controls who has what role; if you need extra rights,
ask them.

## Quick start

1. **Accept the invitation email** LISTD sent you - first sign-in
   triggers a password setup if your owner used a temporary password.
2. From the dashboard, click **Post a job** to start a booking.
3. Pick from the **shared property list** the org has already added,
   or add a new one for the team to reuse.
4. Track the job through to sign-off - same lifecycle a solo client
   sees.

## Your dashboard

The worker dashboard at `/worker/dashboard` is scoped to the
**organisation**, not just you. So:

- **My jobs** is everything you personally booked
- **Team jobs** (the wider list under **Jobs**) is everything anyone
  on the org has posted - useful when a colleague is off and you need
  to chase

If you only ever want to see your own activity, the **My Jobs** tab is
filtered to your user id; **Jobs** is the org-wide view.

## Booking on behalf of the org

The booking flow is identical to the solo Client Guide - same form,
same fields, same pricing matrix. Two things are different:

- **Property list is shared.** Adding a new property makes it available
  to every worker on the org for future bookings. Spend the extra ten
  seconds typing accurate address details - your colleagues will reuse
  it for years.
- **Created-by attribution.** The job carries your user id as
  `createdByUserId`, but pricing, billing, and report ownership all
  roll up to the org. Admin notifications on this job CC both you and
  the org owners.

## Reviewing reports

When a clerk submits, admin runs the quality-review pass first. Once
they sign off internally, the report lands in **Awaiting your
sign-off**. Either you or any org owner can sign - first-mover wins,
the rest get a "signed by colleague" stamp.

If you'd rather an owner approve sensitive reports (e.g. disputed
check-outs), leave a note in the review thread and pass it across -
the queue isn't first-come-first-served.

## Notifications

Same channels as a solo client - email / in-app / SMS / push. Two
worker-specific defaults you might want to adjust at **Settings →
Notifications**:

- **`emailJobUpdates`** - ON. You want to know when your bookings hit
  each lifecycle step.
- **Org-wide notifications** - your owner has a separate setting
  controlling whether you get carbon-copied on jobs *other* workers
  posted. By default this is ON for owners but OFF for non-owner
  workers; flip it if you want full team visibility.

## Communication with the team

Each job has a **messages thread** (read-only on the worker side
right now, write access ships later) where admin can leave notes
visible to every worker on the org. Treat it as the single source of
truth for "what's happening with this job".

## Invoices and payments

**Invoices** shows every bill the org has been issued. You can see and
download them but only an org owner can:

- Update payment method
- Mark something as disputed
- Pay outstanding invoices (the payment-link buttons are owner-gated)

If you're the one who chases unpaid invoices day-to-day, ask your
owner to either move you to "owner" or set up a billing-specific
seat - we don't yet have a "finance-only" role but it's on the
backlog.

## Troubleshooting

### "I can't see a job a colleague booked"

Two reasons it might be hidden:

1. **The job was posted under a different organisation.** If your
   colleague has multiple memberships, they may have booked under a
   different org. Check the job ref number with them.
2. **Org-wide notifications were off when the job was created.** The
   in-app feed shows what was broadcast at the time; if your
   notifications were off, no entry exists. The job is still in
   **Jobs** if you go look for it.

### "Can I change another worker's job?"

Only cancel - and only while the job is still in `published` /
`pending` / `draft`. For anything after a clerk has accepted, the
posting worker (or an admin) has to do it.

### "What happens when I leave the org?"

Your access vanishes immediately. Jobs you booked stay associated
with the org (not deleted); a new worker can keep tracking them as
if they'd booked them. Your profile remains so historical audit logs
still resolve.

## Getting help

- **Email:** `support@listd.co.uk`
- **Your org owner** - for permission changes, billing questions, or
  team-roster updates.
- **In-app bell** - admin notifications often cover what's blocking
  a particular job.
