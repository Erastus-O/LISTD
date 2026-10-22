listd is the property services platform for UK letting agents, landlords and verified Pros: book, track and deliver inventories, inspections and cleaning with evidence on every job. This system turns the listd brand guidelines into tokens and React components for the web. Build every listd screen from it; when something is missing, compose it from these tokens rather than adding raw values.

## How the system is layered

1. **Primitives** are the raw palette: `teal-50`…`teal-950`, `neutral-0`…`neutral-950`, and `mint`, `amber`, `sky`, `coral`, `violet`, `pink` at 100/300/500/700/900. Never use a primitive directly in a component.
2. **Semantic tokens** give each primitive a job and switch per theme: `bg`, `surface`, `text`, `brand`, `danger`, `service-checkout` and so on. Components use only these.
3. **Components** (the bundle, namespace `Listd`) are built on semantic tokens, so a theme change or a token edit flows through everything.

Two themes ship: `light` (default) and `dark`. Set `data-theme` on `<html>`; every semantic token has a value in both and every text pairing below passes WCAG AA in both.

## Content fundamentals

Write like a calm, precise inspector: plain British English, short sentences, active voice.

- Sentence case for headings, buttons and tabs: "Book a service", "Awaiting sign-off".
- The product name in text is **LISTD**. The logo is always lowercase **listd**. Pros are always "Pro" and "Pros", capitalised; never "clerks", "workers" or "gig".
- Hyphenate services: check-in, check-out, mid-term inspection.
- Dates and times: `24 Oct 2026, 10:42`, 24-hour clock. Ranges take an en dash with no spaces: `36–72 hours`, `£55–£100`.
- Prices: "from £55", "£70.00" in tables. Never "cheap".
- Never put a space before a colon.
- Buttons are verbs that say what happens ("Release payment"); the confirmation repeats it in the past tense ("Payment released").
- Errors say what went wrong and how to fix it: "Enter a UK postcode, like BS8 1TH". No "Oops", no apologies.
- Disputes stay neutral: "A dispute has been raised on item 14 (Lounge carpet). Both parties can add evidence until 28 Oct." Never take sides in copy.
- No emoji in the product.

Words we use: Pro, verified, evidence, sign off, on record, escrow, structured, tribunal-ready, track. Words we avoid: gig, hustle, cheap, workers, revolutionary, hassle-free.

## Colour

- Page ground is `bg`; content sits on `surface`; menus, popovers and modals on `surface-raised`; wells and table heads on `surface-sunken`. Dark bands and tooltips use `surface-inverse` with `text-inverse`.
- Text is `text` (primary) and `text-muted` (secondary), both on any surface. `text-subtle` is for placeholders and disabled labels only.
- `brand` (LISTD Teal, `teal-600`) is the primary action and selected state. Put `on-brand` on it. Teal text and links use `brand-text` / `link`.
- `accent` (Evidence Mint) highlights verified things and marketing CTAs on dark heroes. It is never text on a light ground; put `on-accent` (Ink) on it.
- `live` (Timestamp Amber) marks anything happening now: the in-progress step, live dots, escrow held. Fill only, Ink text.
- Feedback uses `info`, `success`, `warning`, `danger` for text and icons, `*-subtle` for backgrounds and `*-fill` for solid dots and bars. Always pair a status colour with a word or icon.
- `focus-ring` is the keyboard focus outline everywhere: 2px solid plus 2px offset.
- Borders: `border` for hairlines and card outlines, `border-strong` for form controls (3:1 on every surface).

### Service colours

Each service owns one colour, used for its icon tile, tag, job-card top bar and report header, and nothing else:

| Service | Fill | Tint | Text |
| --- | --- | --- | --- |
| Inventory & Condition | `service-inventory` (Mint) | `service-inventory-subtle` | `service-inventory-text` |
| Check-In | `service-checkin` (Sky) | `service-checkin-subtle` | `service-checkin-text` |
| Check-Out | `service-checkout` (Coral) | `service-checkout-subtle` | `service-checkout-text` |
| Mid-Term Inspection | `service-midterm` (Violet) | `service-midterm-subtle` | `service-midterm-text` |
| Cleaning | `service-cleaning` (Pink) | `service-cleaning-subtle` | `service-cleaning-text` |

Service fills always carry Ink (`on-accent`) text. Never use a service colour for an action or a status.

### Job status

Six statuses, each a dot colour plus its word (StatusPill): Booked `status-booked`, Accepted `status-accepted`, In progress `status-progress`, Awaiting sign-off `status-awaiting`, Signed off `status-signed`, Disputed `status-disputed`.

Balance a layout roughly 50% `bg`/`surface`, 20% Ink, 15% Teal, 8% Mint and 7% service and signal colours.

## Typography

Three families, three jobs. All are bundled as font files.

- **Rammetto One** (`--font-display`): the wordmark, display headlines and price headlines. One heavy weight. Use `display-2xl` to `display-sm` (72–28px) only; never below 28px, never for buttons, body or table numbers.
- **Inter Tight** (`--font-sans`): everything that works. Headings `heading-lg`/`heading-md`/`heading-sm` (700), body `body-lg`/`body`/`body-strong`/`body-sm`, `caption`, button labels `button-*`, and numbers `data`/`data-lg` with `font-variant-numeric: tabular-nums`.
- **Raleway** (`--font-label`): uppercase `label` and `label-sm` with wide tracking for eyebrows, report strips and table headers; italic `quote` for pull quotes. Raleway's figures are old-style: never use it for prices, times or counts.

Page titles in the app use `display-md`; section headings `heading-lg`. Keep running text to `measure` (65ch). Give headings `text-wrap: balance`.

## Space, size and layout

- 4px grid: `space-1` (4) to `space-24` (96). Lay out siblings with `gap`, not margins. Card padding `space-6`; compact cards `space-5`; field label-to-input `space-1.5`.
- Controls: `control-sm` 32px, `control-md` 40px (default), `control-lg` 48px. Touch targets at least `touch-min` (44px).
- Content max width `container` (1120px). Side gutter `space-4` on phones, `space-6` from `bp-md`.
- Breakpoints: `bp-sm` 480, `bp-md` 768, `bp-lg` 1024, `bp-xl` 1280. Grids go 1 → 2 → 3 → 4 columns across them.

## Shape, borders and elevation

- Radii: `radius-md` (12) for buttons and inputs, `radius-lg` (14) for cards and alerts, `radius-xl` (22) for modals and panels, `radius-sm` (8) for tags and chips, `radius-pill` for status pills, badges and switches. Avatars are rounded squares, echoing the app icon.
- Separate with borders first (`stroke-hairline`, `border`). Use shadows only for things that float: `shadow-sm` on hovered cards, `shadow-md` on menus and toasts, `shadow-lg` on modals.
- Layering: `z-sticky` < `z-dropdown` < `z-overlay` < `z-modal` < `z-toast` < `z-tooltip`.

## Motion and states

- Durations: 120ms for hovers and tooltips, 150ms for toggles and colour changes, 200ms for modals and toasts entering. Ease-out. Nothing bounces.
- Respect `prefers-reduced-motion`: spinners and skeleton shimmer stop, transitions are removed.
- Hover darkens a brand fill one step (`brand-hover`); press goes one more (`brand-pressed`). Ghost and secondary controls gain `surface-sunken` or `brand-subtle` on hover.
- Disabled is `opacity-disabled` (0.45) with a not-allowed cursor. Loading keeps the label and adds a spinner.
- Errors: `danger` border on the control, an error icon and message below it in `danger`, `aria-invalid` set.

## Imagery and evidence

Every property photo is evidence. Show it in EvidencePhoto: Mint corner brackets, a dark timestamp chip with an Amber live dot ("IMG 014 · Lounge · 24 Oct 2026, 10:42"), and damage marked with a dashed `danger-fill` ring. Photography is real UK rental homes in daylight with straight verticals; no staged show homes, stock handshakes or heavy filters.

## Logo

The logo is the word **listd** in Rammetto One, lowercase, tracking −5.5%, and nothing else. Use the Logo component or the files in **Logos**.

- Primary: Teal (`brand`) on light grounds. White on `brand` or `surface-inverse`. Ink for one-colour print.
- Clear space equals the x-height on every side. Minimum 72px wide on screen.
- App icon: the white wordmark on a Teal tile (`radius-2xl`). Favicon: "ld" on a Teal tile, for tabs and spaces under 44px.
- Never uppercase it, retype it in another font, open the spacing, recolour letters separately, stretch it or set it on busy photos.

## Iconography

Use the Icon component (or the SVGs in **Icons**): a custom 24px set, 2px stroke, round caps and joins, outline only, drawn in `currentColor`. Sizes `icon-sm` 16, `icon-md` 20 (default), `icon-lg` 24, `icon-xl` 32.

- Service icons are fixed: `inventory`, `check-in`, `check-out`, `inspection` (mid-term), `cleaning`. Domain icons: `escrow`, `verified-pro`, `camera` (evidence), `signature` (sign-off), `location` (tracking), `meter`, `key`, `pound`.
- Icons sit in `text` or `text-muted`; on a service tile, Ink on the service fill.
- An icon that is the only content of a control needs a label (IconButton). No emoji, no filled or duotone icons.

## Accessibility

- Every text token pairing named above passes 4.5:1 in light and dark; `border-strong`, `focus-ring` and `brand` pass 3:1 as non-text marks.
- Status, condition and service never rely on colour alone: each carries a word, and statuses also an icon in alerts and toasts.
- All controls show `focus-ring` on keyboard focus. Fields have visible labels; errors are linked with `aria-describedby`.
- Minimum body size 16px on the web (`body`); 14px (`body-sm`) only for secondary text.

## Components

- **Brand:** Logo, Icon.
- **Actions:** Button, IconButton, Link.
- **Forms:** TextField, Textarea, Select, Checkbox, RadioGroup, Switch.
- **Status:** Badge, StatusPill, ServiceTag, TierBadge.
- **People:** Avatar, ProLevel.
- **Layout and data:** Card, Stat, Table.
- **Domain:** JobCard, ProgressRail, ConditionRating, EvidencePhoto, ServiceTile.
- **Navigation:** Navbar, Tabs, Breadcrumbs, Pagination.
- **Feedback:** Alert, Toast, Modal, Tooltip, ProgressBar, Spinner, Skeleton, EmptyState.

Load `tokens.css`, then `components/bundle.css`, React 18, then `components/bundle.js`; components are on `window.Listd`.
