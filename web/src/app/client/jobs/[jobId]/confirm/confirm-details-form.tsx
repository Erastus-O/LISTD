'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TenantDetailsForm } from '@/components/booking/tenant-details-form'
import type { TenantData } from '@/lib/booking-types'

const EMPTY: TenantData = { fullName: '', email: '', phone: '' }

/**
 * Lets the client review/update the tenant details + access instructions for an
 * in-flight job, then confirm — which marks the pre-inspection brief
 * acknowledged so the clerk knows what they're walking into.
 */
export function ConfirmDetailsForm({
  jobId,
  initialTenants,
  initialAccessInstructions,
}: {
  jobId: string
  initialTenants: TenantData[]
  initialAccessInstructions: string
}) {
  const router = useRouter()
  const [tenants, setTenants] = useState<TenantData[]>(
    initialTenants.length > 0 ? initialTenants : [{ ...EMPTY }]
  )
  const [noTenant, setNoTenant] = useState(false)
  const [access, setAccess] = useState(initialAccessInstructions)
  const [pending, setPending] = useState(false)

  async function submit() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/confirm-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenants: noTenant ? [] : tenants,
          accessInstructions: access,
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Details confirmed', {
        description: 'Thanks — your clerk has what they need for the visit.',
      })
      router.push('/client/actions')
      router.refresh()
    } catch (err) {
      toast.error('Could not confirm details', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <TenantDetailsForm
            tenants={tenants}
            onChange={setTenants}
            noTenantConfirmed={noTenant}
            onNoTenantChange={setNoTenant}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-6">
          <Label htmlFor="access-instructions" className="text-sm font-semibold">
            Access instructions
          </Label>
          <p className="text-xs text-muted-foreground">
            How does the clerk get in? Key safe code, concierge, parking, alarm,
            and who to call on arrival.
          </p>
          <Textarea
            id="access-instructions"
            value={access}
            onChange={(e) => setAccess(e.target.value)}
            rows={4}
            className="text-sm"
            placeholder="e.g. Key safe by the front door, code 4321. Tenant works from home — call 07… on arrival. Permit parking on the street."
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={submit}
          disabled={pending}
          className="gap-1.5"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm details
        </Button>
      </div>
    </div>
  )
}
