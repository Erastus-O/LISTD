import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  /** Zero-indexed current page. */
  page: number
  /** Total pages (>= 1). */
  totalPages: number
  /** Build the href for a given zero-indexed page. */
  href: (page: number) => string
}

/**
 * Shared prev/next pager used by the admin list pages (jobs, disputes,
 * reports, quality review, etc). Renders nothing when there's only one page.
 *
 * Hoisted so individual list pages don't duplicate ~30 lines of
 * `<Link>` / disabled-state markup each.
 */
export function Pager({ page, totalPages, href }: Props) {
  if (totalPages <= 1) return null
  const hasPrev = page > 0
  const hasNext = page + 1 < totalPages
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page + 1} of {totalPages}
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link
            href={href(page - 1)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Link>
        ) : (
          <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            href={href(page + 1)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  )
}
