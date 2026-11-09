'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FolderOpen,
  MapPin,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { serviceLabel } from '@/lib/pricing-matrix'
import type { ReportFolder, ReportRow } from '@/lib/dashboard/client-reports'

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  submitted: 'default',
  reviewed: 'secondary',
  signed: 'secondary',
  completed: 'secondary',
  paid: 'secondary',
}

type Props = {
  folders: ReportFolder[]
  /** Auto-open the first folder on initial render. */
  autoOpenFirst?: boolean
}

/**
 * Folder tree (M1 #13): property → inspection type → individual reports.
 * Collapse state lives client-side. Within each type group, reports are
 * sorted by `deliveredAt` desc — server-side ordering already does this so
 * the UI just renders.
 */
export function ReportsTree({ folders, autoOpenFirst = true }: Props) {
  const [openProperty, setOpenProperty] = useState<Set<string>>(() => {
    if (!autoOpenFirst || folders.length === 0) return new Set()
    return new Set([folders[0].propertyId])
  })

  function toggle(propertyId: string) {
    setOpenProperty((prev) => {
      const next = new Set(prev)
      if (next.has(propertyId)) next.delete(propertyId)
      else next.add(propertyId)
      return next
    })
  }

  if (folders.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No reports match these filters.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {folders.map((folder) => {
        const isOpen = openProperty.has(folder.propertyId)
        return (
          <div key={folder.propertyId}>
            <button
              type="button"
              onClick={() => toggle(folder.propertyId)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors',
                isOpen
                  ? 'border-primary/30 bg-card'
                  : 'bg-card hover:bg-muted/50'
              )}
            >
              <FolderOpen
                className={cn(
                  'h-5 w-5 shrink-0',
                  isOpen ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {folder.address}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {folder.cityPostcode || '—'}
                </p>
              </div>
              <Badge variant="secondary" className="text-xs">
                {folder.total} report{folder.total === 1 ? '' : 's'}
              </Badge>
              <ChevronRight
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </button>

            {isOpen && (
              <div className="ml-8 mt-2 space-y-4">
                {folder.groups.map((group) => (
                  <div key={group.inspectionType}>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {serviceLabel(group.inspectionType)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {group.reports.length} report
                        {group.reports.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.reports.map((r) => (
                        <ReportCard key={r.jobId} report={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ReportCard({ report }: { report: ReportRow }) {
  const isAccepted = report.clientReportAccepted
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 flex-wrap">
            <Badge
              variant={STATUS_TONE[report.status] ?? 'outline'}
              className="text-[10px] capitalize"
            >
              {report.status}
            </Badge>
            {isAccepted && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Signed off
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">
            {serviceLabel(report.inspectionType)}{' '}
            · {formatDate(report.scheduledDate)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {report.deliveredAt ? (
              <>
                <CalendarDays className="h-3 w-3" />
                Delivered {formatDateTime(report.deliveredAt)}
              </>
            ) : (
              <>
                <Clock className="h-3 w-3" />
                Awaiting delivery
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {report.reportUrl && (
            <a
              href={`/api/reports/${report.jobId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs hover:bg-muted"
              title="Download PDF"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </a>
          )}
          <Link
            href={`/client/reports/${report.jobId}`}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
