'use client'

import { Check, Clock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const TIME_SLOTS = [
  { value: 'morning', label: 'Morning', time: '9:00 – 12:00' },
  { value: 'afternoon', label: 'Afternoon', time: '12:00 – 17:00' },
  { value: 'evening', label: 'Evening', time: '17:00 – 20:00' },
] as const

type Props = {
  scheduledDate: string | null
  scheduledTimeSlot: string | null
  onDateChange: (iso: string | null) => void
  onTimeSlotChange: (slot: string | null) => void
}

/**
 * Step 5: schedule + preferred time slot.
 *
 * Native `<input type="date">` instead of a popover calendar — fewer
 * dependencies + better mobile keyboard. Min date is today (browser-
 * enforced; server validates again on createJob in S4c).
 */
export function DateTimeSelector({
  scheduledDate,
  scheduledTimeSlot,
  onDateChange,
  onTimeSlotChange,
}: Props) {
  const todayISO = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Schedule inspection
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick a date and preferred time window.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Preferred date *</Label>
        <Input
          type="date"
          min={todayISO}
          value={scheduledDate ?? ''}
          onChange={(e) => onDateChange(e.target.value || null)}
          className="h-9 text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Same-day bookings incur a £50 surcharge; bookings within 24 hours
          incur a £30 short-notice surcharge.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Preferred time slot</Label>
        <div className="grid grid-cols-3 gap-2">
          {TIME_SLOTS.map((slot) => {
            const isSelected = scheduledTimeSlot === slot.value
            return (
              <button
                key={slot.value}
                type="button"
                onClick={() =>
                  onTimeSlotChange(isSelected ? null : slot.value)
                }
                className={cn(
                  'relative rounded-lg border p-2.5 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-accent/5 ring-1 ring-accent/20'
                    : 'border-border bg-card hover:border-primary/30'
                )}
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">
                    {slot.label}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {slot.time}
                </span>
                {isSelected && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                    <Check className="h-2.5 w-2.5 text-accent-foreground" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Optional: the assigned clerk will confirm the exact time.
        </p>
      </div>
    </div>
  )
}
