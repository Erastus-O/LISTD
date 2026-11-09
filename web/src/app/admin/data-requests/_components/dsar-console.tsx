'use client'

import { useState } from 'react'
import { Download, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type EraseSummary = {
  subject: { userId: string | null; email: string | null }
  anonymised: Record<string, number>
  storageDeleted: string[]
  retained: string[]
  errors: string[]
}

/**
 * Admin console for GDPR data-subject requests. Search a subject by user id
 * and/or email, then Export (downloads a JSON bundle) or Erase (anonymise +
 * delete sensitive storage, behind a confirm dialog). Talks to
 * /api/admin/dsar/{export,erase}.
 */
export function DsarConsole() {
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [eraseOpen, setEraseOpen] = useState(false)
  const [deletePhotos, setDeletePhotos] = useState(false)
  const [summary, setSummary] = useState<EraseSummary | null>(null)

  const hasSubject = Boolean(userId.trim() || email.trim())

  function query() {
    const p = new URLSearchParams()
    if (userId.trim()) p.set('userId', userId.trim())
    if (email.trim()) p.set('email', email.trim())
    return p.toString()
  }

  function exportData() {
    if (!hasSubject) return
    // The route sets Content-Disposition: attachment, so this downloads the
    // JSON without navigating away.
    window.location.href = `/api/admin/dsar/export?${query()}`
    toast.message('Preparing export…', { description: 'Your download will start shortly.' })
  }

  async function erase() {
    if (!hasSubject || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/dsar/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(userId.trim() ? { userId: userId.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          confirm: true,
          deletePhotos,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setSummary(body.summary as EraseSummary)
      setEraseOpen(false)
      toast.success('Erasure complete')
    } catch (err) {
      toast.error('Erasure failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dsar-user">User ID (client / clerk / cleaner)</Label>
              <Input
                id="dsar-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="uuid"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="dsar-email">Email (tenant / lead / user)</Label>
              <Input
                id="dsar-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                className="mt-1.5"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Provide a user id (platform user) and/or an email (catches tenants
            and email-only records). Use both for the most complete result.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={exportData} disabled={!hasSubject} className="gap-1.5">
              <Download className="h-4 w-4" />
              Export data (SAR)
            </Button>
            <Button
              variant="destructive"
              onClick={() => setEraseOpen(true)}
              disabled={!hasSubject}
              className="gap-1.5"
            >
              <ShieldAlert className="h-4 w-4" />
              Erase data…
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardContent className="space-y-3 p-6 text-sm">
            <h2 className="text-base font-semibold">Erasure summary</h2>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Anonymised
              </p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(summary.anonymised).map(([k, n]) => (
                  <li key={k} className="text-xs">
                    {k}: <span className="font-medium">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs">
              Storage objects deleted:{' '}
              <span className="font-medium">{summary.storageDeleted.length}</span>
            </p>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Retained (legal basis)
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {summary.retained.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            {summary.errors.length > 0 && (
              <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <p className="font-medium">Errors</p>
                <ul className="mt-1 list-disc pl-4">
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Erase data subject?
            </DialogTitle>
            <DialogDescription>
              This is <strong>irreversible</strong>. It anonymises the subject&rsquo;s
              personal data, deletes their sensitive documents (ID, DBS,
              signatures, avatar), and anonymises their login. Financial and
              audit records are retained (de-identified) under the legal-
              obligation basis.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="checkbox"
              checked={deletePhotos}
              onChange={(e) => setDeletePhotos(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also delete inspection <strong>photos</strong> for this subject&rsquo;s
              jobs (leave off if photos form part of a report retained under a
              legal basis).
            </span>
          </label>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEraseOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={erase} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Erase permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
