# LISTD — source code

This is the complete code for LISTD: the marketing website and the three products, the Client app, the Pro app and the Admin panel. LISTD books check-in and check-out inspections, repairs and cleaning for UK rental property, carried out by vetted Pros, with timestamped photo reports.

- **Live MVP:** https://claude.ai/artifact/Ed8g6GLxSidccdj98sE5aW (Client, Pro and Admin share one link)
- **How it works:** `docs/ARCHITECTURE.md` covers modules, data model, lifecycle, levels, roles, auth and the production plan.
- **Product decisions:** `DECISIONS.md` sets out what follows the PRD/FRD, what departs from it, and the production blockers.

```
listd-code/
├── website/                     Marketing website (static)
│   ├── index.html               Page markup
│   ├── css/site.css             Tokens, design-system components and site styles
│   ├── js/site.js               Pages, menus, pricing, forms
│   ├── js/motion.js             Scroll reveals and micro-interactions (respects reduced motion)
│   ├── images/                  Photos and partner logos
│   ├── build.py                 Makes the single-file dist/listd-website.html
│   └── dist/listd-website.html  Single-file build
├── platform/                    Client, Pro and Admin products (one codebase)
│   ├── src/*.js                 Application code, concatenated in a fixed order (see build.py)
│   ├── styles/                  tokens.css, components.css (design system), app.css (app layout)
│   ├── assets/                  icons.svg.html (icon sprite), auth-bg.jpg (sign-in photo, also inlined in app.css)
│   ├── build.py                 Builds dist/
│   ├── dist/                    listd-platform.html (all three products), client.html, pro.html, admin.html
│   └── tests/                   End-to-end browser tests (Playwright)
├── design-system/               Tokens (JSON + CSS), component CSS, design-system notes
├── docs/ARCHITECTURE.md         Developer guide
├── DECISIONS.md                 Product and implementation decisions
├── Makefile                     build, serve, test
└── requirements-dev.txt         Test dependencies
```

## Quick start

You need Python 3.10 or later. Nothing else is needed to build and run.

```
make build        # rebuild platform/dist and website/dist
make serve        # http://localhost:8000/website/ and http://localhost:8000/platform/dist/listd-platform.html
```

You can also open the files directly. `website/index.html` and `platform/dist/*.html` work from disk.

Opened outside claude.ai, the products run in **local demo mode**:

- data is saved in that browser only
- the first person to set up Admin sign-in becomes the Main admin
- AI photo descriptions are off

Payments, refunds and payouts are simulated in every mode.

## Website

The website is plain HTML, CSS and JavaScript. Host the `website/` folder on any static host (Netlify, Vercel, S3, GitHub Pages) as it is. Fonts load from Google Fonts. `build.py` inlines everything into `dist/listd-website.html` for single-file hosting or previews.

Links that leave the site:

| Link | Goes to |
|---|---|
| Log in and Get started | `https://www.listd.co.uk/auth` |
| Booking calls | Microsoft Bookings |
| WhatsApp | `+44 7413 065681` |
| Legal pages | `/privacy`, `/terms`, `/cookies` |

## Products (platform/)

| Product | What it covers |
|---|---|
| Client | Onboarding for four client types. Properties. Requests for Check-In, Check-Out, Repairs & Damages and Cleaning (Light, General or Deep). Quotes, or invoices for repairs, and test payments. Report review, disputes, ratings, receipts. Settings with optional two-factor. |
| Pro | Sign-up with email and password, or joining by Admin invitation. Onboarding with documents and payouts. Offers, schedule, clock-in and out with photos. Inspection reports in the LISTD Inventory format with AI-drafted descriptions the Pro checks, plus the PDF. Cleaning and repair reports. Earnings. Training & level. |
| Admin | Overview and work queues. Requests table. Assignments calendar. Quote builder, invoicing for repairs and Create invoice. Report reviews. Disputes and finance. Pros table, Pro detail pages, invitations, applications and levels. Training library. Clients, properties, catalogue and policies, audit log. Settings › Users & roles (Main admin, Sub-admin, Operations). |

### Build

```
cd platform && python3 build.py
```

This writes four files to `dist/`. `listd-platform.html` holds all three products with a Client / Pro / Admin switcher; it is the published app. `client.html`, `pro.html` and `admin.html` are single-product builds: they set `window.LISTD_PORTAL` and hide the switcher.

The source files share one global scope and are concatenated in this order:

`core, auth, actions, client, job, pro, settings, inspect, pdf, admin, levels, staff, app`

### External scripts

All of these load from cdnjs at runtime, only when they're needed:

- jsPDF 2.5.1, for the inspection PDF
- qrcode-generator 1.4.4, for the authenticator QR code
- Google Fonts: Inter Tight, Raleway and Rammetto One

## Tests

```
pip install -r requirements-dev.txt && python3 -m playwright install chromium
make test
```

| Test | Covers |
|---|---|
| `check_portals.py` | Each single-product build opens on its own sign-in screen |
| `e2e_auth.py` | Sign-up, sign-in, lockout, reset, sign-out, Admin two-step, claiming older profiles |
| `e2e_settings.py` | Account, billing, email change, 2FA on and off, notifications, theme, data export, account closure |
| `e2e_cross_portal.py` | Pro sign-in with an existing client login, and "Set up sign-in" |
| `e2e_invite.py` | Admin invites a Pro: code, link, resend, cancel. Pro verifies, creates a password and onboards |
| `e2e_staff.py` | Users & roles: Main admin, invited Sub-admin and Operations, access limits, ownership transfer |
| `e2e_levels.py` | Trainings, join and level applications, training gate for Levels 4 and 5, job eligibility by level |
| `e2e_invoicing.py` | Admin creates repair invoices, for a new repair or an existing request |
| `e2e_full_lifecycle.py` | Check-in, check-out, repairs (invoice, change order, dispute) and cleaning (auto-complete), through to payout |
| `e2e_inspection_ai.py` | AI drafts, the Pro checks them, PDF download. Needs `JSPDF_PATH` pointing at a local `jspdf.umd.min.js` (`npm pack jspdf@2.5.1`) |

Screenshots and downloads go to `platform/tests/out/`. That folder is ignored by git.

## Moving to production

The domain logic carries over as it is: the lifecycle and its guards, Pro levels, permissions, the quote and invoice maths, and the report format. The infrastructure needs replacing:

- **API and database:** Postgres behind a server API, enforcing every guard and permission
- **Auth:** managed auth with email verification and MFA for staff
- **Payments:** a payments provider with webhooks for checkout, refunds and Pro payouts
- **Files:** private file storage
- **Background worker:** expiries and auto-complete on a schedule
- **Email and SMS:** invitations, notifications and receipts
- **AI photo descriptions:** a server-side vision model

`docs/ARCHITECTURE.md` section 8 has the details.
