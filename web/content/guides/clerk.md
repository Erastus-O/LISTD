---
title: Clerk Handbook
role: clerk
summary: Field guide for verified LISTD clerks - capture, sync, submit.
updated: 2026-05-17
---

Welcome. This handbook covers the workflows you'll use day-to-day as a
verified LISTD clerk. Most of your work happens on the **Mobile PWA**
(`m.listd.pro`); the desktop app is available for the few things that
are easier on a larger screen.

## Quick start

1. **Sign in** at `m.listd.pro` using the email LISTD set you up with.
2. **Install the PWA** when prompted - homescreen install gives you
   offline support, push notifications, and a cleaner full-screen
   experience.
3. **Browse Available** to find jobs in your coverage area.
4. **Accept a job**, complete the capture, then **Submit for review**.

If anything in the app surprises you, your first stop should be the
in-app sync banner - it shows whether the work you've captured is
safely backed up or still queued on your device.

## Getting set up

### Your profile

Open **Account → Settings** to fill out:

- **Full name** - used on every notification we send about your jobs.
- **Phone** - required for SMS reminders (only sent if you opt in).
- **Coverage areas** - postcode prefixes you're willing to work in
  (e.g. `SW1`, `E14`). Jobs outside your coverage won't appear in
  Available.
- **Service types offered** - which inspection types you'll accept.
  You can change this any time.
- **Vehicle details** + **languages** - diagnostic for the admin
  matching tool; not visible to clients.

### Notification preferences

**Account → Notifications** lets you pick how you hear from LISTD:

| Channel | What you'll get |
|---|---|
| Email | Job assignments, payout statements, reminders |
| In-app (bell) | Real-time job events when the app is open |
| SMS | Critical reminders only - appointment day-before, etc. |
| Push (mobile PWA) | Job-starts-in-2-hours pings on installed devices |

By design, you can have all of them on, just one, or none. SMS and push
are off by default - you opt in deliberately.

## Finding work

### Available jobs

The **Available** tab shows every published job in your coverage area
that matches one of your service types. Each card shows:

- The property address and postcode
- Inspection type
- Scheduled date + preferred time slot (if the client set one)
- Your payout

Tap into a job to see the full details - access notes, special
instructions, what the client is paying. Two clerks can't claim the
same job; if you're racing someone else and lose, you'll see "Already
claimed by another clerk" - that's normal, not a bug.

### My Jobs

Everything you've accepted lives in **My Jobs**, organised by status:

- **Accepted** - claimed but not started
- **In progress** - you've started capture
- **Submitted** - sent for review; out of your hands now

### Archive

**Archive** holds your completed jobs. PDF reports are accessible here
once they're signed off - tap any row to download a fresh signed link
(those links are 5-minute one-shots, regenerated on every tap).

## Doing an inspection

### Plan your day

If the job has a **scheduled time**, the day-before reminder email
includes a `.ics` calendar attachment - opening it in Apple
Calendar / Google Calendar / Outlook adds the appointment to your
personal cal in one tap. The "Add to Google Calendar" link in the
email body works without OAuth and pre-fills the event.

Two hours before each appointment, if you've installed the PWA and
opted in to push notifications, you'll get a "Mid-Term in ~2 hours"
banner on your phone with the address - useful when you're juggling
multiple jobs in a day.

### Capture flow

Tap **Start capture** on the job detail page to open the room-by-room
overview. Each property is broken into rooms (kitchen, bedroom 1, etc.)
based on the report template the client selected.

For each room:

1. **Take photos** with the in-app camera (use the gallery picker only
   if you've already shot pictures elsewhere - direct camera is faster
   and writes lower-quality JPEGs that fit more captures into limited
   storage).
2. **Add notes / condition ratings** where the template requires them.
3. Tap **Mark room complete** when you're satisfied.

The completion check on each room turns green once you've marked it
done. You can come back and add more photos later - the room stays
"complete" until you explicitly un-complete it.

### Offline mode

You can do the entire capture flow offline. Every photo is queued in
your phone's storage and uploaded automatically when you regain
signal. The **sync banner** under the top header tells you what state
the queue is in:

- **(hidden)** - no pending work, you're up to date
- **Syncing N…** - uploads in progress, sit tight
- **N failed - tap to retry** - one or more uploads errored out
  (usually a network blip); tap to retry
- **>24h queued - tap to retry** - captures have been sitting in your
  queue for over a day; iOS can evict storage at any time, so sync
  ASAP
- **Storage almost full** - your phone's ~80%+ full; some captures
  may evict if you don't sync soon

The **Sync now** button on Account → Sync status forces an immediate
drain. Use it when you've just regained signal and want to confirm
everything went through before driving away.

### Submit for review

When every room is marked complete AND the offline queue is empty, the
**Submit for review** CTA at the bottom of the capture overview
becomes enabled. Tap it → confirm the bottom-sheet warning
("you won't be able to add more captures after this") → done.

The admin team takes it from there: quality review, sign-off, PDF
report generation, payout calculation. You'll see the job move from
"In progress" → "Submitted" → "Reviewed" → "Signed" → "Paid" in your
**My Jobs** and **Archive** views as it progresses.

## Payouts

**Earnings** (desktop sidebar, or "Earnings" in your account) shows
your payout schedule, completed jobs, and any bonuses. Payouts are
processed on the dates shown - typically the Friday after sign-off.

If a payout looks wrong, raise it via the **Help → Contact admin**
link before disputing publicly - admin can usually correct a tier
miscalculation or missed bonus the same day.

## Troubleshooting

### "My install banner doesn't appear"

The install banner shows up *after* you've completed at least one
inspection. That's deliberate - installing the PWA before you've
worked a job is friction without value. After your first submit, the
banner appears on the next page navigation.

### "iOS - can I install without seeing the banner?"

Yes. In Safari, tap the **Share** button → **Add to Home Screen**.
That's the same flow our iOS install guide walks you through.

### "I missed a push notification"

Check your phone's settings - iOS in particular silently throttles
notifications if you've ignored them in the past. The day-before
email always fires regardless, so you have a backup channel.

### "I can't see a job I should be able to see"

Two common causes:

1. **Coverage area mismatch.** Check the job's postcode prefix is in
   your `Coverage areas` list (Account → Settings).
2. **Service type not enabled.** If you haven't ticked the inspection
   type the job needs, it's hidden by design.

### "My capture queue says >24h - should I worry?"

Yes. iOS evicts cached data aggressively, and 24h is the point where
we start showing the warning. Sync ASAP - once it clears, the warning
disappears.

## Getting help

- **In-app:** Tap the bell icon for system notifications about your
  account.
- **Email:** `clerks@listd.co.uk` for anything urgent (payouts,
  account issues, technical problems).
- **Admin contact:** From any job detail, an admin can reach out via
  the in-app messaging thread.
