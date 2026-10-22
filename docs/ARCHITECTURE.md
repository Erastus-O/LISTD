# LISTD — architecture

This document is for developers taking the LISTD MVP into production. It covers the following:

- how the code is put together
- the data it stores
- the rules it enforces
- what has to change for production

Product decisions are in `../DECISIONS.md`.

## 1. Three deliverables

| Deliverable | Folder | What it is |
|---|---|---|
| Marketing website | `website/` | Static site: `index.html` plus `css/`, `js/` and `images/`. No framework, no build needed. `build.py` makes a single-file copy in `dist/`. |
| Products (Client, Pro, Admin) | `platform/` | One codebase in plain JavaScript (ES2017, no framework, no bundler). `build.py` concatenates `src/` and `styles/` into single-file apps in `dist/`. |
| Design system | `design-system/` | Tokens (JSON + CSS) and component CSS. Both the website and the products use them. |

The products are built so they can be published as a claude.ai artifact; that is how the live MVP runs. Treat them as a working prototype and specification, not as production architecture. Section 8 lists what to replace.

## 2. Platform source map

The files are concatenated in this order (see `platform/build.py`). They share one global scope.

| File | Responsibility |
|---|---|
| `core.js` | Global state `S`, data cache `D`, environment `ENV`, catalogue (services, cleaning types, segments, statuses, Pro levels), default policies, price guide, store (`setDoc`, `patchDoc`, live snapshots), audit and notifications, file upload, shared UI helpers |
| `auth.js` | Sign-up, sign-in, Pro invitations (accept side), password reset, Admin TOTP two-step, sessions, legacy profile claiming |
| `actions.js` | Every lifecycle command (`cmd*`) with its guards, plus timed rules (`sweep`) |
| `client.js` | Client onboarding, properties, request wizard, payments, invoices |
| `job.js` | Job detail page used by all three roles: progress rail, scope, quote or invoice, money, history, messages |
| `pro.js` | Pro onboarding, dashboard, offers, schedule, earnings, report editor for cleaning and repairs |
| `settings.js` | Settings for every role: account, billing, profile, work, documents, payouts, security, 2FA, notifications, theme, privacy |
| `inspect.js` | Check-in and check-out report editor in the LISTD Inventory format, plus AI photo descriptions that the Pro must check |
| `pdf.js` | Inventory & Schedule of Condition PDF (jsPDF 2.5.1 from cdnjs) |
| `admin.js` | Admin overview, requests table, assignments calendar, reviews, disputes, finance, clients, properties, policies, audit, quote builder, offers, invoicing |
| `levels.js` | Pro levels 1–5, training library, level applications, Pros table and Pro detail page, Pro invitations (admin side) |
| `staff.js` | Staff roles (Main admin, Sub-admin, Operations), permission map, Users & roles settings |
| `app.js` | Shell: routing, top bar, navigation, render loop, notifications panel, modals, and all click, change and submit handlers |

### Render model
- `render()` rebuilds `#app` from state with `innerHTML`, using the view functions (`v*`). It keeps input values, focus, selection and scroll when the view key (`viewKey()`) is unchanged.
- Fields marked `data-rf`, `data-rfsel` or `data-mna` write straight into report drafts, so render doesn't restore them.
- Event handling is delegated at document level, as listed below. Delegation means re-renders never need rebinding.

| Hook | Used for |
|---|---|
| `[data-act]` | Clicks |
| `[data-go]` | Navigation |
| `form[data-form]` | Submits |
| `data-filt` | Filter changes |

- File inputs (`input[data-up]`) get direct `onchange` handlers after each render. Rendering pauses while the native picker is open (`S.picking`).
- The notifications panel lives outside `#app`, in `#notif-root`, so its slide-in animation isn't restarted by re-renders.

### Storage adapters
- **Published artifact (`ENV.mode === 'db'`):**
  - shared collections in the artifact database, with live `onSnapshot`
  - photos and files in the asset store
  - sign-in records in each person's private store (`data/users/<id>/auth`)
- **Local or demo (`ENV.mode === 'local'`):** everything is in `localStorage`, there is a single browser user, and AI is off.

## 3. Data model

Money is always integer pence (`...P`). Timestamps are ISO strings. Ids are random strings from `uid()`.

| Collection | Key fields |
|---|---|
| `clients` | `name, email, phone, segment (LANDLORD, ESTATE_AGENT, PROPERTY_MANAGER_DEVELOPER, HOUSING_ASSOCIATION), orgName, billing{…}, onboarding{status, step}, consent, prefs, ownerUid` |
| `properties` | `clientId, label, address, postcode, type, bedrooms, bathrooms, furnishing, access{…}, active` |
| `pros` | `name, firstName, email, phone, home, bizType, bizName, skills[], coverage[], availability{days[], slots[]}, docs[{type, fileId, name, expires}], payout{holder, last4, ready}, status (INVITED, DRAFT, PENDING, RESUBMIT, APPROVED, SUSPENDED, REJECTED), level 1–5, levelHistory[], trainings{trainingId: {at}}, invite{hash, sentAt, expiresAt, acceptedAt, cancelledAt}, emailVerifiedAt, onboarding, review, ownerUid` |
| `jobs` | `ref (LJ-1001), clientId, propertyId, propSnapshot, district, type (CHECK_IN, CHECK_OUT, MAINTENANCE), kind (REPAIRS_DAMAGES, CLEANING), scope{…}, window{date, slot}, status, quotes[], payments[], refunds[], offers[], proId, agreedFeeP, attendance{…}, reportDraft, reports[], disputes[], changeOrders[], settlement{…}, rating, info[], history[], baselineId, createdByAdmin` |
| `evidence` | `jobId, stage (BEFORE, AFTER, ATTEND), area, item, type (image, pdf), assetId or dataUrl, by, at`. Pro verification documents are also stored here (`category: verification`). |
| `messages` | `jobId, by (role), author, body, at` |
| `notes` | Notifications: `to ('c:<id>', 'p:<id>', 'admin'), text, jobId, read, at` |
| `audit` | `action, resType, resId, reason, role, actor, extra, at`. Every privileged Admin action is written here. |
| `trainings` | `title, desc, kind (video, pdf, link), assetId, dataUrl or url, fileName, level (0 = optional, 2–5 = required for that level), minutes, status (DRAFT, PUBLISHED, ARCHIVED)` |
| `applications` | `proId, kind (JOIN, LEVEL), from, to, status (PENDING, APPROVED, REJECTED, CHANGES, WITHDRAWN), note, snapshot{completed, rating, trainings[]}, decision{by, reason, at}` |
| `staff` | `name, email, role (MAIN, SUB, OPS), status (INVITED, ACTIVE, PENDING, REMOVED, DELETED), uid, accountId, joinedAt` |
| `settings/policy` | Admin policies: `quoteValidityDays, offerValidityHours, reviewHours, rescheduleHours, proFeePct, levels[{minJobs, minRating, sharePct}], guide{…}, repairCategories[], company{…}` |
| `data/users/<id>/auth` (private) | `accounts[{id, role, email, salt, hash (PBKDF2-SHA256, 150k), profileId, sessionVersion, mfa{secret}, name, prefs}]` |

What's inside a job:

| Field | Shape |
|---|---|
| Quote / invoice | `{v, lines[{d, q, u}], subP, taxP, discP, totalP, proFeeP, durationMin, exclusions, status (ISSUED, ACCEPTED, SUPERSEDED, EXPIRED, REJECTED), issuedAt, expiresAt}` |
| Payment | `{id, op, quoteV or coId, amountP, status, ref, at}` |
| Offer | `{id, proId, window, feeP, status, expiresAt}` |
| Report | `{v, sections, status (SUBMITTED, RETURNED, RELEASED), …}` |
| Dispute | `{id, by, category, text, status, outcome, refundP}` |
| Change order | `{id, desc, estimateP, totalP, proFeeP, status}` |

## 4. Request lifecycle

```
SUBMITTED ─▶ NEEDS_INFORMATION ─▶ SUBMITTED
SUBMITTED ─▶ QUOTED (quote, or invoice for repairs) ─▶ AWAITING_PAYMENT ─▶ READY_FOR_ASSIGNMENT
READY_FOR_ASSIGNMENT ─▶ (offer to a Pro, which accepts) ─▶ SCHEDULED ─▶ IN_PROGRESS (clock-in photo)
IN_PROGRESS ─▶ ADMIN_REVIEW ⇄ CORRECTION_REQUIRED ─▶ CLIENT_REVIEW ─▶ COMPLETED (accepted, or AUTO after 48h)
Any open state ─▶ ON_HOLD / CANCELLED (with reason and refund rules)
```

Payment, dispute and settlement are tracked separately from the job status. These rules are enforced in `actions.js`:

- **One open offer per job.** Offers expire after 12 hours, or at the start of the slot if that is sooner.
- **Eligibility** is checked both when an offer is sent and when it is accepted:
  - the Pro is approved
  - they have the skill
  - their **level** is high enough
  - the area is in their coverage
  - they're available on the day
  - none of their documents has expired
  - they aren't double-booked
- **Payout** is eligible only when the job is completed, there is no open dispute, and the Pro has a payout account. The amount is the fee on the accepted offer. Payouts are idempotent per job.
- **Repairs** are invoiced, and **cleaning and inspections** are quoted. Both use the same quote record: the client pays a repairs invoice in one step ("Pay invoice"), while a quote is accepted and then paid.

## 5. Pro levels and training

| Level | Can take | Default rule to apply | Pay share |
|---|---|---|---|
| 1 | Light cleans | Approved | 60% |
| 2 | Light and General cleans | 5 jobs, 4.0 rating | 65% |
| 3 | All cleans | 15 jobs, 4.3 rating | 70% |
| 4 | Inspections up to 3 bedrooms, plus all cleans | 25 jobs, 4.5 rating, all Level 4 trainings | 75% |
| 5 | Inspections of any size, plus all cleans | 40 jobs, 4.7 rating, all Level 4–5 trainings | 80% |

- **What controls the levels:** `requiredLevel(job)` decides the level a job needs, and `trainingGate(pro, level)` blocks Level 4 and 5 without the required trainings. There is no override.
- **Editable rules:** job counts, ratings and pay shares can be changed in Catalogue & policies.
- **Repairs:** a separately approved trade skill, not part of the levels.

## 6. Roles and permissions

| Area | Main admin | Sub-admin | Operations |
|---|---|---|---|
| Overview, requests, quotes and invoices, assignments, report reviews, invoicing, clients, properties | ✓ | ✓ | ✓ |
| Disputes, finance (refunds, payouts), Pros, training, audit log | ✓ | ✓ | |
| Catalogue and policies, users and roles | ✓ | | |

The permission map is `STAFF_AREAS` in `staff.js`. The first admin to sign in becomes the Main admin. Staff join by setting up admin sign-in with the email they were invited with.

Clients and Pros only ever see their own records in the interface. In the artifact database, however, every signed-in viewer can technically read the shared collections. Section 8 covers the fix.

## 7. Authentication

| Area | How it works now |
|---|---|
| Passwords | PBKDF2-SHA256 with 150,000 iterations and a random salt, hashed in the browser. Passwords are never stored in plain text. |
| Sessions | In browser storage, with a `sessionVersion` that changes on a reset or password change. Clients and Pros: 12 hours, or 30 days with "keep me signed in". Admins: 8 hours. |
| Admin sign-in | TOTP is always on for admins (RFC 6238, with a QR code from qrcode-generator 1.4.4). |
| Client and Pro two-factor | Optional, turned on or off in Settings. |
| Pro sign-up | Email and password only. The name is collected in onboarding. |
| Pro invitations | One-time 8-character code, stored only as a SHA-256 hash, valid for 7 days. The link is `#invite=CODE`. |

## 8. Production plan: what to replace

The domain logic carries over as it is: the state machine and guards in `actions.js`, levels, permissions, the quote and invoice maths, and the report format. The infrastructure needs replacing:

1. **API and database.** Move to Postgres with a server API. Enforce every `cmd*` guard on the server, inside transactions, so offer acceptance and payouts are atomic. Apply tenant and role policies there, using the permission map in section 6.
2. **Auth.** Use a managed identity provider with email verification and reset links sent by email. Use server-side sessions, and require MFA for staff. Staff invitations, roles and Pro invitations then become server records.
3. **Payments.** Use a payments marketplace provider (for example Stripe Connect) for checkout, refunds and Pro payouts, driven by webhooks. Keep the idempotency keys the MVP already uses (`op`).
4. **Files.** Use private object storage with signed URLs and malware scanning. Keep verification documents in a separate, restricted bucket.
5. **Background worker.** Run offer and quote expiry, the 48-hour auto-complete and reminders on a schedule. In the MVP these run when someone opens the app (`sweep`).
6. **Email and SMS.** Send Pro and staff invitations, notifications and receipts.
7. **AI photo descriptions.** Use a server-side vision model with logging, retention rules and human review. The Pro must still check each description, as now.
8. **Frontend.** Port the views to the team's framework of choice. `design-system/` and `platform/styles/` hold the tokens and components to reuse.
