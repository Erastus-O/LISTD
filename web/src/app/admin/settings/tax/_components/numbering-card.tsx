type NumberingRow = {
  year: number
  nextNumber: number
  updatedAt: string
}

/**
 * Read-only numbering preview. We deliberately don't ship a "reset"
 * affordance from the UI — the only legitimate reason to alter
 * `invoice_numbering` is direct DB intervention before any invoice has
 * been issued that year. HMRC record-keeping rules make accidental
 * resets actively dangerous.
 */
export function NumberingCard({ rows }: { rows: NumberingRow[] }) {
  const currentYear = new Date().getUTCFullYear()
  const currentRow = rows.find((r) => r.year === currentYear)
  const previewRef = `INV-${currentYear}-${(currentRow?.nextNumber ?? 1)
    .toString()
    .padStart(5, '0')}`

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/20 p-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Next allocation for {currentYear}
        </p>
        <p className="mt-1 font-mono text-lg text-foreground">{previewRef}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          No invoices issued yet: numbering rows are created on first use.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">
                  Next number
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Last update
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.year} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.year}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {r.nextNumber}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {new Date(r.updatedAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
