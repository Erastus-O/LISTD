import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

/**
 * Server-side invoice PDF renderer. Layout:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [LISTD logo]            Company name (right)          │
 *   │                         Address                       │
 *   │                         VAT number / contact          │
 *   │                                                       │
 *   │  INVOICE                                              │
 *   │  Ref: INV-2026-00012        Issue date · Due date     │
 *   │                                                       │
 *   │  Bill to                                              │
 *   │  ─────                                                │
 *   │  Recipient name                                       │
 *   │  Org name                                             │
 *   │                                                       │
 *   │  ┌──────────────┬─────┬──────────┬─────┬──────────┐  │
 *   │  │ Description  │ Qty │ Unit £   │ Tax │  Line £  │  │
 *   │  ├──────────────┼─────┼──────────┼─────┼──────────┤  │
 *   │  │ …            │ …   │ …        │ …   │       …  │  │
 *   │  └──────────────┴─────┴──────────┴─────┴──────────┘  │
 *   │                                                       │
 *   │                              Subtotal:     £nnn.nn    │
 *   │                              VAT (20%):     £nn.nn    │
 *   │                              ─────────────────────    │
 *   │                              Total:        £nnn.nn    │
 *   │                                                       │
 *   │  Notes / payment terms                                │
 *   │                                                       │
 *   │  Bank transfer details (footer)                       │
 *   └──────────────────────────────────────────────────────┘
 *
 * Logo path: `public/listd-logo-dark.png` (read from the file system at
 * render time — server-only module, no bundling concerns).
 */

export type InvoicePdfRecipient = {
  fullName: string | null
  companyName: string | null
  email: string | null
}

export type InvoicePdfCompanyInfo = {
  name: string
  addressLines: string[]
  contact: string | null
  vatNumber: string | null
}

export type InvoicePdfLine = {
  description: string
  quantity: number
  unitPrice: number
  taxRateLabel: string
  taxRate: number
  lineSubtotal: number
  lineTax: number
}

export type InvoicePdfTotals = {
  subtotal: number
  taxSummary: Array<{ label: string; base: number; tax: number; rate: number }>
  total: number
  currency: string
}

export type InvoicePdfInputs = {
  reference: string
  issueDate: string
  dueDate: string
  recipient: InvoicePdfRecipient
  company: InvoicePdfCompanyInfo
  lines: InvoicePdfLine[]
  totals: InvoicePdfTotals
  notes: string | null
  /** Optional payment instructions (e.g. bank details) rendered in the
   *  footer block. */
  paymentInstructions: string | null
  /** Document discriminator. `credit_note` renders the title as
   *  "CREDIT NOTE" and prints the parent invoice reference below the
   *  current reference. Defaults to `'invoice'` for back-compat. */
  kind?: 'invoice' | 'credit_note'
  /** Parent invoice reference (only used when `kind === 'credit_note'`). */
  parentReference?: string | null
}

const PAGE_W = 595.28 // A4 portrait
const PAGE_H = 841.89
const MARGIN = 50

export async function renderInvoicePdf(
  inputs: InvoicePdfInputs
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const helvItalic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  const page = pdf.addPage([PAGE_W, PAGE_H])
  const logo = await embedLogo(pdf)

  let y = PAGE_H - MARGIN

  // ── Header: logo (left) + company info (right) ───────────────────
  if (logo) {
    const targetH = 36
    const ratio = targetH / logo.height
    page.drawImage(logo, {
      x: MARGIN,
      y: y - targetH,
      width: logo.width * ratio,
      height: targetH,
    })
  }

  drawTextBlock(
    page,
    [
      { text: inputs.company.name, font: helvBold, size: 11 },
      ...inputs.company.addressLines.map((line) => ({
        text: line,
        font: helv,
        size: 9,
        color: rgb(0.4, 0.4, 0.4),
      })),
      ...(inputs.company.contact
        ? [
            {
              text: inputs.company.contact,
              font: helv,
              size: 9,
              color: rgb(0.4, 0.4, 0.4),
            },
          ]
        : []),
      ...(inputs.company.vatNumber
        ? [
            {
              text: `VAT: ${inputs.company.vatNumber}`,
              font: helv,
              size: 9,
              color: rgb(0.4, 0.4, 0.4),
            },
          ]
        : []),
    ],
    PAGE_W - MARGIN,
    y,
    'right'
  )

  y -= 70

  // ── Title block — switches on kind ───────────────────────────────
  const isCreditNote = inputs.kind === 'credit_note'
  page.drawText(isCreditNote ? 'CREDIT NOTE' : 'INVOICE', {
    x: MARGIN,
    y: y - 16,
    size: 26,
    font: helvBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  page.drawText(inputs.reference, {
    x: MARGIN,
    y: y - 36,
    size: 11,
    font: helv,
    color: rgb(0.4, 0.4, 0.4),
  })
  if (isCreditNote && inputs.parentReference) {
    page.drawText(`Offsets: ${inputs.parentReference}`, {
      x: MARGIN,
      y: y - 52,
      size: 9,
      font: helvItalic,
      color: rgb(0.45, 0.45, 0.45),
    })
  }

  // Dates: right-aligned, two rows
  drawKeyValueRight(page, helv, helvBold, 'Issue date', inputs.issueDate, PAGE_W - MARGIN, y - 12)
  drawKeyValueRight(page, helv, helvBold, 'Due date', inputs.dueDate, PAGE_W - MARGIN, y - 32)

  y -= 60

  // ── Bill-to block ────────────────────────────────────────────────
  page.drawText('Bill to', {
    x: MARGIN,
    y: y,
    size: 9,
    font: helvBold,
    color: rgb(0.5, 0.5, 0.5),
  })
  y -= 14
  const recipientLines = [
    inputs.recipient.companyName,
    inputs.recipient.fullName,
    inputs.recipient.email,
  ].filter((line): line is string => Boolean(line))
  for (const line of recipientLines) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 10,
      font: helv,
      color: rgb(0.15, 0.15, 0.15),
    })
    y -= 13
  }
  y -= 14

  // ── Line items table ────────────────────────────────────────────
  const tableX = MARGIN
  const tableW = PAGE_W - MARGIN * 2
  // Column anchors (right edges for numeric, left for description).
  const COL_DESC_X = tableX
  const COL_QTY_X = tableX + tableW * 0.55
  const COL_UNIT_X = tableX + tableW * 0.7
  const COL_TAX_X = tableX + tableW * 0.85
  const COL_LINE_X = tableX + tableW

  // Header row
  page.drawRectangle({
    x: tableX,
    y: y - 22,
    width: tableW,
    height: 22,
    color: rgb(0.96, 0.97, 0.98),
  })
  drawColumnHeader(page, helvBold, 'Description', COL_DESC_X, y - 14, 'left')
  drawColumnHeader(page, helvBold, 'Qty', COL_QTY_X, y - 14, 'right')
  drawColumnHeader(page, helvBold, 'Unit', COL_UNIT_X, y - 14, 'right')
  drawColumnHeader(page, helvBold, 'Tax', COL_TAX_X, y - 14, 'right')
  drawColumnHeader(page, helvBold, 'Amount', COL_LINE_X, y - 14, 'right')
  y -= 26

  // Rows
  for (const line of inputs.lines) {
    if (y < MARGIN + 200) {
      // Page break — naive: start a new page, redraw nothing of the
      // header for now (invoices longer than one page are unusual; can
      // refine later if it becomes a real case).
      break
    }
    drawText(
      page,
      truncate(line.description, 60),
      COL_DESC_X,
      y,
      9,
      helv,
      'left'
    )
    drawText(page, formatQty(line.quantity), COL_QTY_X, y, 9, helv, 'right')
    drawText(
      page,
      formatMoney(line.unitPrice, inputs.totals.currency),
      COL_UNIT_X,
      y,
      9,
      helv,
      'right'
    )
    drawText(page, line.taxRateLabel, COL_TAX_X, y, 9, helv, 'right')
    drawText(
      page,
      formatMoney(line.lineSubtotal, inputs.totals.currency),
      COL_LINE_X,
      y,
      9,
      helv,
      'right'
    )
    y -= 16
    // Subtle divider between rows
    page.drawLine({
      start: { x: tableX, y: y + 6 },
      end: { x: tableX + tableW, y: y + 6 },
      thickness: 0.4,
      color: rgb(0.9, 0.9, 0.9),
    })
  }

  y -= 8

  // ── Totals block (right-aligned) ────────────────────────────────
  const totalsRight = PAGE_W - MARGIN
  drawTotalsRow(
    page,
    helv,
    'Subtotal',
    formatMoney(inputs.totals.subtotal, inputs.totals.currency),
    totalsRight,
    y
  )
  y -= 16
  for (const taxRow of inputs.totals.taxSummary) {
    if (taxRow.base === 0) continue
    drawTotalsRow(
      page,
      helv,
      `${taxRow.label} (${(taxRow.rate * 100).toFixed(0)}% on ${formatMoney(taxRow.base, inputs.totals.currency)})`,
      formatMoney(taxRow.tax, inputs.totals.currency),
      totalsRight,
      y
    )
    y -= 14
  }
  page.drawLine({
    start: { x: totalsRight - 200, y: y - 2 },
    end: { x: totalsRight, y: y - 2 },
    thickness: 0.6,
    color: rgb(0.7, 0.7, 0.7),
  })
  y -= 16
  drawTotalsRow(
    page,
    helvBold,
    'Total',
    formatMoney(inputs.totals.total, inputs.totals.currency),
    totalsRight,
    y,
    12
  )

  y -= 32

  // ── Notes ───────────────────────────────────────────────────────
  if (inputs.notes) {
    page.drawText('Notes', {
      x: MARGIN,
      y,
      size: 9,
      font: helvBold,
      color: rgb(0.4, 0.4, 0.4),
    })
    y -= 14
    const wrapped = wrapText(inputs.notes, helv, 9, PAGE_W - MARGIN * 2)
    for (const line of wrapped) {
      if (y < MARGIN + 60) break
      page.drawText(line, {
        x: MARGIN,
        y,
        size: 9,
        font: helv,
        color: rgb(0.2, 0.2, 0.2),
      })
      y -= 12
    }
    y -= 8
  }

  // ── Payment instructions footer ─────────────────────────────────
  if (inputs.paymentInstructions) {
    page.drawRectangle({
      x: MARGIN,
      y: MARGIN,
      width: PAGE_W - MARGIN * 2,
      height: 60,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 0.6,
    })
    page.drawText('Payment instructions', {
      x: MARGIN + 12,
      y: MARGIN + 44,
      size: 9,
      font: helvBold,
      color: rgb(0.3, 0.3, 0.3),
    })
    const wrapped = wrapText(
      inputs.paymentInstructions,
      helv,
      9,
      PAGE_W - MARGIN * 2 - 24
    )
    let footerY = MARGIN + 28
    for (const line of wrapped.slice(0, 2)) {
      page.drawText(line, {
        x: MARGIN + 12,
        y: footerY,
        size: 9,
        font: helv,
        color: rgb(0.3, 0.3, 0.3),
      })
      footerY -= 12
    }
  }

  // Auto-generated footnote at the very bottom
  page.drawText(
    `Generated ${new Date().toUTCString()} · LISTD Pro`,
    {
      x: MARGIN,
      y: MARGIN - 18,
      size: 7,
      font: helvItalic,
      color: rgb(0.6, 0.6, 0.6),
    }
  )

  return pdf.save()
}

// ─── Helpers ──────────────────────────────────────────────────────

async function embedLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    const buf = await fs.readFile(
      path.join(process.cwd(), 'public', 'listd-logo-dark.png')
    )
    return pdf.embedPng(buf)
  } catch {
    return null
  }
}

function drawTextBlock(
  page: PDFPage,
  rows: Array<{
    text: string
    font: PDFFont
    size: number
    color?: ReturnType<typeof rgb>
  }>,
  anchorX: number,
  startY: number,
  align: 'left' | 'right'
) {
  let y = startY
  for (const row of rows) {
    const textWidth = row.font.widthOfTextAtSize(row.text, row.size)
    const x = align === 'right' ? anchorX - textWidth : anchorX
    page.drawText(row.text, {
      x,
      y,
      size: row.size,
      font: row.font,
      color: row.color ?? rgb(0.1, 0.1, 0.1),
    })
    y -= row.size + 3
  }
}

function drawKeyValueRight(
  page: PDFPage,
  helv: PDFFont,
  helvBold: PDFFont,
  label: string,
  value: string,
  anchorX: number,
  y: number
) {
  const valueWidth = helvBold.widthOfTextAtSize(value, 11)
  page.drawText(value, {
    x: anchorX - valueWidth,
    y,
    size: 11,
    font: helvBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  const labelWidth = helv.widthOfTextAtSize(label, 9)
  page.drawText(label, {
    x: anchorX - valueWidth - 10 - labelWidth,
    y,
    size: 9,
    font: helv,
    color: rgb(0.5, 0.5, 0.5),
  })
}

function drawColumnHeader(
  page: PDFPage,
  font: PDFFont,
  text: string,
  anchorX: number,
  y: number,
  align: 'left' | 'right'
) {
  const w = font.widthOfTextAtSize(text, 9)
  page.drawText(text, {
    x: align === 'right' ? anchorX - w : anchorX,
    y,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.3),
  })
}

function drawText(
  page: PDFPage,
  text: string,
  anchorX: number,
  y: number,
  size: number,
  font: PDFFont,
  align: 'left' | 'right'
) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, {
    x: align === 'right' ? anchorX - w : anchorX,
    y,
    size,
    font,
    color: rgb(0.15, 0.15, 0.15),
  })
}

function drawTotalsRow(
  page: PDFPage,
  font: PDFFont,
  label: string,
  value: string,
  anchorX: number,
  y: number,
  size = 10
) {
  const valW = font.widthOfTextAtSize(value, size)
  page.drawText(value, {
    x: anchorX - valW,
    y,
    size,
    font,
    color: rgb(0.1, 0.1, 0.1),
  })
  const labelW = font.widthOfTextAtSize(label, size)
  page.drawText(label, {
    x: anchorX - valW - 12 - labelW,
    y,
    size,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
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
  return out
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
