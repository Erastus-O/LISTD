import { z } from 'zod'

/**
 * Permissive UK phone validation. Accepts:
 *   - International: +44 7700 900000 / +447700900000
 *   - Domestic:      07700 900000 / 07700-900000 / 0207 946 0000
 *
 * Strips spaces, dashes, parentheses, then checks the digit prefix.
 *
 * We deliberately avoid `libphonenumber-js` here — adds ~200kb to the bundle
 * for what is, at signup time, a soft validation. Strict number validity is
 * re-checked when we actually dial via Twilio in Phase 2.
 */
export function isValidUkPhone(input: string): boolean {
  const cleaned = input.replace(/[\s\-().]/g, '')
  // +44 international: + then 44 then 9 or 10 digits (mobile=10, landline=9-10)
  if (/^\+44[1-9]\d{8,9}$/.test(cleaned)) return true
  // Domestic 0-prefix: 0 then 1/2/3/7/8 then 9 digits
  if (/^0[1-9]\d{8,9}$/.test(cleaned)) return true
  return false
}

/** Zod refinement wrapper for use in request schemas. */
export const ukPhone = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .max(20)
  .refine(isValidUkPhone, 'Enter a valid UK phone number')

/**
 * Normalize a UK phone number into E.164 (the `+44...` format Twilio
 * requires). Returns `null` if the input isn't a recognisable UK
 * number — caller's contract is "feed me `profiles.phone` strings,
 * tell me whether they're dialable".
 *
 * Strips spaces / dashes / parens; converts leading `0` to `+44`;
 * accepts pre-normalised `+44...` unchanged.
 */
export function toE164UkPhone(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = input.replace(/[\s\-().]/g, '')
  if (/^\+44[1-9]\d{8,9}$/.test(cleaned)) return cleaned
  if (/^0[1-9]\d{8,9}$/.test(cleaned)) return `+44${cleaned.slice(1)}`
  return null
}
