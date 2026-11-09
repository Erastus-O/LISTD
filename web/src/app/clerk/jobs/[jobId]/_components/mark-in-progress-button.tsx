'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Props = {
  jobId: string
}

/**
 * Single-click "Mark as In Progress" — clerk's first action on-site.
 * POSTs to [/api/clerk/jobs/[id]/start](../../../../api/clerk/jobs/[jobId]/start/route.ts)
 * which writes the `job_lifecycle/job.in_progress` audit row.
 *
 * On 409 (state changed concurrently — admin status-override, double-click)
 * refreshes the page so the action card updates correctly.
 */
export function MarkInProgressButton({ jobId }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handle() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/clerk/jobs/${jobId}/start`, {
        method: 'POST',
      })
      if (res.status === 409) {
        toast.error('Status changed', {
          description: 'Refreshing: the job state moved on.',
        })
        router.refresh()
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Marked as in progress')
      router.refresh()
    } catch (err) {
      toast.error('Could not update status', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      onClick={handle}
      disabled={pending}
      className="gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      Mark as In Progress
    </Button>
  )
}
