---
title: Client Guide
role: client
summary: Book inspections, track progress, review and sign off reports.
updated: 2026-05-17
---

This guide covers how to use LISTD as a property client: booking
inspections, watching them move through the pipeline, and signing off
finished reports.

## Quick start

1. **Sign in** with the email LISTD invited you on.
2. From the dashboard, click **Post a job** to start the booking flow.
3. Fill in property + inspection type + scheduled date → confirm.
4. The job goes live; verified clerks in your area can pick it up.
5. Once submitted, review the report, leave comments if needed, and
   sign off.

## Your dashboard

The dashboard at `/client/dashboard` summarises your active pipeline:

- **Pending acceptance** - jobs you've published, waiting for a clerk
  to claim
- **In progress** - clerks are doing the work right now
- **Awaiting your sign-off** - reports are ready; you owe a review
- **Recent activity** - the latest five status changes across your
  jobs

Click any number to drill into the matching list.

## Booking an inspection

### Property details

You can either pick an existing property from your saved list or add
a new one inline. We store properties so repeat inspections (e.g. a
mid-term after an inventory) don't ask you to retype the address.

Required fields:

- Address line 1 + city + postcode (UK format, 5–8 chars)
- Property type (flat / house / studio / etc.)
- Bedrooms (1–9)
- Furnished status (furnished / unfurnished / part-furnished)

The furnished status drives pricing - furnished properties take longer
to inspect, so they cost more.

### Inspection type

Pick from:

| Type | When to use |
|---|---|
| **New Inventory** | First-time inventory for a new tenancy or property |
| **Check-In** | Tenant moving in - confirm condition matches inventory |
| **Mid-Term** | Periodic inspection during the tenancy |
| **Check-Out** | Tenant moving out - note differences vs check-in |
| **Interim** | Anything ad-hoc not covered by the other four |

### Scheduling

- **Date** - required. Pick a day at least 24h out; same-day bookings
  trigger our short-notice surcharge.
- **Preferred time slot** - optional but strongly recommended. Helps
  the clerk plan their route. Free-text but typical entries are
  "morning", "10am-12pm", "after 2pm".
- **Tenants attending** - yes/no/unsure. Drives whether the clerk
  needs your access details.

### Access

Tell us how the clerk gets in:

- **Key collection** - agent's office address, key safe code, or
  "tenant will let in"
- **Parking notes** - anything tricky (resident permits, paid parking,
  driveway access)

### Pricing and submit

The booking form computes the price as you change inputs:

- Base rate from the pricing matrix (size × tier × furnished status)
- Service tier markup (Core / Priority)
- Short-notice surcharge if scheduled within 24h

Submit → the job goes to status **Published**. Verified clerks in your
postcode area see it in their Available feed and can accept.

## Tracking a job

Open any job from **Jobs** to see the full timeline:

```
draft → pending → published → accepted → in_progress
       → submitted → reviewed → signed → completed → paid
```

The page shows what status you're in, who has it (clerk avatar +
name), and when it's scheduled. Cancel is available until a clerk has
accepted; after that, cancellation moves through admin (a small
clerk-time fee may apply per the agreement).

### Add to calendar

Once a job is published, the detail page shows two buttons:

- **Add to Google Calendar** - one-click open in Calendar with the
  event pre-filled
- **Download .ics** - universal file for Apple Calendar / Outlook /
  any other client

Adding the appointment to your personal cal means the tenant-access
prep doesn't sneak up on you. We'll also send a reminder email the
day before, with both calendar links and an attached `.ics`.

## Reviewing reports

When a clerk submits, admin runs a quality-review pass first. Once
that's signed off, the report appears in your **Awaiting your
sign-off** queue.

Open the report - every section is in a single PDF you can scroll
through. Two paths:

- **Approve and sign off** - the job moves to `signed`, invoice
  generation kicks in, and the clerk gets their payout scheduled.
- **Request changes** - leave comments per section. The clerk re-
  does the affected captures and resubmits.

A signed report can still be referenced any time from **Reports**.

## Notifications

**Settings → Notifications** controls how you hear from us:

| Channel | Best for |
|---|---|
| Email | Everything - reports ready, payment receipts, marketing |
| In-app (bell) | Quick status pings when you're in the dashboard |
| SMS | Time-critical reminders (mid-term reminder, check-out reminder) |

By design you can pick any combination. The toggles are remembered
per-channel: you can have email reminders on but SMS off, for
instance.

### Reminder windows

- **Day-before** appointment email - fires at ~17:00 UTC the night
  before. Includes the calendar attachment.
- **Two-hours-before** - currently goes to the clerk only (route
  planning). Not sent to clients.

## Invoices and payments

**Invoices** lists every bill LISTD has issued to you. Status meanings:

- **Draft** - created but not sent
- **Issued** - emailed to you with payment link
- **Paid** - payment recorded
- **Overdue** - past the due date; we may pause new bookings
- **Void** / **Credit Note** - cancelled or refunded

Pay any open invoice via the link in the email or the **Pay now**
button on the invoice detail page. Both Stripe (card / bank transfer)
and Xero-direct (BACS) are supported depending on your billing
settings.

## Your team

If you booked under an organisation, **Team** shows the org members
who can also act on your bookings. Owners can:

- See every job under the org
- Cancel any of them up to the same point in the lifecycle
- Receive copies of admin notifications

Workers (non-owner members) book on the org's behalf - see the
[Worker Guide](/help/worker) for their flow.

## Troubleshooting

### "My job didn't get picked up"

Three things to check:

1. **Postcode coverage.** Verified clerks set their own coverage
   areas. A first-of-its-kind postcode might genuinely have no clerk
   on rotation yet - contact `support@listd.co.uk` and we'll prioritise
   recruitment.
2. **Short notice.** Jobs scheduled within 24h sometimes don't get
   accepted; pricing on those is automatically uplifted but it's not
   a guarantee. Move the date out if you can.
3. **Service type rarity.** Interim inspections (the catch-all type)
   get fewer claims than the standard four - be explicit in special
   instructions about what you actually need.

### "The clerk didn't show up"

Use the in-app **Raise a concern** on the job detail page - it routes
straight to admin and we follow up the same business day.

### "I'm not getting reminder emails"

Check **Settings → Notifications** that the relevant email toggle is
on (`emailMidtermReminder` / `emailCheckoutReminder` / `emailJobUpdates`
depending on the inspection type). Then check your spam folder - UK
inboxes occasionally route our domain through filters.

## Getting help

- **Email:** `support@listd.co.uk`
- **In-app:** Click the bell icon for outstanding admin messages on
  your jobs.
- **Phone:** Listed in your welcome email - for urgent same-day
  issues only.
