'use client'

import { useState } from 'react'
import { Loader2, Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Shape returned by POST /api/promo/validate for a usable code. */
export type AppliedPromo = {
  code: string
  kind: 'discount' | 'invoice_later'
  percentOff: number | null
  /** Service-type scope for discount codes; empty = every service. */
  serviceTypes: string[]
  /** True when the code was prefilled because it's assigned to this
   *  client's account (0036) — the chip says so. Still removable. */
  autoApplied?: boolean
}

/**
 * Client-side preview of the discount — mirrors `computePromoDiscount` in
 * src/lib/promo.ts (which remains authoritative at create time): percent off
 * the base price of in-scope service lines only.
 */
export function previewPromoDiscount(
  promo: AppliedPromo | null,
  serviceLines: Array<{ type: string; price: number }>
): number {
  if (!promo || promo.kind !== 'discount') return 0
  const pct = Math.min(100, Math.max(0, promo.percentOff ?? 0))
  if (pct <= 0) return 0
  const scope = promo.serviceTypes.length > 0 ? new Set(promo.serviceTypes) : null
  const eligible = serviceLines
    .filter((l) => !scope || scope.has(l.type))
    .reduce((sum, l) => sum + l.price, 0)
  return Math.round(eligible * pct) / 100
}

/**
 * "Have a promo code?" input for the booking review steps. Validates against
 * /api/promo/validate and hands the applied code up — the parent adjusts the
 * price summary (discount) or the payment copy (invoice-later).
 */
export function PromoCodeInput({
  applied,
  onApply,
  onRemove,
  clientId = null,
}: {
  applied: AppliedPromo | null
  onApply: (promo: AppliedPromo) => void
  onRemove: () => void
  /** ADMIN on-behalf booking: validate assigned (private) codes against
   *  this client instead of the caller. */
  clientId?: string | null
}) {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)

  async function apply() {
    const trimmed = code.trim()
    if (!trimmed || checking) return
    setChecking(true)
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmed,
          ...(clientId ? { clientId } : {}),
        }),
      })
      const json = (await res.json().catch(() => null)) as
        | ({ valid: true } & AppliedPromo)
        | { valid: false; error?: string }
        | null
      if (!res.ok || !json) throw new Error('Please try again.')
      if (!json.valid) {
        toast.error('Promo code not applied', {
          description:
            ('error' in json ? json.error : undefined) ??
            'That promo code is not valid.',
        })
        return
      }
      onApply({
        code: json.code,
        kind: json.kind,
        percentOff: json.percentOff,
        serviceTypes: json.serviceTypes ?? [],
      })
      setCode('')
      toast.success(
        json.kind === 'invoice_later'
          ? 'Promo applied — pay at month end'
          : 'Promo code applied'
      )
    } catch (err) {
      toast.error('Could not check the promo code', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setChecking(false)
    }
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-accent/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-primary" />
          <div>
            <p className="text-xs font-semibold text-foreground">
              {applied.code}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {applied.kind === 'invoice_later'
                ? 'No payment today — billed at the end of the month'
                : `${applied.percentOff ?? 0}% off eligible services`}
              {applied.autoApplied
                ? ' · applied automatically (assigned to this account)'
                : ''}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-7 gap-1 px-2 text-[10px] text-muted-foreground"
        >
          <X className="h-3 w-3" />
          Remove
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">Have a promo code?</p>
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void apply()
            }
          }}
          placeholder="e.g. LISTD10"
          className="h-9 text-xs uppercase"
          maxLength={40}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={apply}
          disabled={!code.trim() || checking}
          className="h-9 gap-1.5 text-xs"
        >
          {checking && <Loader2 className="h-3 w-3 animate-spin" />}
          Apply
        </Button>
      </div>
    </div>
  )
}
