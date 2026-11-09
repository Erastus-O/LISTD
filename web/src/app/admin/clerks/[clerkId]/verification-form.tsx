'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  clerkId: string
  status: string
  previousReason: string
}

/**
 * Right-rail action form for the admin verification panel. Lets an admin
 * approve or reject a clerk's submission with an optional reason note.
 */
export function ClerkVerificationForm({
  clerkId,
  status,
  previousReason,
}: Props) {
  const router = useRouter()
  const [reason, setReason] = useState(previousReason)
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null)

  async function submit(action: 'approve' | 'reject') {
    if (action === 'reject' && !reason.trim()) {
      toast.error('Reason required', {
        description: 'Tell the clerk what to fix before resubmitting.',
      })
      return
    }
    setSubmitting(action)
    try {
      const res = await fetch(`/api/admin/clerks/${clerkId}/verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: action === 'reject' ? reason.trim() : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(action === 'approve' ? 'Clerk verified' : 'Clerk rejected', {
        description: 'Email sent.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSubmitting(null)
    }
  }

  const inFlight = submitting !== null
  const isPending = status === 'pending_verification'
  const isVerified = status === 'verified'

  return (
    <Card className="h-fit">
      <CardContent className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Decision</h2>
        <p className="text-sm text-muted-foreground">
          {isPending
            ? 'Approve to grant marketplace access. Reject with a reason if any document needs to be re-uploaded.'
            : isVerified
              ? 'This clerk is verified. You can revoke access by rejecting with a reason.'
              : 'No active submission.'}
        </p>

        <div>
          <Label htmlFor="reason">Reason (required to reject)</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. DBS certificate is expired: please upload an in-date one."
            rows={4}
            className="mt-1.5"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => submit('approve')}
            disabled={inFlight || isVerified}
            className="w-full"
          >
            {submitting === 'approve' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isVerified ? (
              'Already verified'
            ) : (
              'Approve & verify'
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit('reject')}
            disabled={inFlight}
            className="w-full"
          >
            {submitting === 'reject' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isVerified ? (
              'Revoke verification'
            ) : (
              'Reject & request changes'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
