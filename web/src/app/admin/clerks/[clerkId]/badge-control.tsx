'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Shield, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Criterion = { key: string; label: string; met: boolean }

type Props = {
  clerkId: string
  currentLevel: number
  nextLevel: number
  criteria: Criterion[]
  /** Real-data criteria all met (academy module excluded). The button is
   *  enabled when this is true; admin override is still possible — they
   *  can hit the endpoint directly with a reason. */
  allRealCriteriaMet: boolean
}

/**
 * Badge Control panel — surfaces the level-up checklist + an Upgrade
 * button. Posts to [POST /api/admin/clerks/[id]/level](../../../api/admin/clerks/[clerkId]/level/route.ts)
 * which writes a `verification/verification.level_changed` audit row +
 * notifies the clerk on promotion.
 *
 * The Academy Module Complete criterion is a known stub — Listd-NEXT has
 * no academy schema yet. Promotion intentionally requires only the
 * real-data criteria; admins can override via direct API call when
 * needed. The audit row captures the decision either way.
 */
export function BadgeControl({
  clerkId,
  currentLevel,
  nextLevel,
  criteria,
  allRealCriteriaMet,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  // Don't show an upgrade button past Level 3.
  const canUpgrade = nextLevel <= 3 && allRealCriteriaMet

  async function handleUpgrade() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/clerks/${clerkId}/level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: nextLevel }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(`Promoted to Level ${nextLevel}`)
      router.refresh()
    } catch (err) {
      toast.error('Could not upgrade level', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Shield className="h-4 w-4" />
          Badge Control
        </h2>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Current Level:</span>
          <Badge variant="secondary">Level {currentLevel}</Badge>
        </div>

        {nextLevel <= 3 ? (
          <>
            <p className="text-xs font-medium text-foreground">
              Level {nextLevel} Criteria:
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {criteria.map((c) => (
                <li key={c.key} className="flex items-center gap-1.5 text-xs">
                  {c.met ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={
                      c.met ? 'text-foreground' : 'text-muted-foreground'
                    }
                  >
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={handleUpgrade}
              disabled={!canUpgrade || pending}
              className="gap-1.5"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Upgrade to Level {nextLevel}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Maximum level reached.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
