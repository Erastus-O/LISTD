'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Props = {
  jobId: string
}

type ExistingShare = {
  id: string
  label: string | null
  expiresAt: string
  maxViews: number | null
  viewCount: number
  lastViewedAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  createdAt: string
}

const TTL_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

/**
 * Inline share-link manager. Opens a dialog with:
 *   1. A form to issue a new link (label + TTL + optional view cap).
 *   2. A table of existing links for the job with revoke buttons.
 *
 * On successful issue we surface the raw `shareUrl` once — admin must
 * copy-paste it before closing because the URL is never shown again.
 * (Admins can revoke + reissue if they lose it.)
 */
export function ShareReportButton({ jobId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [existing, setExisting] = useState<ExistingShare[]>([])
  const [loadingList, setLoadingList] = useState(false)

  const [label, setLabel] = useState('')
  const [ttlDays, setTtlDays] = useState('7')
  const [maxViews, setMaxViews] = useState('')
  const [issuing, setIssuing] = useState(false)

  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/admin/reports/${jobId}/share`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { rows: ExistingShare[] }
      setExisting(json.rows ?? [])
    } catch {
      setExisting([])
    } finally {
      setLoadingList(false)
    }
  }

  async function issue() {
    if (issuing) return
    setIssuing(true)
    setFreshUrl(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/admin/reports/${jobId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || null,
          ttlDays: Number.parseInt(ttlDays, 10),
          maxViews:
            maxViews.trim() === ''
              ? null
              : Math.max(1, Number.parseInt(maxViews, 10)),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        shareUrl?: string
        expiresAt?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (!json.shareUrl) throw new Error('Server returned no URL')
      setFreshUrl(json.shareUrl)
      setLabel('')
      setMaxViews('')
      toast.success('Share link issued')
      void refresh()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Issue failed')
    } finally {
      setIssuing(false)
    }
  }

  async function revoke(tokenId: string) {
    if (
      !window.confirm(
        'Revoke this share link? Anyone holding it will get a "revoked" error.'
      )
    ) {
      return
    }
    try {
      const res = await fetch(`/api/admin/reports/share/${tokenId}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Link revoked')
      void refresh()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  async function copy() {
    if (!freshUrl) return
    try {
      await navigator.clipboard.writeText(freshUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed: please select the URL manually.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setFreshUrl(null)
      }}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-3.5 w-3.5" />
        Share
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Fresh-issue panel (shown once after issue) ─────────── */}
          {freshUrl && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
              <p className="font-medium text-emerald-800">Link created</p>
              <p className="mt-1 text-emerald-700">
                Copy this URL now: it&rsquo;s not shown again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  readOnly
                  value={freshUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 font-mono text-[11px]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={copy}
                  className="shrink-0 gap-1.5"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Issue form ────────────────────────────────────────── */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Issue new link
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="share-label" className="text-xs">
                  Label (optional)
                </Label>
                <Input
                  id="share-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder='e.g. "Insurer copy"'
                  maxLength={120}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Expires after</Label>
                <Select value={ttlDays} onValueChange={setTtlDays}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TTL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="share-cap" className="text-xs">
                  Max views (optional)
                </Label>
                <Input
                  id="share-cap"
                  type="number"
                  min="1"
                  max="1000"
                  value={maxViews}
                  onChange={(e) => setMaxViews(e.target.value)}
                  placeholder="Unlimited"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={issue}
                disabled={issuing}
                className="gap-1.5"
              >
                {issuing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Issue link
              </Button>
            </div>
          </div>

          {/* ── Existing-links table ─────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Existing links
            </h3>
            {loadingList ? (
              <p className="text-center text-xs text-muted-foreground">
                Loading…
              </p>
            ) : existing.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground">
                No links issued for this report yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {existing.map((s) => (
                  <ShareRow key={s.id} share={s} onRevoke={() => revoke(s.id)} />
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShareRow({
  share,
  onRevoke,
}: {
  share: ExistingShare
  onRevoke: () => void
}) {
  const expired = !share.revokedAt && new Date(share.expiresAt) <= new Date()
  const capped =
    !share.revokedAt &&
    share.maxViews !== null &&
    share.viewCount >= share.maxViews
  const isActive = !share.revokedAt && !expired && !capped

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-medium text-foreground">
            {share.label ?? '(no label)'}
          </p>
          {isActive ? (
            <Badge variant="default">Active</Badge>
          ) : share.revokedAt ? (
            <Badge variant="destructive">Revoked</Badge>
          ) : capped ? (
            <Badge variant="outline">View cap</Badge>
          ) : (
            <Badge variant="outline">Expired</Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Expires {new Date(share.expiresAt).toLocaleDateString('en-GB')} ·{' '}
          {share.viewCount} view{share.viewCount === 1 ? '' : 's'}
          {share.maxViews !== null ? ` / ${share.maxViews}` : ''}
          {share.lastViewedAt
            ? ` · last ${new Date(share.lastViewedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </p>
      </div>
      {isActive && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRevoke}
          aria-label="Revoke link"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}
