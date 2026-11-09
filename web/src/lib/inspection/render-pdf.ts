import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDFDocument,
  PDFImage,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import { ROOM_TYPE_LABELS, type RoomType } from './build-rooms'
import type { ExecutiveSummary, ReportActionType } from '@/lib/ai/executive-summary'

/**
 * Server-side renderer for the clerk inspection report — styled as a
 * professional UK "Inventory & Schedule of Condition":
 *
 *   - Branded cover (logo, document type, property, parties, dates)
 *   - Interpretations (condition + cleanliness legend) and Disclaimer
 *   - Schedule of Condition summary table
 *   - Meter readings + Alarms tables
 *   - Per-room item tables with colour-coded condition badges, narrative
 *     descriptions, and captioned photo grids
 *   - Actions summary (items flagged for attention) + Clerk declaration
 *   - Running header/footer with "Page X of Y" on every content page
 *
 * Output is the first PDF in the supersede chain; signed-pdf.ts appends the
 * tenant signature page when the tenant signs off in the portal.
 */

export type InspectionItemInput = {
  itemName: string
  /** Free-text description of the item (replaces the old enum
   *  condition + cleanliness pair on new captures). */
  description: string | null
  /** Free-text condition narrative. For legacy reports rendered via
   *  render-official.ts this may be the enum label (e.g. "Good")
   *  rather than a sentence. */
  condition: string | null
  /** Explicit mobile follow-up flag. Legacy desktop reports omit it and
   * continue to use conservative condition-keyword inference. */
  actionType?: ReportActionType | null
  actionComment?: string | null
  /** URLs of photos the clerk attached to this item (subset of room.photoUrls). */
  photoUrls: string[]
  /** "Before" photos from the property's most recent prior inspection,
   *  matched by room+item. When present the item renders Before/After grids. */
  beforePhotoUrls?: string[]
}

/** Keywords in the free-text condition that should escalate an item
 *  onto the "follow-up actions" page. Match is case-insensitive and on
 *  word boundaries so a description that *mentions* the word
 *  ("damaged-looking?") still triggers, while embedded substrings
 *  ("undamaged") do not. */
const FOLLOW_UP_KEYWORDS = [
  'damaged',
  'broken',
  'missing',
  'cracked',
  'leak',
  'unsafe',
  'mould',
  'mold',
  'poor',
] as const

function needsFollowUp(condition: string | null): boolean {
  if (!condition) return false
  const lower = condition.toLowerCase()
  return FOLLOW_UP_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(lower)
  )
}

export type InspectionRoomInput = {
  name: string
  roomType: RoomType
  overallCondition: ConditionRating | null
  notes: string | null
  items: InspectionItemInput[]
  /** Room-level photos (not tied to any specific item). */
  photoUrls: string[]
}

export type PhotoBytes = {
  bytes: Uint8Array
  contentType: string | null
}

export type InspectionPdfInputs = {
  reportLabel: string
  inspectionTypeLabel: string
  propertyAddress: string
  clerkName: string
  clientName: string
  inspectionStartedAt: Date
  inspectionCompletedAt: Date
  generalNotes: string | null
  meterReadings: Array<{
    label: string
    value: string
    serialNumber?: string | null
    location?: string | null
    supplier?: string | null
  }>
  smokeAlarmsChecked: boolean
  carbonMonoxideChecked: boolean
  executiveSummary?: ExecutiveSummary | null
  rooms: InspectionRoomInput[]
  clerkTypedName: string
  /**
   * Pre-fetched photo bytes keyed by URL. The caller downloads bytes (via the
   * supabase admin client) before calling — the renderer is storage-agnostic.
   * Missing keys render as a "photo unavailable" placeholder.
   */
  photoBytes: Map<string, PhotoBytes | null>
  /** Original capture timestamps keyed by stored photo URL. */
  photoTakenAt?: Map<string, Date | null>
  /**
   * The client's photo of the property (`properties.image_url`), fetched by
   * the caller like every other image here. Drawn on the cover under the
   * address so whoever opens the report — landlord, agent, tenant, an
   * adjudicator two years later — can see at a glance which building it
   * describes. Omitted entirely when absent; the cover simply closes up.
   */
  propertyPhoto?: PhotoBytes | null
  /**
   * The clerk's adopted signature mark (0040) — their name set in a
   * handwriting face, or drawn. When absent (reports submitted before
   * adopt-a-signature, or a stale tab), the declaration falls back to the
   * typed name in italic, which is what it always did.
   */
  clerkSignature?: PhotoBytes | null
}

/**
 * Did the clerk actually record anything against this item?
 *
 * The wizard seeds every room with its full template checklist (walls,
 * ceiling, skirting boards, sockets…), and a clerk only writes against the
 * ones that warrant it. Those untouched rows used to print anyway, so a
 * kitchen arrived as thirteen named items with an empty condition column —
 * pages of blank rows that bury the handful of real observations and read,
 * to a tenant or an adjudicator, as an inspection that wasn't done.
 *
 * An item with no description, no condition note and no photo is not an
 * observation, so it doesn't belong in the record. Prior-inspection
 * "before" photos deliberately don't count: they're context for a
 * comparison that was never made this visit.
 */
function itemWasRecorded(item: InspectionItemInput): boolean {
  return Boolean(
    item.description?.trim() ||
      item.condition?.trim() ||
      item.actionType ||
      item.actionComment?.trim() ||
      item.photoUrls.length > 0
  )
}

export const CONDITION_RATINGS = [
  'excellent',
  'good',
  'fair',
  'poor',
  'damaged',
  'missing',
  'na',
] as const
export type ConditionRating = (typeof CONDITION_RATINGS)[number]

// ── Palette ─────────────────────────────────────────────────────────
const INK = rgb(0.06, 0.09, 0.16) // near-black navy
const SLATE = rgb(0.22, 0.27, 0.34)
const MUTED = rgb(0.46, 0.51, 0.59)
const FAINT = rgb(0.6, 0.64, 0.7)
const TEAL = rgb(0.18, 0.77, 0.71) // LISTD brand #2EC4B6
const TEAL_DARK = rgb(0.04, 0.42, 0.39)
const TEAL_TINT = rgb(0.92, 0.98, 0.97)
const HAIR = rgb(0.86, 0.88, 0.91)
const ROW_SHADE = rgb(0.969, 0.976, 0.984)
const WHITE = rgb(1, 1, 1)

type BadgeStyle = { label: string; fg: RGB; bg: RGB }

function conditionStyle(c: ConditionRating | null): BadgeStyle {
  switch (c) {
    case 'excellent':
      return { label: 'Excellent', fg: rgb(0.05, 0.43, 0.29), bg: rgb(0.9, 0.97, 0.93) }
    case 'good':
      return { label: 'Good', fg: rgb(0.09, 0.45, 0.33), bg: rgb(0.92, 0.98, 0.95) }
    case 'fair':
      return { label: 'Fair', fg: rgb(0.61, 0.42, 0.02), bg: rgb(0.99, 0.96, 0.86) }
    case 'poor':
      return { label: 'Poor', fg: rgb(0.7, 0.31, 0.04), bg: rgb(0.99, 0.93, 0.86) }
    case 'damaged':
      return { label: 'Damaged', fg: rgb(0.7, 0.12, 0.12), bg: rgb(0.99, 0.91, 0.91) }
    case 'missing':
      return { label: 'Missing', fg: rgb(0.7, 0.12, 0.12), bg: rgb(0.99, 0.91, 0.91) }
    case 'na':
      return { label: 'N/A', fg: rgb(0.4, 0.44, 0.5), bg: rgb(0.95, 0.96, 0.97) }
    default:
      return { label: 'Not recorded', fg: rgb(0.5, 0.54, 0.6), bg: rgb(0.96, 0.97, 0.98) }
  }
}

// ── Geometry (A4 portrait) ──────────────────────────────────────────
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const CONTENT_TOP = PAGE_H - 66 // below the running header
const CONTENT_BOTTOM = 58 // above the running footer

/**
 * Stroke-only SVG paths for the cover letterhead contact icons. Lifted from
 * Lucide (MIT) — the same icon set used in the rest of the app — each on a
 * 24×24 viewBox so they line up at a single scale. We can't use the icon
 * font here: pdf-lib's standard Helvetica is WinAnsi and would render the
 * pictogram codepoints as glyph-missing boxes; raster PNGs would also work
 * but add binary assets for three tiny icons.
 */
const CONTACT_ICON_PATHS = {
  // Lucide `map-pin`: pin outline + inner circle.
  mapPin: [
    'M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0Z',
    'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  // Lucide `phone`: classic handset outline (single subpath).
  phone: [
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  ],
  // Lucide `mail`: rounded rectangle + diagonal flap (rect expressed as a
  // path so pdf-lib's drawSvgPath can stroke it directly).
  mail: [
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    'M2 7l8.97 5.7a1.94 1.94 0 0 0 2.06 0L22 7',
  ],
} as const

type RenderState = {
  pdf: PDFDocument
  page: PDFPage
  y: number
  helv: PDFFont
  bold: PDFFont
  italic: PDFFont
  imageCache: Map<string, PDFImage | null>
  photoTakenAt: Map<string, Date | null>
  /** Content pages that receive the running header/footer (cover excluded). */
  chromePages: PDFPage[]
  /** Drawn at the top of any new page while inside a room section. */
  continuation: string | null
}

export async function renderInspectionPdf(
  rawInputs: InspectionPdfInputs
): Promise<Uint8Array> {
  // Drop the untouched template rows ONCE, up front, so every section
  // downstream — the schedule, the room tables, the follow-up actions and
  // their cross-reference numbering — agrees on which items exist.
  const inputs: InspectionPdfInputs = {
    ...rawInputs,
    rooms: rawInputs.rooms.map((room) => ({
      ...room,
      items: room.items.filter(itemWasRecorded),
    })),
  }

  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const logo = await loadLogo(pdf)
  const imageCache = await embedPhotos(pdf, inputs.photoBytes)
  const coverPhoto = await embedSingle(pdf, inputs.propertyPhoto ?? null)
  const clerkMark = await embedSingle(pdf, inputs.clerkSignature ?? null)

  const state: RenderState = {
    pdf,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    y: CONTENT_TOP,
    helv,
    bold,
    italic,
    imageCache,
    photoTakenAt: inputs.photoTakenAt ?? new Map(),
    chromePages: [],
    continuation: null,
  }

  drawCover(state, inputs, logo, coverPhoto)

  newPage(state)
  drawExecutiveSummary(state, inputs)

  newPage(state)
  drawInterpretations(state)

  newPage(state)
  drawDisclaimer(state)

  newPage(state)
  drawScheduleOfCondition(state, inputs)
  drawMeterReadings(state, inputs)
  drawAlarms(state, inputs)

  inputs.rooms.forEach((room, idx) => {
    newPage(state)
    drawRoom(state, room, idx + 4)
  })

  const actions = collectActions(inputs)
  if (actions.length > 0) {
    newPage(state)
    drawActions(state, actions, inputs.rooms.length + 4)
  }

  newPage(state)
  drawDeclaration(state, inputs, clerkMark)

  applyHeaderFooter(state, inputs, logo)

  return pdf.save()
}

// ── Cover ───────────────────────────────────────────────────────────
function drawCover(
  state: RenderState,
  i: InspectionPdfInputs,
  // The brand mark is no longer drawn on the cover (replaced by the
  // letterhead block below) but the parameter stays for symmetry with
  // applyHeaderFooter, which still uses the logo on content pages.
  _logo: PDFImage | null,
  propertyPhoto: PDFImage | null
) {
  const { page } = state

  // Top accent band.
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: TEAL })

  // First-page letterhead: business name + contact card. Replaces the bare
  // "LISTD" / logo block on the cover only — the running header on
  // content pages keeps the compact mark.
  let y = PAGE_H - 96
  page.drawText('LISTD Inventory', {
    x: MARGIN,
    y,
    size: 28,
    font: state.bold,
    color: TEAL,
  })
  y -= 30
  // Each contact row pairs a Lucide icon (rendered via pdf-lib's
  // drawSvgPath — Helvetica doesn't ship pictogram glyphs) with the text.
  // The icon's 24×24 viewBox is drawn at scale 0.5 (= 12pt tall) with the
  // top-left at (MARGIN, y + 11) so the icon centres against the 10pt
  // text baseline below it. Stroke-only with the brand teal.
  const contactRows: Array<{ icon: readonly string[]; text: string }> = [
    {
      icon: CONTACT_ICON_PATHS.mapPin,
      text: 'Suite 41, 14-15 Triangle South, Clifton, Bristol',
    },
    { icon: CONTACT_ICON_PATHS.phone, text: '07413065681' },
    { icon: CONTACT_ICON_PATHS.mail, text: 'hello@listdinventory.co.uk' },
  ]
  for (const row of contactRows) {
    for (const subpath of row.icon) {
      page.drawSvgPath(subpath, {
        x: MARGIN,
        y: y + 11,
        scale: 0.5,
        borderColor: TEAL,
        borderWidth: 1.2,
      })
    }
    page.drawText(row.text, {
      x: MARGIN + 18,
      y,
      size: 10,
      font: state.helv,
      color: SLATE,
    })
    y -= 16
  }
  y -= 14

  page.drawText(formatDateLong(i.inspectionCompletedAt).toUpperCase(), {
    x: MARGIN,
    y,
    size: 10,
    font: state.bold,
    color: TEAL_DARK,
  })
  y -= 30

  for (const line of wrap(i.inspectionTypeLabel, state.bold, 34, CONTENT_W)) {
    page.drawText(line, { x: MARGIN, y, size: 34, font: state.bold, color: INK })
    y -= 40
  }
  page.drawText('Inventory & Schedule of Condition', {
    x: MARGIN,
    y,
    size: 13,
    font: state.helv,
    color: MUTED,
  })
  y -= 30

  page.drawRectangle({ x: MARGIN, y, width: 60, height: 3, color: TEAL })
  y -= 30

  for (const line of wrap(i.propertyAddress, state.bold, 17, CONTENT_W)) {
    page.drawText(line, { x: MARGIN, y, size: 17, font: state.bold, color: INK })
    y -= 23
  }
  y -= 16

  // Property thumbnail, between the address and the details card.
  //
  // Scaled to FIT the box rather than fill it, and centred: these are
  // phone snaps of whatever the client had to hand, portrait or
  // landscape, and cropping a front door out of frame to fill a band
  // would defeat the point. The box is sized so the cover still closes
  // above the footer note at y=70 even with the tallest photo.
  if (propertyPhoto) {
    const boxW = CONTENT_W
    const boxH = 150
    const scale = Math.min(
      boxW / propertyPhoto.width,
      boxH / propertyPhoto.height
    )
    const drawW = propertyPhoto.width * scale
    const drawH = propertyPhoto.height * scale
    page.drawImage(propertyPhoto, {
      x: MARGIN + (boxW - drawW) / 2,
      y: y - drawH,
      width: drawW,
      height: drawH,
    })
    page.drawRectangle({
      x: MARGIN + (boxW - drawW) / 2,
      y: y - drawH,
      width: drawW,
      height: drawH,
      borderColor: HAIR,
      borderWidth: 0.75,
    })
    y -= drawH + 22
  } else {
    y -= 8
  }

  // Details card.
  const rows: Array<[string, string]> = [
    ['Prepared by', i.clerkName],
    ['On behalf of', i.clientName],
    ['Inspection started', formatTimestamp(i.inspectionStartedAt)],
    ['Inspection completed', formatTimestamp(i.inspectionCompletedAt)],
    ['Reference', i.reportLabel],
  ]
  const cardH = rows.length * 26 + 24
  page.drawRectangle({
    x: MARGIN,
    y: y - cardH,
    width: CONTENT_W,
    height: cardH,
    color: rgb(0.98, 0.985, 0.99),
    borderColor: HAIR,
    borderWidth: 0.75,
  })
  let ry = y - 24
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), {
      x: MARGIN + 18,
      y: ry,
      size: 8,
      font: state.bold,
      color: FAINT,
    })
    page.drawText(value, {
      x: MARGIN + 168,
      y: ry,
      size: 11,
      font: state.helv,
      color: INK,
      maxWidth: CONTENT_W - 168 - 18,
    })
    ry -= 26
  }

  page.drawText(
    'This report is a record of the condition and cleanliness of the property and its contents observed on the dates shown above.',
    {
      x: MARGIN,
      y: 70,
      size: 8.5,
      font: state.italic,
      color: MUTED,
      maxWidth: CONTENT_W,
      lineHeight: 12,
    }
  )
}

// ── Static reference sections ───────────────────────────────────────
function drawExecutiveSummary(state: RenderState, i: InspectionPdfInputs) {
  const summary = i.executiveSummary ?? deriveRenderSummary(i)
  const totalActions = summary.maintenance.length + summary.cleaning.length

  drawSectionTitle(state, 'Executive Summary')
  drawParagraph(
    state,
    'A concise overview of the recorded condition and the items requiring investigation. The detailed room schedule and Actions section remain the authoritative inspection record.',
    8.5,
    MUTED
  )
  drawGap(state, 12)

  const badgeText = `${totalActions} action${totalActions === 1 ? '' : 's'} flagged`
  const badgeWidth = state.bold.widthOfTextAtSize(badgeText, 10) + 28
  state.page.drawRectangle({
    x: MARGIN,
    y: state.y - 22,
    width: badgeWidth,
    height: 24,
    color: totalActions > 0 ? rgb(0.99, 0.95, 0.92) : TEAL_TINT,
  })
  state.page.drawText(badgeText, {
    x: MARGIN + 14,
    y: state.y - 14,
    size: 10,
    font: state.bold,
    color: totalActions > 0 ? rgb(0.6, 0.28, 0.05) : TEAL_DARK,
  })
  state.y -= 40

  drawMiniHeading(state, 'Overall condition')
  drawParagraph(state, summary.overall || 'No overall summary was recorded.', 10, INK)
  drawGap(state, 12)

  drawSummaryActions(
    state,
    'Maintenance - investigate',
    summary.maintenance,
    'No maintenance actions were flagged.'
  )
  drawGap(state, 8)
  drawSummaryActions(
    state,
    'Cleaning - investigate',
    summary.cleaning,
    'No cleaning actions were flagged.'
  )
}

function drawSummaryActions(
  state: RenderState,
  heading: string,
  entries: string[],
  emptyText: string
) {
  drawMiniHeading(state, heading)
  if (entries.length === 0) {
    drawParagraph(state, emptyText, 9, MUTED)
    return
  }

  for (const entry of entries) {
    const lines = wrap(entry, state.helv, 9.5, CONTENT_W - 20)
    ensureSpace(state, Math.max(15, lines.length * 13 + 4))
    state.page.drawCircle({
      x: MARGIN + 3,
      y: state.y + 3,
      size: 2.2,
      color: TEAL,
    })
    lines.forEach((line, idx) => {
      state.page.drawText(line, {
        x: MARGIN + 16,
        y: state.y - idx * 13,
        size: 9.5,
        font: state.helv,
        color: SLATE,
      })
    })
    state.y -= lines.length * 13 + 5
  }
}

function deriveRenderSummary(i: InspectionPdfInputs): ExecutiveSummary {
  const actions = collectActions(i)
  const maintenance = actions
    .filter((action) => action.type === 'maintenance')
    .map(actionSummaryText)
  const cleaning = actions
    .filter((action) => action.type === 'cleaning')
    .map(actionSummaryText)
  const itemCount = i.rooms.reduce((count, room) => count + room.items.length, 0)

  return {
    overall: `This report records ${itemCount} item observation${itemCount === 1 ? '' : 's'} across ${i.rooms.length} area${i.rooms.length === 1 ? '' : 's'}. ${maintenance.length} maintenance and ${cleaning.length} cleaning action${maintenance.length + cleaning.length === 1 ? ' is' : 's are'} flagged for investigation.`,
    maintenance,
    cleaning,
    source: 'fallback',
  }
}

function actionSummaryText(action: ActionRow): string {
  const detail = action.comment || action.condition || 'Follow-up requested by the inspecting clerk.'
  return `${action.ref} - ${action.room} / ${action.item}: ${detail}`
}

function drawInterpretations(state: RenderState) {
  drawSectionTitle(state, 'Interpretations')
  drawParagraph(
    state,
    'Where no condition has been recorded, the item can be interpreted as being in good condition : that is, showing signs of wear consistent with use. Where access is not possible, the relevant reading or item is recorded as “Not accessible / Not applicable : please contact the agent.”'
  )
  drawGap(state, 6)
  drawMiniHeading(state, 'Condition')
  const conditions: Array<[string, string]> = [
    ['New', 'Unused condition.'],
    ['Excellent / Very good', 'No marks, tears or stains; generally under one year old.'],
    ['Good', 'Signs of slight wear; generally lightly worn.'],
    ['Fair', 'Signs of age, frayed, small light stains, marks and discolouration.'],
    ['Poor', 'Extensive signs of wear and tear, stains/marks/tears/chips; still functional.'],
    ['Very poor', 'Extensively damaged/faulty items, large stains, torn and/or dirty.'],
    ['Weathered', 'Outside: signs of slight wear; generally lightly worn.'],
  ]
  for (const [term, def] of conditions) drawDefinition(state, term, def)

  drawGap(state, 6)
  drawMiniHeading(state, 'Cleanliness')
  const cleanliness: Array<[string, string]> = [
    ['Professional standard', 'All surfaces clean, dust-free, polished and free from residue and limescale.'],
    ['Domestic standard', 'All surfaces clean; minor dust or grubby marks in places requiring a minor wipe or vacuum.'],
    ['Further cleaning required', 'Surfaces are dusty or grubby; light cleaning, sweeping, vacuuming or dusting needed.'],
    ['Poor standard', 'Requires a thorough full clean throughout, with significant issues noted in the report.'],
  ]
  for (const [term, def] of cleanliness) drawDefinition(state, term, def)
}

function drawDisclaimer(state: RenderState) {
  drawSectionTitle(state, 'Disclaimer')
  const paras = [
    'This report is a detailed narrative record from a visual inspection, compiled in good faith to provide an accurate descriptive record of the property’s contents and their condition and cleanliness on the date of compilation. It is the duty and ultimate responsibility of the Landlord, Tenant and Agent to agree between them the accuracy of this Inventory Report.',
    'LISTD Inventory and its clerks are not trained or qualified Property Surveyors and this report should not be used as a structural survey of a property. We are not qualified as experts on any type of cloth, wood or other material including antiques. This report should not be deemed a definitive statement of each and every item of equipment or furniture, nor does it provide any guarantee regarding the safety of any equipment, furniture or other contents.',
    'It may not be possible to move certain items of furniture to inspect behind or beneath, due to weight or fragility. We do not rearrange furniture, inspect lofts or cellars, inspect locked rooms unless a key is provided, or inspect items packed for storage or in boxes.',
    'LISTD Inventory and its clerks do not check gas or electrical appliances and give no guarantee with regard to the safety or reliability of such items. Smoke and carbon monoxide alarms are tested for power only; it is the responsibility of the Tenant to make sure that, where fitted, they are working correctly at all times. The responsibility for compliance with Fire & Safety Regulations for Furnishings, Gas and Electrical services rests with the Instructing party.',
  ]
  for (const p of paras) {
    drawParagraph(state, p, 9)
    drawGap(state, 4)
  }
}

// ── Schedule of Condition ───────────────────────────────────────────
function drawScheduleOfCondition(state: RenderState, i: InspectionPdfInputs) {
  drawSectionTitle(state, '1. Schedule of Condition', true)
  const colRef = MARGIN
  const colName = MARGIN + 48
  const colCond = MARGIN + 200
  // The overall-condition rating is optional in the wizard, and in
  // practice clerks record it per item rather than per room. When nobody
  // set one, the column printed "Not recorded" against every area — a
  // whole column asserting that nothing was assessed, next to rooms full
  // of observations. Drop the column unless at least one area has a
  // rating; areas without one leave the cell empty rather than claiming
  // an absence.
  const anyOverall = i.rooms.some((r) => r.overallCondition)
  const cols: Array<[number, string]> = [
    [colRef, 'REF'],
    [colName, 'AREA'],
  ]
  if (anyOverall) cols.push([colCond, 'OVERALL CONDITION'])
  drawTableHeader(state, cols)
  let n = 1
  if (i.rooms.length === 0) {
    drawEmptyRow(state, 'No areas recorded.')
  }
  for (const room of i.rooms) {
    const ref = `1.${n}`
    const nameWidth = anyOverall ? colCond - colName - 8 : CONTENT_W - 48 - 8
    const nameLines = wrap(room.name, state.helv, 9.5, nameWidth)
    const rowH = Math.max(20, nameLines.length * 12 + 8)
    ensureSpace(state, rowH)
    if (n % 2 === 0) {
      state.page.drawRectangle({
        x: MARGIN,
        y: state.y - rowH + 4,
        width: CONTENT_W,
        height: rowH,
        color: ROW_SHADE,
      })
    }
    state.page.drawText(ref, { x: colRef, y: state.y - 8, size: 9, font: state.helv, color: MUTED })
    nameLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colName,
        y: state.y - 8 - k * 12,
        size: 9.5,
        font: state.bold,
        color: INK,
      })
    )
    if (room.overallCondition) {
      drawBadge(
        state,
        conditionStyle(room.overallCondition),
        colCond,
        state.y - 10
      )
    }
    state.y -= rowH
    n++
  }
  drawGap(state, 14)
}

function drawMeterReadings(state: RenderState, i: InspectionPdfInputs) {
  drawSectionTitle(state, '2. Meter Readings', true)
  // Five-column layout: REF | METER (name) | SERIAL | READING | LOCATION / SUPPLIER.
  // Supplier sits below location in the right-hand column so the table
  // stays five visual columns wide rather than spilling off A4.
  const colRef = MARGIN
  const colName = MARGIN + 32
  const colSerial = MARGIN + 138
  const colReading = MARGIN + 232
  const colLocation = MARGIN + 332
  const rightEdge = MARGIN + CONTENT_W
  drawTableHeader(state, [
    [colRef, 'REF'],
    [colName, 'METER'],
    [colSerial, 'SERIAL'],
    [colReading, 'READING'],
    [colLocation, 'LOCATION / SUPPLIER'],
  ])
  if (i.meterReadings.length === 0) {
    drawEmptyRow(state, 'No meter readings recorded.')
    drawGap(state, 14)
    return
  }
  i.meterReadings.forEach((m, idx) => {
    const ref = `2.${idx + 1}`
    const nameLines = wrap(m.label, state.bold, 9.5, colSerial - colName - 6)
    const serialLines = wrap(
      m.serialNumber || '—',
      state.helv,
      9.5,
      colReading - colSerial - 6
    )
    const readingLines = wrap(
      m.value || '—',
      state.helv,
      9.5,
      colLocation - colReading - 6
    )
    const locationLines = m.location
      ? wrap(m.location, state.helv, 9.5, rightEdge - colLocation - 4)
      : ['—']
    const supplierLines = m.supplier
      ? wrap(m.supplier, state.helv, 8.5, rightEdge - colLocation - 4)
      : []
    const rightLineCount = locationLines.length + supplierLines.length
    const rowH =
      Math.max(
        20,
        nameLines.length * 12,
        serialLines.length * 12,
        readingLines.length * 12,
        rightLineCount * 12
      ) + 8
    ensureSpace(state, rowH)
    if (idx % 2 === 1) {
      state.page.drawRectangle({
        x: MARGIN,
        y: state.y - rowH + 4,
        width: CONTENT_W,
        height: rowH,
        color: ROW_SHADE,
      })
    }
    state.page.drawText(ref, {
      x: colRef,
      y: state.y - 8,
      size: 9,
      font: state.helv,
      color: MUTED,
    })
    nameLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colName,
        y: state.y - 8 - k * 12,
        size: 9.5,
        font: state.bold,
        color: INK,
      })
    )
    serialLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colSerial,
        y: state.y - 8 - k * 12,
        size: 9,
        font: state.helv,
        color: SLATE,
      })
    )
    readingLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colReading,
        y: state.y - 8 - k * 12,
        size: 9.5,
        font: state.helv,
        color: SLATE,
      })
    )
    locationLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colLocation,
        y: state.y - 8 - k * 12,
        size: 9,
        font: state.helv,
        color: SLATE,
      })
    )
    supplierLines.forEach((ln, k) =>
      state.page.drawText(ln, {
        x: colLocation,
        y: state.y - 8 - (locationLines.length + k) * 12,
        size: 8.5,
        font: state.italic,
        color: MUTED,
      })
    )
    state.y -= rowH
  })
  drawGap(state, 14)
}

function drawAlarms(state: RenderState, i: InspectionPdfInputs) {
  drawSectionTitle(state, '3. Alarms', true)
  const colRef = MARGIN
  const colName = MARGIN + 48
  const colVal = MARGIN + 260
  drawTableHeader(state, [
    [colRef, 'REF'],
    [colName, 'ALARM'],
    [colVal, 'TESTED FOR POWER'],
  ])
  const rows: Array<[string, boolean]> = [
    ['Smoke alarms', i.smokeAlarmsChecked],
    ['Carbon monoxide alarms', i.carbonMonoxideChecked],
  ]
  rows.forEach(([name, checked], idx) => {
    const rowH = 20
    ensureSpace(state, rowH)
    if (idx % 2 === 1) {
      state.page.drawRectangle({ x: MARGIN, y: state.y - rowH + 4, width: CONTENT_W, height: rowH, color: ROW_SHADE })
    }
    state.page.drawText(`3.${idx + 1}`, { x: colRef, y: state.y - 8, size: 9, font: state.helv, color: MUTED })
    state.page.drawText(name, { x: colName, y: state.y - 8, size: 9.5, font: state.bold, color: INK })
    const style: BadgeStyle = checked
      ? { label: 'Tested', fg: rgb(0.09, 0.45, 0.33), bg: rgb(0.92, 0.98, 0.95) }
      : { label: 'Not tested', fg: rgb(0.5, 0.54, 0.6), bg: rgb(0.96, 0.97, 0.98) }
    drawBadge(state, style, colVal, state.y - 10)
    state.y -= rowH
  })
  drawParagraph(
    state,
    'Alarms are tested for power only. It is the Tenant’s responsibility to ensure that, where fitted, they are working correctly at all times.',
    8,
    MUTED
  )
}

// ── Rooms ───────────────────────────────────────────────────────────
function drawRoom(state: RenderState, room: InspectionRoomInput, sectionNo: number) {
  const title = `${sectionNo}. ${room.name}`
  drawSectionTitle(state, title, true)
  state.continuation = `${room.name} (cont.)`
  state.page.drawText(ROOM_TYPE_LABELS[room.roomType], {
    x: MARGIN,
    y: state.y,
    size: 9,
    font: state.italic,
    color: MUTED,
  })
  state.y -= 16

  if (room.overallCondition) {
    drawBadge(state, conditionStyle(room.overallCondition), MARGIN, state.y - 2)
    state.y -= 22
  }

  if (room.notes) {
    drawParagraph(state, room.notes, 9, SLATE)
  }

  if (room.items.length === 0 && room.photoUrls.length === 0) {
    // The area still gets its heading — silently dropping a room from an
    // inventory would hide that it existed and wasn't inspected, which is
    // exactly the thing a deposit dispute turns on.
    drawEmptyRow(state, 'Nothing recorded in this area.')
    state.continuation = null
    return
  }

  // Column header for items.
  if (room.items.length > 0) {
    drawTableHeader(state, [
      [MARGIN, 'REF'],
      [MARGIN + 48, 'ITEM'],
      [MARGIN + CONTENT_W - 96, 'CONDITION'],
    ])
    room.items.forEach((item, idx) => drawItem(state, item, `${sectionNo}.${idx + 1}`))
  }

  if (room.photoUrls.length > 0) {
    drawMiniHeading(state, 'Room photos')
    drawPhotoGrid(state, room.photoUrls, `${sectionNo}`)
  }

  state.continuation = null
}

function drawItem(state: RenderState, item: InspectionItemInput, ref: string) {
  ensureSpace(state, 40)
  state.page.drawText(ref, { x: MARGIN, y: state.y - 9, size: 9, font: state.helv, color: MUTED })
  const nameLines = wrap(item.itemName, state.bold, 10.5, CONTENT_W - 48)
  nameLines.forEach((ln, k) =>
    state.page.drawText(ln, {
      x: MARGIN + 48,
      y: state.y - 9 - k * 13,
      size: 10.5,
      font: state.bold,
      color: INK,
    })
  )
  state.y -= Math.max(18, nameLines.length * 13 + 4)

  if (item.description) {
    drawLabelledParagraph(state, 'Description', item.description)
  }
  if (item.condition) {
    drawLabelledParagraph(state, 'Condition', item.condition)
  }

  if (item.actionType) {
    drawFlag(
      state,
      item.actionType === 'cleaning'
        ? 'Needs Cleaning - Investigate'
        : 'Needs Maintenance - Investigate'
    )
    if (item.actionComment?.trim()) {
      drawLabelledParagraph(state, 'Investigation note', item.actionComment)
    }
  } else if (needsFollowUp(item.condition)) {
    drawFlag(state, 'Needs Maintenance - Investigate')
  }

  if (item.beforePhotoUrls && item.beforePhotoUrls.length > 0) {
    // Before/after: prior-inspection photos labelled, then this inspection's.
    drawMiniHeading(state, 'Before · prior inspection')
    drawPhotoGrid(state, item.beforePhotoUrls, ref)
    if (item.photoUrls.length > 0) {
      drawMiniHeading(state, 'After · this inspection')
      drawPhotoGrid(state, item.photoUrls, ref)
    }
  } else if (item.photoUrls.length > 0) {
    drawPhotoGrid(state, item.photoUrls, ref)
  }

  drawGap(state, 4)
  ensureSpace(state, 6)
  state.page.drawLine({
    start: { x: MARGIN, y: state.y + 2 },
    end: { x: MARGIN + CONTENT_W, y: state.y + 2 },
    thickness: 0.5,
    color: HAIR,
  })
  state.y -= 8
}

// ── Actions + Declaration ───────────────────────────────────────────
type ActionRow = {
  ref: string
  room: string
  item: string
  type: ReportActionType
  condition: string
  comment: string
}

function collectActions(i: InspectionPdfInputs): ActionRow[] {
  const out: ActionRow[] = []
  i.rooms.forEach((room, r) => {
    room.items.forEach((item, idx) => {
      const type = item.actionType ?? (needsFollowUp(item.condition) ? 'maintenance' : null)
      if (type) {
        out.push({
          ref: `${r + 4}.${idx + 1}`,
          room: room.name,
          item: item.itemName,
          type,
          condition: item.condition ?? '',
          comment: item.actionComment?.trim() ?? '',
        })
      }
    })
  })
  return out
}

function drawActions(state: RenderState, actions: ActionRow[], sectionNo: number) {
  drawSectionTitle(state, `${sectionNo}. Investigate Responsibilities`, true)
  drawParagraph(
    state,
    'Items flagged by the clerk, or conservatively inferred from legacy condition notes, for maintenance or cleaning investigation. Responsibility is not assigned by this report.',
    9,
    MUTED
  )
  drawGap(state, 4)
  const actionCol = MARGIN + CONTENT_W - 286
  const noteCol = MARGIN + CONTENT_W - 174
  drawTableHeader(state, [
    [MARGIN, 'REF'],
    [MARGIN + 48, 'ITEM'],
    [actionCol, 'ACTION'],
    [noteCol, 'NOTE'],
  ])
  actions.forEach((a, idx) => {
    const label = `${a.item} : ${a.room}`
    const labelLines = wrap(label, state.helv, 9.5, actionCol - (MARGIN + 48) - 8)
    const actionLines = wrap(
      a.type === 'cleaning' ? 'Cleaning - investigate' : 'Maintenance - investigate',
      state.bold,
      8.5,
      noteCol - actionCol - 8
    )
    const noteLines = wrap(
      a.comment || a.condition || 'Follow-up requested.',
      state.helv,
      9,
      MARGIN + CONTENT_W - noteCol - 4
    )
    const rowH = Math.max(20, labelLines.length * 12, actionLines.length * 11, noteLines.length * 12) + 8
    ensureSpace(state, rowH)
    if (idx % 2 === 1) {
      state.page.drawRectangle({ x: MARGIN, y: state.y - rowH + 4, width: CONTENT_W, height: rowH, color: ROW_SHADE })
    }
    state.page.drawText(a.ref, { x: MARGIN, y: state.y - 8, size: 9, font: state.helv, color: MUTED })
    labelLines.forEach((ln, k) =>
      state.page.drawText(ln, { x: MARGIN + 48, y: state.y - 8 - k * 12, size: 9.5, font: state.helv, color: SLATE })
    )
    actionLines.forEach((ln, k) =>
      state.page.drawText(ln, { x: actionCol, y: state.y - 8 - k * 11, size: 8.5, font: state.bold, color: TEAL_DARK })
    )
    noteLines.forEach((ln, k) =>
      state.page.drawText(ln, { x: noteCol, y: state.y - 8 - k * 12, size: 9, font: state.italic, color: SLATE })
    )
    state.y -= rowH
  })
}

function drawDeclaration(
  state: RenderState,
  i: InspectionPdfInputs,
  clerkMark: PDFImage | null
) {
  drawSectionTitle(state, 'Declaration')

  if (i.generalNotes) {
    drawMiniHeading(state, 'General notes')
    drawParagraph(state, i.generalNotes, 9.5, SLATE)
    drawGap(state, 8)
  }

  drawParagraph(
    state,
    'I confirm that this report accurately reflects the condition and cleanliness of the property and its contents as observed during the inspection.',
    9.5,
    SLATE
  )
  drawGap(state, 12)

  // Clerk signature card.
  ensureSpace(state, 110)
  const boxY = state.y - 92
  state.page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: 300,
    height: 92,
    color: rgb(0.98, 0.985, 0.99),
    borderColor: HAIR,
    borderWidth: 0.75,
  })
  state.page.drawText('INSPECTING CLERK', { x: MARGIN + 16, y: boxY + 70, size: 8, font: state.bold, color: FAINT })
  if (clerkMark) {
    // Fit the mark above the rule, preserving aspect. Never enlarge — a
    // small drawn squiggle blown up to fill the box looks forged.
    const maxW = 268
    const maxH = 34
    const scale = Math.min(maxW / clerkMark.width, maxH / clerkMark.height, 1)
    state.page.drawImage(clerkMark, {
      x: MARGIN + 16,
      y: boxY + 34,
      width: clerkMark.width * scale,
      height: clerkMark.height * scale,
    })
  } else {
    state.page.drawText(i.clerkTypedName, {
      x: MARGIN + 16,
      y: boxY + 40,
      size: 20,
      font: state.italic,
      color: INK,
    })
  }
  state.page.drawLine({
    start: { x: MARGIN + 16, y: boxY + 32 },
    end: { x: MARGIN + 284, y: boxY + 32 },
    thickness: 0.5,
    color: HAIR,
  })
  // The name is printed under the mark regardless: a signature page
  // showing only a squiggle is worth less in a dispute than one naming
  // who made it.
  state.page.drawText(`${clerkMark ? i.clerkTypedName : 'Typed signature'} · ${formatTimestamp(i.inspectionCompletedAt)}`, {
    x: MARGIN + 16,
    y: boxY + 16,
    size: 8,
    font: state.helv,
    color: MUTED,
  })
  state.y = boxY - 24

  drawParagraph(
    state,
    'The Landlord, Tenant and Agent should review this report and notify the agent of any amendments within seven days of receipt. In the absence of any such notification, this report will be deemed an accurate record of the property.',
    8.5,
    MUTED
  )
}

// ── Shared drawing primitives ───────────────────────────────────────
function drawSectionTitle(state: RenderState, text: string, spaceBefore = false) {
  if (spaceBefore) drawGap(state, 8)
  ensureSpace(state, 40)
  const h = 26
  state.page.drawRectangle({ x: MARGIN, y: state.y - h + 6, width: CONTENT_W, height: h, color: TEAL_TINT })
  state.page.drawRectangle({ x: MARGIN, y: state.y - h + 6, width: 4, height: h, color: TEAL })
  state.page.drawText(text, {
    x: MARGIN + 14,
    y: state.y - h + 14,
    size: 13,
    font: state.bold,
    color: TEAL_DARK,
  })
  state.y -= h + 8
}

function drawMiniHeading(state: RenderState, text: string) {
  drawGap(state, 4)
  ensureSpace(state, 18)
  state.page.drawText(text.toUpperCase(), {
    x: MARGIN,
    y: state.y,
    size: 8.5,
    font: state.bold,
    color: TEAL_DARK,
  })
  state.y -= 15
}

function drawTableHeader(state: RenderState, cols: Array<[number, string]>) {
  ensureSpace(state, 20)
  const h = 18
  state.page.drawRectangle({ x: MARGIN, y: state.y - h + 4, width: CONTENT_W, height: h, color: INK })
  for (const [x, label] of cols) {
    state.page.drawText(label, { x: x + 4, y: state.y - 8, size: 7.5, font: state.bold, color: WHITE })
  }
  state.y -= h + 4
}

function drawBadge(state: RenderState, style: BadgeStyle, x: number, y: number) {
  const padX = 7
  const w = state.bold.widthOfTextAtSize(style.label, 8) + padX * 2
  const h = 15
  state.page.drawRectangle({ x, y: y - 3, width: w, height: h, color: style.bg })
  state.page.drawText(style.label, { x: x + padX, y: y + 1, size: 8, font: state.bold, color: style.fg })
}

function drawFlag(state: RenderState, text: string) {
  ensureSpace(state, 18)
  const h = 16
  state.page.drawRectangle({
    x: MARGIN + 48,
    y: state.y - h + 4,
    width: CONTENT_W - 48,
    height: h,
    color: rgb(0.99, 0.95, 0.92),
  })
  state.page.drawRectangle({ x: MARGIN + 48, y: state.y - h + 4, width: 3, height: h, color: rgb(0.85, 0.4, 0.1) })
  state.page.drawText(text, {
    x: MARGIN + 58,
    y: state.y - 7,
    size: 8.5,
    font: state.bold,
    color: rgb(0.6, 0.28, 0.05),
  })
  state.y -= h + 4
}

function drawDefinition(state: RenderState, term: string, def: string) {
  ensureSpace(state, 14)
  const termW = 130
  state.page.drawText(term, { x: MARGIN, y: state.y, size: 9, font: state.bold, color: INK })
  const lines = wrap(def, state.helv, 9, CONTENT_W - termW)
  lines.forEach((ln, k) =>
    state.page.drawText(ln, { x: MARGIN + termW, y: state.y - k * 12, size: 9, font: state.helv, color: SLATE })
  )
  state.y -= Math.max(14, lines.length * 12 + 2)
}

/**
 * Render a small uppercase label ("DESCRIPTION", "CONDITION") followed
 * by a wrapped paragraph of free text. Used for the item rows now that
 * the form captures free-text narrative rather than enum + notes pair.
 */
function drawLabelledParagraph(state: RenderState, label: string, body: string) {
  ensureSpace(state, 14)
  state.page.drawText(label.toUpperCase(), {
    x: MARGIN + 48,
    y: state.y,
    size: 7.5,
    font: state.bold,
    color: FAINT,
  })
  state.y -= 11
  drawParagraph(state, body, 9.5, SLATE, MARGIN + 48)
  state.y -= 2
}

function drawParagraph(
  state: RenderState,
  text: string,
  size = 9.5,
  color: RGB = SLATE,
  x = MARGIN
) {
  const maxW = MARGIN + CONTENT_W - x
  const lh = size * 1.4
  for (const line of wrap(text, state.helv, size, maxW)) {
    ensureSpace(state, lh)
    state.page.drawText(line, { x, y: state.y, size, font: state.helv, color })
    state.y -= lh
  }
}

function drawEmptyRow(state: RenderState, text: string) {
  ensureSpace(state, 18)
  state.page.drawText(text, { x: MARGIN, y: state.y - 6, size: 9, font: state.italic, color: MUTED })
  state.y -= 20
}

function drawGap(state: RenderState, amount: number) {
  state.y -= amount
}

function drawPhotoGrid(state: RenderState, urls: string[], refLabel: string) {
  const cols = 2
  const gap = 10
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols
  const cellH = cellW * 0.72
  const capH = 13

  for (let i = 0; i < urls.length; i += cols) {
    ensureSpace(state, cellH + capH + 8)
    const rowTop = state.y
    for (let c = 0; c < cols && i + c < urls.length; c++) {
      const url = urls[i + c]
      const img = state.imageCache.get(url) ?? null
      const x = MARGIN + c * (cellW + gap)
      const cellBottom = rowTop - cellH
      state.page.drawRectangle({
        x,
        y: cellBottom,
        width: cellW,
        height: cellH,
        color: rgb(0.97, 0.975, 0.98),
        borderColor: HAIR,
        borderWidth: 0.5,
      })
      if (img) {
        const ratio = Math.min(cellW / img.width, cellH / img.height)
        const w = img.width * ratio
        const h = img.height * ratio
        state.page.drawImage(img, {
          x: x + (cellW - w) / 2,
          y: cellBottom + (cellH - h) / 2,
          width: w,
          height: h,
        })
      } else {
        state.page.drawText('photo unavailable', {
          x: x + 10,
          y: cellBottom + cellH / 2 - 4,
          size: 8,
          font: state.italic,
          color: FAINT,
        })
      }
      const capturedAt = state.photoTakenAt.get(url)
      const timestamp = capturedAt ? ` · ${formatTimestamp(capturedAt)}` : ''
      state.page.drawText(`Ref #${refLabel} · photo ${i + c + 1}${timestamp}`, {
        x,
        y: cellBottom - 11,
        size: 7.5,
        font: state.helv,
        color: MUTED,
      })
    }
    state.y = rowTop - cellH - capH - 8
  }
}

// ── Running header / footer (two-pass: needs the final page count) ──
function applyHeaderFooter(
  state: RenderState,
  i: InspectionPdfInputs,
  logo: PDFImage | null
) {
  const total = state.chromePages.length
  const addr = truncate(i.propertyAddress, state.helv, 8, CONTENT_W - 90)
  state.chromePages.forEach((page, idx) => {
    // Header.
    if (logo) {
      const w = 58
      const h = (logo.height / logo.width) * w
      page.drawImage(logo, { x: MARGIN, y: PAGE_H - 40, width: w, height: h })
    } else {
      page.drawText('LISTD', { x: MARGIN, y: PAGE_H - 36, size: 11, font: state.bold, color: INK })
    }
    page.drawText('Inventory & Schedule of Condition', {
      x: PAGE_W - MARGIN - state.helv.widthOfTextAtSize('Inventory & Schedule of Condition', 8),
      y: PAGE_H - 34,
      size: 8,
      font: state.helv,
      color: FAINT,
    })
    page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 50 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 50 },
      thickness: 1,
      color: TEAL,
    })

    // Footer.
    page.drawLine({
      start: { x: MARGIN, y: 46 },
      end: { x: PAGE_W - MARGIN, y: 46 },
      thickness: 0.5,
      color: HAIR,
    })
    page.drawText(addr, { x: MARGIN, y: 33, size: 8, font: state.helv, color: MUTED })
    const pageLabel = `Tenant Initials: ______   ·   Page ${idx + 1} of ${total}`
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN - state.helv.widthOfTextAtSize(pageLabel, 8),
      y: 33,
      size: 8,
      font: state.helv,
      color: MUTED,
    })
  })
}

// ── Layout helpers ──────────────────────────────────────────────────
function ensureSpace(state: RenderState, needed: number) {
  if (state.y - needed < CONTENT_BOTTOM) newPage(state)
}

function newPage(state: RenderState) {
  state.page = state.pdf.addPage([PAGE_W, PAGE_H])
  state.chromePages.push(state.page)
  state.y = CONTENT_TOP
  if (state.continuation) {
    state.page.drawText(state.continuation, {
      x: MARGIN,
      y: state.y,
      size: 9,
      font: state.italic,
      color: MUTED,
    })
    state.y -= 18
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of (text ?? '').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) out.push(line)
    if (words.length === 0) out.push('')
  }
  return out.length > 0 ? out : ['']
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  for (const name of ['listd-logo-dark.png', 'listd-pro-green.png']) {
    try {
      const bytes = await readFile(join(process.cwd(), 'public', name))
      return await pdf.embedPng(bytes)
    } catch {
      // try next / fall through
    }
  }
  return null
}

async function embedPhotos(
  pdf: PDFDocument,
  photoBytes: Map<string, PhotoBytes | null>
): Promise<Map<string, PDFImage | null>> {
  const cache = new Map<string, PDFImage | null>()
  for (const [url, photo] of photoBytes) {
    if (!photo) {
      cache.set(url, null)
      continue
    }
    const ct = (photo.contentType ?? '').toLowerCase()
    const buf = photo.bytes
    let img: PDFImage | null = null
    try {
      if (ct.includes('png') || hasPngSignature(buf)) {
        img = await pdf.embedPng(buf)
      } else if (ct.includes('jpg') || ct.includes('jpeg') || hasJpgSignature(buf)) {
        img = await pdf.embedJpg(buf)
      } else {
        try {
          img = await pdf.embedPng(buf)
        } catch {
          try {
            img = await pdf.embedJpg(buf)
          } catch {
            img = null
          }
        }
      }
    } catch {
      img = null
    }
    cache.set(url, img)
  }
  return cache
}

/** Embed one optional image (the cover's property photo) through the same
 *  sniffing path as the inspection photos. Null in, null out; a corrupt or
 *  unsupported file yields null and the cover just omits it. */
async function embedSingle(
  pdf: PDFDocument,
  photo: PhotoBytes | null
): Promise<PDFImage | null> {
  if (!photo) return null
  const cache = await embedPhotos(pdf, new Map([['cover', photo]]))
  return cache.get('cover') ?? null
}

function hasPngSignature(b: Uint8Array): boolean {
  return (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  )
}

function hasJpgSignature(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
