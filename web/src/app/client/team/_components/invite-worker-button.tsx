'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Owner-only invite dialog. Posts to `/api/client/workers/invite` which
 * creates the auth user, sets a temp password, sends the credentials
 * email, and writes the org_membership row.
 */
export function InviteWorkerButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)

  function reset() {
    setFullName('')
    setEmail('')
  }

  async function handleSubmit() {
    if (pending) return
    if (!fullName.trim() || !email.trim()) {
      toast.error('Name and email are required')
      return
    }
    setPending(true)
    const invitedEmail = email.trim()
    try {
      const res = await fetch('/api/client/workers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: invitedEmail.toLowerCase(),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      // The worker is created — close the modal and confirm, regardless of
      // whether the credentials email landed (we surface that separately).
      setOpen(false)
      reset()
      router.refresh()
      if (body?.emailDelivered === false) {
        toast.success('Worker invited', {
          description: `${invitedEmail} was added, but their login email couldn't be sent. Use "Resend invite" to try again.`,
        })
      } else {
        toast.success('Worker invited', {
          description: `${invitedEmail} will receive login details by email.`,
        })
      }
    } catch (err) {
      toast.error('Could not invite worker', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          Invite worker
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a worker</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            We&apos;ll create their account and email them a temporary
            password. They&apos;ll be asked to set a new one on first login.
          </p>
          <div>
            <Label htmlFor="worker-name" className="text-xs">
              Full name
            </Label>
            <Input
              id="worker-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              className="mt-1"
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <Label htmlFor="worker-email" className="text-xs">
              Email
            </Label>
            <Input
              id="worker-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className="mt-1"
              placeholder="jane@example.co.uk"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !fullName.trim() || !email.trim()}
            className="gap-1.5"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
