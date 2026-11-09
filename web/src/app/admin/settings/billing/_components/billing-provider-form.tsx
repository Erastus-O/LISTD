'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type ProviderId = 'inbuilt' | 'xero'

/**
 * Provider radio card. Hits PATCH /api/admin/billing/settings with just
 * `invoiceProvider` set. Disabled while in flight.
 */
export function BillingProviderForm({ initial }: { initial: ProviderId }) {
  const router = useRouter()
  const [provider, setProvider] = useState<ProviderId>(initial)
  const [saving, setSaving] = useState(false)
  const dirty = provider !== initial

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceProvider: provider }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(`Active provider: ${provider}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Active provider
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProviderCard
          value="inbuilt"
          title="Inbuilt"
          description="First-party generator. Recommended for v1."
          selected={provider === 'inbuilt'}
          onSelect={() => setProvider('inbuilt')}
        />
        <ProviderCard
          value="xero"
          title="Xero"
          description="Stub: selecting blocks invoice creation until Phase 2."
          selected={provider === 'xero'}
          onSelect={() => setProvider('xero')}
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setProvider(initial)}
          disabled={saving || !dirty}
        >
          Revert
        </Button>
        <Button type="button" onClick={save} disabled={saving || !dirty}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  )
}

function ProviderCard({
  value,
  title,
  description,
  selected,
  onSelect,
}: {
  value: ProviderId
  title: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-value={value}
      className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:bg-muted/40'
      }`}
    >
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}
