import { FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireSession } from '@/lib/dal'
import {
  groupReportsIntoFolders,
  loadClientReports,
  parseReportsFilter,
} from '@/lib/dashboard/client-reports'
import { ReportsFilterBar } from './_components/reports-filter-bar'
import { ReportsTree } from './_components/reports-tree'

export const metadata = { title: 'Client · Reports' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Client reports — folder tree (property → service type → date) with
 * URL-driven filters + per-report PDF download (M1 #13 / S5a of the
 * Lovable port roadmap).
 *
 * **Out of scope this round (S5b):** shareable-link generator with optional
 * expiry. Needs a token-table extension; deferred so M1 #13 can land
 * incrementally.
 */
export default async function ClientReportsPage({ searchParams }: Props) {
  const session = await requireSession()
  const sp = await searchParams
  const filter = parseReportsFilter(sp)

  const { rows, total, propertyOptions } = await loadClientReports(
    session.userId,
    filter
  )
  const folders = groupReportsIntoFolders(rows)
  const hasFilters = Object.keys(filter).length > 0

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} {total === 1 ? 'report' : 'reports'}
          {hasFilters ? ' matching the current filters' : ' delivered to date'}
          {rows.length < total ? ` · showing the latest ${rows.length}` : ''}
        </p>
      </div>

      {propertyOptions.length === 0 && !hasFilters ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              No reports yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reports will appear here once your inspections are completed
              and signed off.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <ReportsFilterBar propertyOptions={propertyOptions} />
          <ReportsTree folders={folders} />
        </>
      )}
    </div>
  )
}
