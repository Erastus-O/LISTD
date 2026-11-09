export type HmoInvoiceLine = { label: string; amount: number }

/**
 * Split a cleaning job's total across N numbered bedrooms + one communal-areas
 * line, for HMO single-tenancy billing ("separate invoice per numbered bedroom
 * and communal areas"). Even split; any rounding remainder lands on the
 * communal line so the parts sum back to exactly `total`.
 *
 * Returns one entry per bedroom plus a final "Communal areas" entry. Used to
 * seed the admin's per-bedroom invoice generator — the resulting invoices are
 * created as drafts, so the admin can fine-tune individual amounts afterwards.
 */
export function computeHmoCleaningSplit(
  total: number,
  bedrooms: number
): HmoInvoiceLine[] {
  const beds = Math.max(0, Math.floor(bedrooms))
  const cents = Math.round(total * 100)
  if (cents <= 0) return []
  const parts = beds + 1 // bedrooms + 1 communal line
  const base = Math.floor(cents / parts)

  const lines: HmoInvoiceLine[] = []
  for (let i = 1; i <= beds; i++) {
    lines.push({ label: `Bedroom ${i}`, amount: base / 100 })
  }
  // Communal carries its base share + the rounding remainder.
  const communalCents = cents - base * beds
  lines.push({ label: 'Communal areas', amount: communalCents / 100 })
  return lines
}
