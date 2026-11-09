'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  Loader2,
  Mail,
  RotateCcw,
  Trash2,
  UserMinus,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import type { WorkerRow } from '@/lib/dashboard/client-workers'

/**
 * Workers list (Team tab). Per-row actions depend on the worker's
 * status:
 *   - active   → Resend invite · Remove
 *   - inactive → Reactivate
 * Plus a "View" link on every row to the per-worker drill-down page.
 */
export function WorkersGrid({ workers }: { workers: WorkerRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Worker</th>
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Jobs posted
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  Last active
                </th>
                <th className="px-4 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workers.map((w) => (
                <WorkerRowView key={w.userId} worker={w} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function WorkerRowView({ worker }: { worker: WorkerRow }) {
  const inactive = worker.status !== 'active'
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link
          href={`/client/team/${worker.userId}`}
          className="flex items-center gap-2 hover:underline"
        >
          <ProfileAvatar
            url={worker.avatarUrl}
            name={worker.fullName}
            emailFallback={worker.email}
            size="sm"
          />
          <span className="text-sm font-medium text-foreground">
            {worker.fullName ?? '(no name)'}
          </span>
        </Link>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {worker.email ?? '—'}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={inactive ? 'outline' : 'secondary'} className="capitalize">
          {worker.status}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right text-xs">{worker.jobsPosted}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {worker.lastActiveAt ? formatDate(worker.lastActiveAt) : '—'}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {inactive ? (
            <ReactivateWorkerButton
              userId={worker.userId}
              name={worker.fullName}
            />
          ) : (
            <>
              <ResendInviteButton
                userId={worker.userId}
                name={worker.fullName}
              />
              <RemoveWorkerButton
                userId={worker.userId}
                name={worker.fullName}
              />
            </>
          )}
          <Link
            href={`/client/team/${worker.userId}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="View worker"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  )
}

function RemoveWorkerButton({
  userId,
  name,
}: {
  userId: string
  name: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleRemove() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/client/workers/${userId}/remove`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Worker removed')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not remove worker', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        aria-label="Remove worker"
        title="Remove worker"
      >
        <UserMinus className="h-3.5 w-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove worker?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This deactivates{' '}
          <span className="font-medium text-foreground">
            {name ?? 'this worker'}
          </span>
          &apos;s access to the organisation. Their past jobs and reports
          remain visible to you. You can re-activate them later.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleRemove}
            disabled={pending}
            className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResendInviteButton({
  userId,
  name,
}: {
  userId: string
  name: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleResend() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/client/workers/${userId}/resend-invite`,
        { method: 'POST' }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setOpen(false)
      router.refresh()
      if (body?.emailDelivered === false) {
        // Password was rotated but the email didn't send — the worker can't
        // log in until it does, so flag it clearly for a retry.
        toast.error('Invite not sent', {
          description:
            'A new password was set, but the email could not be sent. Please try Resend invite again.',
        })
      } else {
        toast.success('Invite resent', {
          description: 'New temporary password sent by email.',
        })
      }
    } catch (err) {
      toast.error('Could not resend invite', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-8 w-8 text-muted-foreground hover:text-primary"
        aria-label="Resend invite"
        title="Resend invite"
      >
        <Mail className="h-3.5 w-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resend invite?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          We&apos;ll generate a new temporary password for{' '}
          <span className="font-medium text-foreground">
            {name ?? 'this worker'}
          </span>{' '}
          and email it to them. Their existing password stops working
          immediately: only the new one in the email will let them log in.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleResend}
            disabled={pending}
            className="gap-1.5"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Resend invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReactivateWorkerButton({
  userId,
  name,
}: {
  userId: string
  name: string | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleReactivate() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/client/workers/${userId}/reactivate`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(`Reactivated ${name ?? 'worker'}`)
      router.refresh()
    } catch (err) {
      toast.error('Could not reactivate', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={handleReactivate}
      disabled={pending}
      className="h-8 gap-1 text-xs"
      title="Reactivate worker"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RotateCcw className="h-3 w-3" />
      )}
      Reactivate
    </Button>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
