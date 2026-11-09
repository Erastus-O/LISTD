'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Inbox,
  Link2,
  Mail,
  Phone,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export type ApplicationRow = {
  id: string
  vacancyTitle: string
  fullName: string
  email: string
  phone: string | null
  linkedinUrl: string | null
  coverNote: string | null
  /** Short-lived signed URL for the CV (minted server-side per page load). */
  cvUrl: string | null
  status: string
  createdAt: string
}

const STATUSES = ['new', 'reviewed', 'shortlisted', 'rejected'] as const

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-primary/10 text-primary',
  reviewed: 'bg-muted text-muted-foreground',
  shortlisted: 'bg-emerald-500/10 text-emerald-600',
  rejected: 'bg-destructive/10 text-destructive',
}

/**
 * Admin review list for LISTD-hosted job applications. Status changes PATCH
 * per row; CVs open via the signed URLs the server minted (1 h).
 */
export function ApplicationsList({
  initialApplications,
}: {
  initialApplications: ApplicationRow[]
}) {
  const [apps, setApps] = useState(initialApplications)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function setStatus(id: string, status: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/careers/applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setApps((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a))
      )
    } catch (err) {
      toast.error('Could not update status', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusyId(null)
    }
  }

  if (apps.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">
            No applications yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Applications submitted through the LISTD careers pages appear
            here, with CVs attached.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {apps.map((a) => {
        const expanded = expandedId === a.id
        return (
          <Card key={a.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {a.fullName}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {a.vacancyTitle}
                    </Badge>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[a.status] ?? STATUS_STYLES.new}`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <a
                      href={`mailto:${a.email}`}
                      className="inline-flex items-center gap-1 hover:text-primary"
                    >
                      <Mail className="h-3 w-3" />
                      {a.email}
                    </a>
                    {a.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {a.phone}
                      </span>
                    )}
                    {a.linkedinUrl && (
                      <a
                        href={a.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Link2 className="h-3 w-3" />
                        LinkedIn
                      </a>
                    )}
                    <span>
                      {new Date(a.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.cvUrl && (
                    <a
                      href={a.cvUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/40"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      CV
                    </a>
                  )}
                  <select
                    value={a.status}
                    disabled={busyId === a.id}
                    onChange={(e) => setStatus(a.id, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs capitalize focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s} className="capitalize">
                        {s}
                      </option>
                    ))}
                  </select>
                  {a.coverNote && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : a.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Note
                      {expanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              {expanded && a.coverNote && (
                <p className="mt-3 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                  {a.coverNote}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
