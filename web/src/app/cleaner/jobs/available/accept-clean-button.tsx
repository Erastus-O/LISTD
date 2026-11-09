'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { arrivalTimeOptionsForSlot } from '@/lib/scheduling/exact-time'

/**
 * Accept flow for cleaning jobs. Accepting commits the cleaner to an
 * arrival time within the client's slot — it becomes `jobs.scheduled_at`,
 * driving the 2-hour reminder and the missed check-in alarm (framework
 * §12). Hence the small dialog rather than a bare one-tap button.
 */
export function AcceptCleanButton({
  jobId,
  timeSlot,
}: {
  jobId: string
  /** Raw `preferred_time_slot` token (morning/afternoon/evening) or null. */
  timeSlot?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const arrivalOptions = arrivalTimeOptionsForSlot(timeSlot)
  const [arrivalTime, setArrivalTime] = useState(arrivalOptions[0])

  async function accept() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalTime }),
      })
      if (res.status === 409) {
        toast.error('Already taken', {
          description: 'Another cleaner accepted it first.',
        })
        setOpen(false)
        router.refresh()
        return
      }
      if (res.status === 403) {
        const body = await res.json().catch(() => null)
        if (body?.code === 'payouts_not_setup') {
          toast.error('Set up payouts first', {
            description:
              'Complete your payout setup so you can be paid, then accept jobs.',
            action: {
              label: 'Go to settings',
              onClick: () =>
                router.push('/cleaner/settings?payouts=required'),
            },
          })
          setOpen(false)
          router.push('/cleaner/settings?payouts=required')
          return
        }
        throw new Error(body?.error ?? 'Forbidden')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Clean accepted', { description: 'Opening job details…' })
      router.push(`/cleaner/jobs/${jobId}`)
      router.refresh()
    } catch (err) {
      toast.error('Could not accept', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Accept
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm your arrival time</DialogTitle>
          <DialogDescription>
            Accepting commits you to this arrival time — the client is told
            to expect you then.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Your arrival time</Label>
          <Select value={arrivalTime} onValueChange={setArrivalTime}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {arrivalOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={accept}
            disabled={pending}
            className="gap-1"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Accept Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
