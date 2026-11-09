'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Export CSV button — opens a modal asking for an optional date range
 * (issue_date between from/to) and then triggers a same-origin GET that
 * the browser handles as a download via the `attachment` Content-
 * Disposition on the route handler.
 *
 * Defaults to "issued/sent/paid/overdue" on the server — draft and void
 * are excluded so the export plugs straight into HMRC bridging software.
 * Admins who need everything can hit the URL directly with `?status=all`
 * comma-list.
 */
export function ExportCsvButton() {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  function downloadHref(): string {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return qs ? `/api/admin/invoices/export?${qs}` : '/api/admin/invoices/export'
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Download className="h-4 w-4" />
        Export CSV
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export invoices to CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            HMRC bridging-software compatible. Excludes drafts and voided
            invoices by default. Capped at 10&nbsp;000 rows per file :
            narrow the date range for larger histories.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="csv-from" className="text-xs">
                Issued from
              </Label>
              <Input
                id="csv-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="csv-to" className="text-xs">
                Issued to
              </Label>
              <Input
                id="csv-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button asChild>
            <a href={downloadHref()} onClick={() => setOpen(false)}>
              Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
