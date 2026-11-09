'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Users, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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

export type JobDetailsModalData = {
  jobId: string
  refSlug: string
  /** Area in "BS8, Bristol" form, derived in the parent. */
  area: string
  /** Every service on the booking, joined — "New Inventory + Check-In". */
  serviceTypeLabel: string
  /** The booking includes a service the tenant has to be present for, so
   *  the Pro has an appointment to arrange on top of turning up. */
  needsTenantAppointment: boolean
  /** Signed thumbnail URL, or null when the client added no photo. */
  imageUrl: string | null
  propertyLabel: string
  scheduledDateLabel: string
  timePreference: string
  /** Raw `preferred_time_slot` token (morning/afternoon/evening) or null —
   *  drives the arrival-time options the clerk commits to on accept. */
  timeSlot: string | null
  furnishedLabel: string
  serviceTierLabel: string
  isRepeat: boolean
  isUrgent: boolean
  specialInstructions: string | null
  /** Total clerk payout for headline display. */
  payout: number
  /** Itemised payout lines (base service + per-feature add-ons). Empty for
   *  legacy jobs created before the breakdown was recorded. */
  payoutLines: { label: string; amount: number }[]
}

/**
 * Job details modal (Lovable port of `JobDetailsDialog`).
 *
 * Replaces the inline two-step "View & Accept → Cancel/Confirm" pattern with
 * a proper detail surface: a "View" trigger on each card opens this modal,
 * which headlines the clerk pay and lays out every field the clerk needs
 * to make a decision before Accept Job commits via the existing
 * [POST /api/clerk/jobs/[id]/accept](../../../../api/clerk/jobs/[jobId]/accept/route.ts)
 * route.
 *
 * On success: routes to the assigned-job detail page (full address +
 * tenant + access info). On 409 (claimed by another clerk between view
 * and confirm): toast + `router.refresh()` so the card disappears.
 */
export function JobDetailsModal({ data }: { data: JobDetailsModalData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  // Accepting commits the clerk to an arrival time within the client's
  // slot — it becomes `jobs.scheduled_at`, driving the 2-hour reminder
  // and the missed check-in alarm (framework §12).
  const arrivalOptions = arrivalTimeOptionsForSlot(data.timeSlot)
  const [arrivalTime, setArrivalTime] = useState(arrivalOptions[0])

  async function handleAccept() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/clerk/jobs/${data.jobId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalTime }),
      })
      if (res.status === 409) {
        toast.error('Job already taken', {
          description: 'Another clerk accepted it before you.',
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
                router.push('/clerk/settings?payouts=required'),
            },
          })
          setOpen(false)
          router.push('/clerk/settings?payouts=required')
          return
        }
        throw new Error(body?.error ?? 'Forbidden')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(`Accepted ${data.refSlug}`, {
        description: 'Routing to job details…',
      })
      router.push(`/clerk/jobs/${data.jobId}`)
      router.refresh()
    } catch (err) {
      toast.error('Could not accept job', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="gap-1">
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Job Details</DialogTitle>
            {data.isUrgent && (
              <Badge
                variant="outline"
                className="gap-0.5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700"
              >
                <Zap className="h-3 w-3" /> Urgent
              </Badge>
            )}
          </div>
          <DialogDescription>
            Review the details before accepting this job.
          </DialogDescription>
        </DialogHeader>

        {data.imageUrl && (
          <div className="relative h-36 w-full overflow-hidden rounded-lg border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, expires hourly */}
            <img
              src={data.imageUrl}
              alt={`Property in ${data.area}`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-center text-xs text-muted-foreground">Your Pay</p>
          <p className="text-center font-display text-3xl text-foreground">
            £ {data.payout.toFixed(2)}
          </p>
          {data.payoutLines.length > 0 && (
            <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
              {data.payoutLines.map((line, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="font-medium text-foreground">
                    £{line.amount.toFixed(2)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Area" value={data.area} />
          <Field label="Service Type" value={data.serviceTypeLabel} />
          <Field label="Property" value={data.propertyLabel} />
          <Field label="Date Required" value={data.scheduledDateLabel} />
          <Field label="Time Preference" value={data.timePreference} />
          <Field label="Furnished Status" value={data.furnishedLabel} />
          <Field label="Service Tier" value={data.serviceTierLabel} />
          <Field label="Repeat Job" value={data.isRepeat ? 'Yes' : 'No'} />
        </div>

        {data.needsTenantAppointment && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">Tenant hand-over included.</span>{' '}
              This booking bundles a check-in/check-out, so you&apos;ll need
              to agree the appointment with the tenant — their contact
              details appear on the job once you accept.
            </span>
          </div>
        )}

        {data.specialInstructions && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed">
            <p className="font-medium text-foreground">Special Notes</p>
            <p className="mt-1 text-muted-foreground">
              {data.specialInstructions}
            </p>
          </div>
        )}

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
          <p className="text-[11px] text-muted-foreground">
            Accepting commits you to this arrival time — the client is told
            to expect you then.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleAccept}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  )
}
