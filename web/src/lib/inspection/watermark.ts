import 'server-only'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

/**
 * Stamp a diagonal "provisional" watermark across every page of an existing
 * PDF and return the new bytes.
 *
 * This is a cheap overlay (load → draw → save) — it does NOT re-embed photos
 * or re-render content, so producing the provisional copy costs a fraction of
 * a full render. The clerk inspection submit applies this to the rendered
 * report so any pre-approval copy is unmistakably marked; the clean official
 * is produced later at quality-review approval.
 */
export async function applyWatermark(
  pdfBytes: Uint8Array,
  text = 'PROVISIONAL COPY',
  subtext = 'Subject to quality review'
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const color = rgb(0.78, 0.12, 0.12)
  const angle = 45
  const rad = (angle * Math.PI) / 180

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const cx = width / 2
    const size = Math.min(46, (width / font.widthOfTextAtSize(text, 46)) * 42)
    const tw = font.widthOfTextAtSize(text, size)
    const subW = font.widthOfTextAtSize(subtext, 12)

    // Three diagonal stamps spread down the page.
    for (const frac of [0.22, 0.5, 0.78]) {
      const cy = height * frac
      page.drawText(text, {
        x: cx - (tw / 2) * Math.cos(rad),
        y: cy - (tw / 2) * Math.sin(rad),
        size,
        font,
        color,
        opacity: 0.13,
        rotate: degrees(angle),
      })
    }

    // Sub-line beneath the centre stamp.
    page.drawText(subtext, {
      x: cx - (subW / 2) * Math.cos(rad),
      y: height * 0.5 - 26 - (subW / 2) * Math.sin(rad),
      size: 12,
      font,
      color,
      opacity: 0.13,
      rotate: degrees(angle),
    })
  }

  return doc.save()
}
