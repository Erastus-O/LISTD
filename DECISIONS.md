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

## Pro levels, training and applications (added 22 Oct 2026, user instruction)
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
