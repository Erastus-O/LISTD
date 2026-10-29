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
| `auth.js` | Sign-up, sign-in, Pro invitations (accept side), password reset, optional TOTP two-factor, sessions, legacy profile claiming |
| `actions.js` | Every lifecycle command (`cmd*`) with its guards, plus timed rules (`sweep`) |
| `client.js` | Client onboarding, properties, request wizard, payments, invoices |
| `job.js` | Job detail page used by all three roles: progress rail, scope, quote or invoice, money, history, messages |
| `pro.js` | Pro onboarding, dashboard, offers, schedule, earnings, report editor for cleaning and repairs |
| `settings.js` | Settings for every role: account, billing, profile, work, documents, payouts, security, 2FA, notifications, theme, privacy |
| `inspect.js` | Inventory, check-in, mid-term and check-out report editor in the LISTD Inventory format, with tenant walk-through sign-off for check-in and check-out, plus AI photo descriptions that the Pro must check |
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
| `jobs` | `ref (LJ-1001), clientId, propertyId, propSnapshot, district, type (INVENTORY, CHECK_IN, MID_TERM, CHECK_OUT, MAINTENANCE), kind (REPAIRS_DAMAGES, CLEANING), groupId (services booked together), scope{…}, window{date, slot}, status, quotes[], payments[], refunds[], offers[], proId, agreedFeeP, attendance{…}, reportDraft, reports[], disputes[], changeOrders[], settlement{…}, rating, info[], history[], baselineId, createdByAdmin` |
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

## 4. Services and booking

| Service | Stored as | Report | Compared with | Sign-off |
|---|---|---|---|---|
| Inventory | `type: INVENTORY` | LISTD Inventory format | — | — |
| Check-In | `type: CHECK_IN` | LISTD Inventory format, starting from the latest inventory | — | Tenant walk-through sign-off |
| Mid-Term | `type: MID_TERM` | LISTD Inventory format | Latest released check-in or inventory | — |
| Check-Out | `type: CHECK_OUT` | LISTD Inventory format | Latest released check-in or inventory | Tenant walk-through sign-off |
| Repairs & Damages | `type: MAINTENANCE, kind: REPAIRS_DAMAGES` | Diagnosis, work, before/after photos | — | — |
| Cleaning | `type: MAINTENANCE, kind: CLEANING` | Checklist, before/after photos | — | — |

A client can pick several services in one booking. `cmdSubmitMany` creates one request per service, sharing a `groupId`, and each request keeps only its own details. Each service has its own quote (an invoice for repairs), payment, Pro and report. Photos added in the booking go with the repair request, or with the first request if there is no repair. All inspections need a Level 4 Pro with the matching skill, or Level 5 for 4+ bedrooms.

## 4c. Pricing engine (`src/pricing.js`)

Money is in pence. `pricing()` merges `settings.pricing` over `DEFAULT_PRICING`; the Main admin edits it on Admin › Pricing.

| Function | Does |
|---|---|
| `priceInspection(k, prop, {combo, sched})` | Rate-card line by size, same-visit saving, one furnishing line, extra rooms, outbuildings/outdoor, Flex or Priority line. Returns `custom` for 5+ beds, heavy furnishing or unusual floor area |
| `priceCleaning(prop, scope, {sched})` | Cleaner-hours from type, size, bathrooms, condition and add-ons; minimum booking; estimate range |
| `priceDiagnosis()` / `repairProFee(lines)` | £50 diagnosis visit; Pro fee = labour share + materials at cost |
| `quoteFor(j)` | The quote for any job; prefills the Admin quote builder |
| `cmdAutoQuote(j)` | Issues the fixed quote at submission for inspections and diagnosis visits |
| `feeFromBase(proBase, level)` | Pro fee = attendance + minutes × level hourly rate + allowances |
| `contribution(revP, proP)` | Contribution after Pro fee, payment, ops and rework costs, against the floor |
| `portfolio(clientId, month)` / `portfolioLine` | Monthly tier, eligible fees, rebate due (capped at the floor); negotiated rate line |
| `schedWindowOk`, `addWorkDays`, `workDaysUntil` | Flex / Standard / Priority date rules in working days |
| `pilotStats()` / `vAdminPricing()` | Pilot measures and the editable rate card |

Quote lines carry a `tag` (`svc`, `urgency`, `sched`, `materials`, `credit`, `portfolio`) so rebates exclude urgency and materials. Scope fields added: `sched`, `flexDates`, `sameVisit`, `addons`, `carpetRooms`, `areaM2`, `frequency`, `facilities`, `repairMode`. Property fields added: `kitchens`, `receptions`, `area`, `outbuildings`, `outdoor`, and furnishing `heavy`.

## 4b. Request lifecycle

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

## 5. Pro roles, levels and training

A Pro holds one or more roles, decided by the services they deliver. Each role has three levels, unlocked by completed jobs and ratings in that role. Badges read “Pro Clerk · Level 3”.

| Role | Services | Level 1 | Level 2 | Level 3 | Extra documents |
|---|---|---|---|---|---|
| Pro Clerk | Inventory, Check-In, Mid-Term, Check-Out | Up to 2 bedrooms | Up to 4 bedrooms | Any size | Professional indemnity insurance |
| Pro Cleaner | Cleaning | Standard cleans | + End of Tenancy and Office | All cleans, incl. Deep | — |
| Pro Trades | Repairs & Maintenance | Repairs (rate only) | Higher rate | Top rate | Legally required trade certificates |

- **Every Pro:** photo ID, right to work, basic DBS and public liability insurance (`DOCS` in `pro.js`, `docNeeded(pro, doc)`).
- **What controls the levels:** `requiredLevel(job)` gives the level a job needs in its role (`jobRole(job)`); `eligible()` checks `proLevel(pro, role)`. `trainingGate(pro, role, level)` blocks a level until its required trainings are done. There is no override.
- **Rules to apply** (`settings().roleLevels`, Catalogue & policies): Level 2 at 10 jobs and 4.5 rating, Level 3 at 30 jobs and 4.7, counted within the role. Placeholders to confirm.
- **Standards check:** the first `standardsJobs` (default 5) completed jobs in each role get a closer LISTD review and a “New to LISTD” badge (`standardsCheck(pro, role)`). An Admin can pass it early for experienced Pros. Passing it is required before applying for Level 2.
- **Pay:** an hourly rate per role and level (`pricing().pro.rates`, set under Pricing). The Pro fee is the workload (`proBase`, which records the role and level it was priced at) × the Pro’s rate in that role.
- **How jobs reach Pros:** paid jobs are open to every eligible Pro in the area (`openJobsFor`, `cmdTakeOpenJob`), and LISTD can also send a job straight to a chosen Pro (`cmdOffer`).
- **Older data:** Pros and trainings saved with the old single Level 1–5 are read through `legacyRoleLevel()`, `tRole()` and `tLevel()` without migration.

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
| Two-factor (all roles) | Off by default. Turning it on in Settings › Sign-in & security shows a QR code (qrcode-generator 1.4.4) and setup key, and the user confirms it with a 6-digit TOTP code (RFC 6238). Turning it off needs the password. |
| Pro sign-up | Email and password only. The name is collected in onboarding. |
| Pro invitations | One-time 8-character code, stored only as a SHA-256 hash, valid for 7 days. The link is `#invite=CODE`. |

## 8. Production plan: what to replace

The domain logic carries over as it is: the state machine and guards in `actions.js`, levels, permissions, the quote and invoice maths, and the report format. The infrastructure needs replacing:

1. **API and database.** Move to Postgres with a server API. Enforce every `cmd*` guard on the server, inside transactions, so offer acceptance and payouts are atomic. Apply tenant and role policies there, using the permission map in section 6.
2. **Auth.** Use a managed identity provider with email verification and reset links sent by email. Use server-side sessions, and consider requiring MFA for staff (it is optional in the MVP, by product decision). Staff invitations, roles and Pro invitations then become server records.
3. **Payments.** Use a payments marketplace provider (for example Stripe Connect) for checkout, refunds and Pro payouts, driven by webhooks. Keep the idempotency keys the MVP already uses (`op`).
4. **Files.** Use private object storage with signed URLs and malware scanning. Keep verification documents in a separate, restricted bucket.
5. **Background worker.** Run offer and quote expiry, the 48-hour auto-complete and reminders on a schedule. In the MVP these run when someone opens the app (`sweep`).
6. **Email and SMS.** Send Pro and staff invitations, notifications and receipts.
7. **AI photo descriptions.** Use a server-side vision model with logging, retention rules and human review. The Pro must still check each description, as now.
8. **Frontend.** Port the views to the team's framework of choice. `design-system/` and `platform/styles/` hold the tokens and components to reuse.
