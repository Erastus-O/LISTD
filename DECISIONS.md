# LISTD MVP — implementation decisions (live app, v2)
22 Oct 2026. Built against LISTD_PRD.md, LISTD_FRD.md, LISTD_Product_Specs_Claude.md. Built as the live claude.ai app, not the production codebase.

## Followed as specified
- Taxonomy: CHECK_IN, CHECK_OUT, MAINTENANCE → REPAIRS_DAMAGES | CLEANING. One kind per request; linked requests for multi-service needs.
- Request lifecycle: SUBMITTED → NEEDS_INFORMATION → QUOTED → AWAITING_PAYMENT → READY_FOR_ASSIGNMENT → SCHEDULED → IN_PROGRESS → ADMIN_REVIEW ⇄ CORRECTION_REQUIRED → CLIENT_REVIEW → COMPLETED, plus ON_HOLD (with resume status) and CANCELLED. Payment, dispute and settlement states are kept separately.
- Versioned Admin quotes (line items in pence, tax, discount, Pro fee hidden from the client, duration, exclusions, 7-day expiry). A new version supersedes the unpaid one. Expired quotes can't be paid.
- One open offer per job, with a 12h expiry (or the slot start). Eligibility is checked on offer and again on accept: approved status, skill, coverage, availability day, document expiry, double-booking.
- Clock-in/out require photos, or an exception that Admin reviews. Break minutes are bounded by time on site.
- Report versions: submit → Admin return/release → client accept, correct or dispute. 48h review timer, paused by a correction or dispute. Auto-completion is recorded as AUTO and never treated as consent.
- Check-out links the latest released check-in as its baseline, or states that comparison is unavailable. Findings are labelled new / existing / uncertain.
- Change orders: Pro proposes → Admin prices with a Pro fee → client approves and pays before the work.
- Disputes freeze payout. Outcomes: none, partial refund, full refund, rework or cancel, each with a recorded reason. Refunds can't exceed the captured amount. A complaint after payout is recorded as a complaint and does not reverse the payout.
- Payout is eligible only when the job is completed, has no open dispute and the Pro has a payout account. It is idempotent per job.
- Messages per job; in-app notifications; audit log of privileged actions with reasons; downloadable report and receipt files built from stored records.
- Client onboarding: segment-specific fields, billing, first property with access contact; saves and resumes. Pro onboarding: details, skills and coverage, availability, documents, payouts, submit → Admin approve / request changes / reject.

## Inspection reports: LISTD Inventory format (user instruction: "use exactly what is in the pdf")
- Check-in and check-out reports copy the reference "123 Sample Street – PREVIEW REPORT" (LISTD Inventory "Inventory & Schedule of Condition").
- **Pages, in order:**
  - green cover with the company box, date, title, address, cover photo, "Prepared By" and "On Behalf of"
  - Contents with page numbers
  - Executive Summary
  - Interpretations and LISTD Inventory's Disclaimer (both word for word)
  - 1. Schedule of Condition (13 rows, standard phrases)
  - 2. Meter Readings (Ref / Name / Serial No. / Reading / Location / Supplier; "Not accessible – please contact the agent.")
  - 3. Alarms (Ref / Name / Location Room & Floor / Test Result)
  - 4+. one section per room (Ref / Name / Description / Condition), with "No items associated with this room." for Garden
  - Keys (Tenant Keys, Keys in Property)
  - Investigate Responsibilities (Ref / Action Required / Comments)
  - Declaration (word for word)
- **Every page:** the property address header, "Page X of N" and "Tenant Initials: ____" footers, and "(CONT.)" section bars when a section runs onto a new page.
- **Photos:** grids with a black timestamp overlay and an italic "Ref #x.y" caption.
- **Room item lists** are the same as the reference:
  - Entrance Hallway: Front Door, Ceiling, Walls, Skirting, Flooring, Lighting, Switches / Sockets, Additional Items
  - Bedrooms: Door, Ceiling, Walls, Flooring, Lighting, Window and Sill, Curtains/Blinds, Switches / Sockets, Heating, Additional Items
  - Bathroom: Door, Ceiling, Walls, Flooring, Lighting, Window and Sill, Heating, Toilet, Sink, Shower Cubicle, Bath Unit, Medicine Cabinet, Additional Items
  - Living Room: as Bedrooms
  - Kitchen: Door, Ceiling, Walls, Flooring, Lighting, Switches / Sockets, Kitchen Units, Worktop, Extractor Hood, Cooker, Hob, Oven, Sink, Fridge/Freezer, Washing Machine, Additional Items
  - Pros can add or remove items and rooms.
- **Condition and action tags:** Condition is free text and is left blank when the item is in good condition, as the Interpretations say. Items needing action carry the orange "Needs Maintenance - Investigate" or "Needs Cleaning - Investigate" tag.
- **PDF output:** the report downloads as a real PDF, built in the browser with jsPDF 2.5.1 from cdnjs.
- **Cover company details:** editable in Admin › Catalogue & policies. Defaults: LISTD Inventory, Suite 41, 14-15 Triangle South, Clifton, Bristol, 07413065681, hello@listdinventory.co.uk.
- **Not reproduced:** the client logo shown under "On Behalf of" on the reference cover, because clients don't upload logos yet.

## AI photo descriptions (added 22 Oct 2026)
- When a Pro photographs an item, AI (Claude, via the app's sample capability) drafts the Description and Condition in the LISTD Inventory house style, using examples from the reference report. It also suggests a Needs Maintenance / Needs Cleaning flag, gives a confidence level and says what to verify.
- AI also:
  - reads meter photos (reading with unit, serial, location)
  - describes keys
  - suggests missing items from room photos
  - drafts the executive summary
- Vetting: every AI draft is marked as awaiting the Pro's check, and the report can't be submitted until the Pro confirms each one (they can edit first). Items in the report are labelled "AI-assisted, clerk-checked", and the PDF declaration page notes that AI was used.
- If AI isn't available, the Pro writes the descriptions manually. Each viewer is asked once to allow photos to be sent to Claude, and AI use counts toward their own Claude usage.

## Pro levels, training and applications (added 22 Oct 2026; superseded on 29 Oct 2026 by Pro roles, see “Platform amendments” below)
- **Five levels.** Levels 1–3 are cleaning: L1 Light cleans, L2 Light and General cleans, L3 all cleans. Levels 4–5 add inspections and a higher pay share: L4 check-in/out up to 3 bedrooms, L5 any size. Offers check the level, both when they are sent and when they are accepted.
- **Moving up.** A Pro applies for the next level when they meet its rules: they hold the previous level, have enough completed jobs, have a high enough average rating and are approved. An Admin then approves or declines with a reason. Admins can also set a level directly, with a reason; this is audited.
- **Training gate.** Levels 4 and 5 need every published training marked for that level or below. Neither an Admin approval nor a direct level change can get round this. Archiving a training later doesn't remove a level already held.
- **Default rules** (placeholders to confirm, editable in Catalogue & policies):

  | Level | Completed jobs | Rating | Pay share |
  |---|---|---|---|
  | 1 | 0 | none | 60% |
  | 2 | 5 | 4.0 | 65% |
  | 3 | 15 | 4.3 | 70% |
  | 4 | 25 | 4.5 | 75% |
  | 5 | 40 | 4.7 | 80% |

- **Pay.** The pay share prefills the Pro fee when an offer is sent. The accepted offer fee is now what the Pro is paid. Previously the quote's Pro fee estimate was paid, which ignored edits made on the offer.
- **Repairs & Damages** stays a separately approved trade skill outside the levels.
- **Joining applications.** These are recorded when a Pro submits onboarding. The Admin chooses a starting level on approval: Levels 1–3 freely, Levels 4–5 only once the trainings are done. Pros who submitted before this change appear as join applications automatically.
- **Training library.** Admins upload MP4/WebM/MOV videos or PDFs (up to 20 MB in the published app, or 2.5 MB in local demo mode), or add an https link for long videos. Each training is required for a level or optional, and can be a draft, published or archived. Pros mark a training complete after confirming they watched or read it in full. There is no quiz yet.
- **Admin Pros section.** A filterable table of all Pros and an Applications tab with a count. Each Pro has a detail page showing:
  - personal details and work preferences
  - level and pay, with a requirements checklist and level history
  - applications with their decisions
  - trainings completed
  - documents with expiry status
  - jobs and account suspension

## Pro invitations (added 22 Oct 2026, user instruction)
- **Adding a Pro.** In Admin › Pros, "Add Pro" takes a first name and an email. This creates a Pro with status INVITED, a one-time code (only its SHA-256 hash is stored) and a link (`#invite=CODE`) valid for 7 days.
- **Accepting.** The Pro proves they own the email by entering the code with that address and creating a password. Their status then becomes DRAFT, their email is marked verified, and they continue the normal onboarding.
- **Sending.** Email delivery isn't connected, so the Admin sends the invitation from their own email app (prefilled draft) or copies it. "Accept an invitation" on the Pro sign-in screen works even when a link can't carry the code through.
- **Resend and cancel.** Resending replaces the code. Cancelling marks the invitation cancelled.
- **Pro sign-up** asks only for email and password. Name is collected in onboarding, and Pro terms are accepted at submission.
- **Admin Pros table** has an Email column, with Status as the last column.

## Staff roles (added 22 Oct 2026, user instruction)
- **Roles.** The first person to set up admin sign-in becomes the Main admin, the sole owner of the account. The Main admin adds staff (name, work email, role) in Settings › Users & roles, choosing Sub-admin or Operations. Staff get their role when they set up admin sign-in with the invited email, which also needs edit access to the workspace. Anyone else who sets up admin sign-in waits until the Main admin gives them a role.
- **Access by role.**

  | Area | Main admin | Sub-admin | Operations |
  |---|---|---|---|
  | Overview, requests (quotes and invoices), assignments, report reviews, invoicing, clients and properties | Yes | Yes | Yes |
  | Disputes, finance (refunds and payouts), Pros (invitations, approvals, levels), training, audit log | Yes | Yes | No |
  | Catalogue and policies, users and roles | Yes | No | No |

- **Ownership.** There is always exactly one Main admin. They can hand the role to another active staff member, and become a Sub-admin themselves. The Main admin can't be removed.
- **Enforcement.** Sections are hidden and the matching actions are refused in the app. Server-side permission checks are a production blocker.

## Two-factor authentication (updated 23 Oct 2026, user instruction)
- Two-factor is off by default for every role, Admin included. Users switch it on in Settings › Sign-in & security. Switching it on shows the QR code and setup key, and it only takes effect once they enter a 6-digit code from their authenticator app.
- Admin set-up no longer forces an authenticator.
- Accounts that already have two-factor keep it until the user switches it off, which needs their password.

## Six services and multi-service booking (added 23 Oct 2026, user instruction)
- **The six services**, in this order:
  - Inventory: inspection and full schedule of condition
  - Check-In: tenant walk-through and sign-off
  - Mid-Term: condition inspection during the tenancy
  - Check-Out: end-of-tenancy property condition and sign-off
  - Repairs & Damages: priced from the damage and invoiced
  - Cleaning: Light, General or Deep
- **Booking several at once.** Clients can select any number of services in one request. LISTD creates one linked request per service, booked together, each with its own quote (an invoice for repairs), payment, Pro and report. Shared details (rooms, keys, tenant name, access, timing) are entered once.
- **Inspection reports.** All four inspections use the LISTD Inventory report format. Mid-Term and Check-Out compare with the latest released check-in or inventory. Check-In starts from the latest inventory. Check-In and Check-Out reports need the tenant walk-through sign-off: signed, signed with comments, declined, or tenant not present. The sign-off appears in the report and the PDF. PDF titles follow the service.
- **Pros and pricing.** Pros choose the new skills (Inventory, Mid-term). Every inspection needs Level 4, or Level 5 for 4+ bedrooms. The price guide adds Inventory (£90 base, £15 per extra bedroom) and Mid-Term (£50 base, £8 per extra bedroom). These are placeholders to confirm.
- **Website.** It lists all six services in the menu, hero tabs, service cards, mobile menu and footer.
- **Colour.** Repairs & Damages has its own amber colour token (`--service-repairs`).

## Departures (and why)
- **Cleaning catalogue:** the website's Light / General / Deep Clean is used instead of the four recovered services and five add-ons (user decision, 22 Oct 2026).
- **Auth:** identity is the viewer's Claude account. Each person creates client/Pro profiles tied to their account id; "sign out" leaves the profile on that device. Admin = editors of the workspace. No email/password, password reset or MFA. These need the production backend.
- **Payments:** simulated checkout, refunds and transfers with test references. A "simulate failed payment" control exercises the failure path. No provider webhooks. Never presented as live money.
- **Authorisation:** role scoping happens in the page. Anyone with use access can technically read the shared records, verification documents included. Server-side tenant enforcement, private storage and short-lived download grants need the production backend.
- **Timed rules:** offer expiry, quote expiry and review auto-completion run when an involved party or an admin opens the app, not in a background worker.
- **Concurrency:** writes are serialised per document in one browser. There are no cross-user transactions, so simultaneous accepts are not strictly atomic.
- **Pricing:** the price guide in Admin only prefills quotes. Starting points: Check-In/Out £55 base (from the website). Other rates are placeholders. The default Pro fee prefill is 75%; this is a placeholder, not a commission policy.
- **Receipts:** downloaded as HTML (print to PDF from the browser). Inspection reports are real PDFs.

## Production blockers
Real auth with MFA and Admin invitations; a server API with tenant policies; a Postgres schema; a payment provider marketplace account with webhooks; private object storage with malware scanning; a background worker; transactional email; a server-side vision model with logging and retention rules for AI photo analysis; legal terms, retention policy and final pricing.

## Pricing: pilot framework (25 October 2026)

Implemented from *LISTD Pricing Strategy, 24 October 2026*. All figures are pilot prices to test, editable by the Main admin under Admin › Pricing.

- **One service standard.** Flex, Core and Priority no longer imply different workmanship. Flex, Standard and Priority are now scheduling options: Flex is −£10 (three or more dates, five or more working days ahead, LISTD picks), Standard is the base price (two or more working days ahead), Priority is +£30 (within two working days, £20 to the Pro, £10 to LISTD). Priority and Flex can each be switched off when capacity or savings aren't there.
- **Inspection rate card** by size (studio to 4 bedrooms; 5+ is a custom quote): Inventory & Condition, standalone check-in handover, Inventory + check-in in the same visit, and check-out, exactly as in the strategy. The two same-visit jobs stay separate requests, with the saving shown as a line on the inventory.
- **Mid-term prices are an assumption** (£60, £65, £75, £85, £95): the strategy has no mid-term column. Confirm or change them under Pricing.
- **One complexity adjustment:** part-furnished +£10, furnished +£20 (studio–2 bed) or +£30 (3–4 bed), heavily furnished is a custom quote. No per-bedroom fee. Extra bathrooms, kitchens and reception rooms are £10 each and outbuildings or extensive outdoor areas £15 each (assumed values for the strategy's "clearly explained adjustments"). Properties far larger than their bedroom count go to LISTD for review.
- **Instant fixed quotes** for inspections and repair diagnosis visits. Cleaning shows an estimate (±15%) from expected cleaner-hours, then LISTD issues a fixed quote. Repairs are a fixed task price, or a £50 diagnostic visit credited once against the repair change order.
- **Cleaning types** are now Standard Home, Deep, End of Tenancy and Office, with stated inclusions and add-ons. Level gating: Level 1 Standard; Level 2 adds End of Tenancy and Office; Level 3 adds Deep. Older Light and General requests still open as Standard.
- **Pro fees from workload,** not a percentage: attendance allowance + expected minutes × the Pro's level hourly rate + approved complexity and Priority allowances. Hourly rates (£14–£22) and minutes are assumptions tuned so a 2-bed inventory pays £55, matching the strategy's illustration. The offer recalculates the fee for the chosen Pro.
- **Contribution floor:** £25 or 25% of revenue excluding tax, whichever is higher, after the Pro fee, payment costs (1.5% + 20p), £5 support and reporting per job, and a 3% rework allowance. Shown on every quote in Admin; the pilot table flags jobs below the floor.
- **Portfolio pricing:** pay per completed job, no subscription. 10–24 completed jobs a month earns up to 5% rebate on eligible service fees (not materials, travel or Priority), capped so no job falls below the floor; Admin records the rebate. 25+ is a negotiated rate set per client.
- **VAT** defaults to 0% until the tax treatment is confirmed; set it under Pricing.
- **Pilot measures** on Admin › Pricing: quote acceptance and decline reasons, Pro offer acceptance, actual vs expected job time, contribution by service group, corrections, complaints, repeat clients, Priority fulfilment and Flex discounts.
- **Website:** the Pricing page shows the scheduling options, the rate card, the furnishing adjustment with the worked example (£165, or £195 with Priority), maintenance pricing and portfolio pricing, labelled as pilot prices for Bristol. This overrides the brand guideline's "no prices in brand material" rule for the Pricing page.

### Price changes need the Main admin and a phone code (25 October 2026)

- Only the Main admin can change the rate card, scheduling, Pro fee model, floor, rebate tiers, VAT and negotiated client rates. Sub-admins see Pricing read-only; Operations can't open it.
- The Main admin first confirms a mobile number with a 6-digit code. Changing that number needs a code to the current number first, then to the new one.
- Every save sends a fresh 6-digit code to that phone. Codes expire after 10 minutes, allow 5 attempts and can be resent after 30 seconds. Each code is tied to the change it approves. Sends, failures and verified changes are audited (the number is masked).
- **Test mode:** no SMS provider is connected, so the text is shown in the code dialog, clearly labelled. **Production blocker:** generate, send (via an SMS provider such as Twilio or Vonage) and check the code on the server, and enforce the Main-admin rule in the API. The browser-side check here is a demo only.
- Per-job quotes in the quote builder are unchanged; Sub-admins and Operations still issue those.

### Flex removed (25 October 2026)

Flex scheduling (−£10 for flexible dates) is no longer offered. Clients choose Standard (base price, two or more working days ahead) or Priority (+£30 within two working days). The Admin Pricing page no longer shows Flex settings, and older Flex bookings keep their original quotes.

## Admin Analytics (25 October 2026)

Admin › Analytics (Main admin and Sub-admins) explains LISTD's contribution and ranks what moves it.

- **Contribution** = net revenue (excl. tax, after refunds) − Pro fees − payment, support and rework costs (Pricing assumptions) − rebates. It must still cover overheads.
- **Driver tree:** Contribution = Paid jobs × Contribution per paid job − Rebates. Paid jobs = Requests × Requests quoted × Quote acceptance × Payment conversion. Contribution per paid job = Avg revenue × (1 − Refund rate) × (1 − Pro fee share) − Direct cost per job. The tree reproduces the bridge exactly (tested).
- **Ranking (shown as #1–#9 on the driver tree; the separate "Biggest levers" list was removed on 25 Oct):** each driver is improved 10% in the helpful direction with the others held still; the contribution gained orders the list. The four volume drivers multiply, so they tie; the page says so.
- **Leading indicators** under each lever show what moves it: time to price, decline reasons and expiries, time to pay, Priority share and room adjustments, disputes and cancellations, Pro level mix and time versus expected, corrections, rebates.
- Also: a contribution bridge, booking funnel, contribution by service and by month, with a 30-day, 90-day, 12-month or all-time filter. Single-series charts use sky blue (#1F6FB2 light, #3A86CC dark), validated for contrast and colour-vision safety.
- **Charts added (25 Oct):** pie (donut) charts for revenue by service, revenue by client type and where each £ of revenue goes; bar charts for revenue and contribution by month and requests by service (each with a table view); a location map of requests by postcode district with Pro-coverage gaps flagged, a Bristol & Bath zoom, and top areas by contribution. The map is drawn in the app from approximate postcode-district centres (no map tiles or third-party map service); swap in a mapping provider in production for street-level detail. Categorical colours use the validated chart palette (blue, orange, aqua, yellow, magenta, violet) with values and shares always labelled.
- **Operations analytics (25 Oct):** Disputes (raised, settled, open, median time to settle, raised vs settled pie, outcomes and reasons, disputes per 100 completed jobs), Invoices for repairs and extra work (tiles for issued, paid, unpaid and median time to pay, plus one bar chart of paid vs unpaid invoice value by month issued, labelled with the % paid each month), Paid vs completed jobs (pie and monthly bars), and Pro performance (offer acceptance, completion rate, on-time arrival within 15 minutes, time vs expected, rating, corrections, disputes, jobs per week; shown as summary tiles and a productivity-rate chart. The per-Pro completed-jobs chart and table were removed on 25 Oct).

### Key decisions need the Main admin's phone code (25 October 2026)

- The Main admin adds and confirms a mobile number under **My settings › Account** (a code is sent to it first). Changing it needs a code to the current number, then the new one.
- These key decisions are Main-admin only and each needs a fresh 6-digit code sent to that number: price changes and negotiated client rates (Pricing), catalogue & policies (levels, report header, policies), and staff changes (adding staff, changing a role, removing access, handing over the Main admin role).
- Until a number is confirmed those actions are blocked, with a prompt to add one. Codes expire after 10 minutes, allow 5 attempts, can be resent after 30 seconds, approve only the change they were sent for, and are audited.
- After a handover the new Main admin confirms their own number before making key decisions.
- Test mode shows the text in the code dialog. Production blocker: send and verify codes on the server through an SMS provider.

### Priority is set by the date (25 October 2026)

Clients no longer choose Standard or Priority. Any date within two working days (the Priority setting on Admin › Pricing) is a Priority booking at +£30, shown as soon as the date is picked; later dates are Standard. When Priority is switched off, the earliest date offered is the first Standard day.

## Pricing end to end (25 Oct 2026)
- One rate card everywhere: website pricing page, client quotes, Admin › Pricing and Pro fees all read the same figures (Inventory £85–£160, standalone check-in £60–£75, Inventory + Check-in same visit £110–£185, mid-term £60–£95, check-out £75–£150; 5+ bedrooms custom).
- Furnishing is charged once: unfurnished £0, part +£10, furnished +£20 (studio–2 bed) / +£30 (3–4 bed), heavy = custom quote. Extra bathroom/kitchen/reception £10 each; outbuildings and outdoor areas £15 each.
- Priority (+£30, £20 of it to the Pro) is applied automatically for dates within 2 working days.
- Same-visit Inventory + Check-in is shown as two positive lines (inventory part = combo − standalone check-in, plus the check-in), never a discount line. Furnishing, extras and Priority sit on the inventory.
- Services booked together get one checkout ("Accept & pay £X") on the client's job page; each service still keeps its own quote, payment record and report.
- Pro fees are rounded to the nearest 50p, and Pros and admins see an itemised "How your fee is worked out" (attendance, expected time × level rate, allowances).
- Pros never see client prices or payment amounts in job history.

## Quote sent state and Update quote (25 Oct 2026)
- Once a quote is issued, Admin sees "Quote vN sent to client" (sent time, client total, expiry, and whether it is waiting for the client, accepted awaiting payment, or expired) instead of an open editor. The status pill reads "Quote sent" (or "Invoice sent") for admins; clients still see "Quote ready".
- "Update quote" opens the editor as vN+1 and needs a reason, which is shown to the client. Sending it supersedes the previous version (even an accepted one) and the client accepts the new version. Cancel discards the edits.
- After payment there is no Update quote; extra work goes through a change order.

## Platform amendments (Overview & decisions, 28 Oct 2026; built 29 Oct 2026)
Source: “LISTD platform amendments · Overview & decisions” (the overview tab only; the per-page wording tabs, the Developer list and the four open questions were not supplied).

| Topic | Decision | Where it's built |
|---|---|---|
| Payment wording | Never “escrow”. Payment is secured when the client books and released to the Pro when the client approves the finished job. | Website copy, client wizard, sign-in panel |
| Who approves | Clients approve the finished job; “approve the report” only on inspection-only lines. | Website, job page, notifications (“ready to approve”) |
| How jobs reach Pros | Mixed: Pros accept open jobs in their area, and LISTD can send a job straight to a chosen Pro. | Pro › Jobs (“Open jobs near you” and “Sent to you by LISTD”); Admin “Send straight to a Pro” |
| Job stages (client-facing) | Booked → Accepted → In progress → LISTD review → Ready to approve → Approved; “Finding a Pro” under Booked. A Quote step comes before Booked. | `STATUS`, `statusPill`, job progress rail |
| Services | Repairs & Maintenance (was Repairs & Damages). “More services coming soon” in the Services menu, service cards and footer. | `SVC`, `KINDS`, website, booking wizard |
| Priority | Within two working days, when a Pro is available, +£30. Changes when the job happens, never how well it’s done. | Website, `SCHED.priority` |
| Report detail | Every report rates every item; close-ups and scale references on any damage, whatever the scheduling option. | Inspection editor (rating required per item), website |
| Condition scale | New, Excellent/Very good, Good, Fair, Poor, Very poor, plus Not applicable. | `COND`; report view, PDF and AI drafts |
| Pro roles | Pro Clerk (inspections), Pro Cleaner (cleaning), Pro Trades (repairs). More than one allowed. | `ROLES`, onboarding, Pro and Admin screens |
| Pro levels | 3 levels in every role, unlocked by completed jobs and ratings. Badge “Pro Clerk · Level 3”. Hourly rate per role and level set by LISTD. | `levels.js`, `pricing().pro.rates` |
| Standards check | First 5 jobs in each role get closer review; badge “New to LISTD”; experienced Pros can move up faster once passed. | `standardsCheck`, Admin review banner, “Pass the standards check early” |
| Insurance and checks | All: photo ID, right to work, basic DBS, public liability. Clerks also professional indemnity. Trades also legally required trade certificates. | `DOCS`, `docNeeded` |
| Pricing | Bristol and Birmingham share prices; London later. Extra rooms each a visible line. | `pricing().area`, one quote line per extra room |
| Coverage | Bristol and the South West: every service. Birmingham: cleaning now, inspections and repairs coming soon. | `COVERAGE`, `coverageBlock` (booking refused with a clear message), website |
| Prices vs quotes | “Quote” before work, “Receipt” for money paid; clients never see “invoice” except the VAT invoice download. | Client nav: Quotes, Receipts; VAT invoice download on Receipts |
| Booking word | “Book” and “Bookings”, never “Request” (except “Report a repair”). | Client and Admin screens |
| Payouts | Paid weekly once the client approves the finished job (confirm before launch). | Pro Earnings, website |
| Contact | support@listd.co.uk; no phone until the LISTD number is confirmed; Instagram @listd_pro, TikTok listdpro, Facebook Listd.Pro. | Website contact and footer; report cover (phone removed) |
| TechSPARK | “Supported by” / “Part of the Tech Adoption for Growth programme”, never “Backed by”. | Website |

**Placeholders to confirm** (chosen so the product works end to end; all editable):
- Clerk level limits: Level 1 up to 2 bedrooms, Level 2 up to 4, Level 3 any size. Cleaner: Level 1 Standard; Level 2 adds End of Tenancy and Office; Level 3 adds Deep. Trades levels change the rate only.
- Level rules: Level 2 at 10 jobs and a 4.5 rating, Level 3 at 30 jobs and 4.7, counted within the role; the standards check must be passed before Level 2.
- Hourly rates (per hour, Level 1/2/3): Clerk £18/£20/£22, Cleaner £14/£15/£16, Trades £20/£23/£26.
- South West postcode areas: BS, BA, GL, SN, TA, EX, TQ, PL, TR, DT, BH, SP. Birmingham: B.
- Existing Pros keep their work: old Levels 1–3 become Pro Cleaner Levels 1–3; old Level 4 becomes Pro Clerk Level 2 and Level 5 becomes Pro Clerk Level 3.
