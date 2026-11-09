import { describe, expect, it } from 'vitest'
import { looksLikePngDataUrl } from './store'

/**
 * The guard on the sign endpoints' `signatureImage` field. A signature is
 * evidence, so the shape of what we accept is worth pinning down: the
 * bytes are validated properly in `storeSignatureImage` (magic bytes,
 * size cap), but nothing malformed should get that far.
 */
describe('looksLikePngDataUrl', () => {
  const VALID =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('accepts a PNG data URL', () => {
    expect(looksLikePngDataUrl(VALID)).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(looksLikePngDataUrl(`\n  ${VALID}  `)).toBe(true)
  })

  it.each([
    ['a JPEG data URL', 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='],
    ['an SVG data URL', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['a remote URL', 'https://example.test/signature.png'],
    ['a bare base64 blob', 'iVBORw0KGgoAAAANSUhEUg=='],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(looksLikePngDataUrl(value)).toBe(false)
  })

  it('rejects a payload smuggling markup past the prefix', () => {
    // Base64 has a fixed alphabet; anything outside it means the string
    // isn't what the prefix claims. SVG in particular would be an XSS
    // vector if a signature were ever rendered inline rather than
    // embedded in a PDF.
    expect(
      looksLikePngDataUrl('data:image/png;base64,<script>alert(1)</script>')
    ).toBe(false)
  })
})
