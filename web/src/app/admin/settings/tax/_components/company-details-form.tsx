'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Initial = {
  name: string
  address: string
  contact: string
  vatNumber: string
  paymentInstructions: string
}

/**
 * Company-block + VAT + payment-instructions editor. Persists by PATCHing
 * /api/admin/billing/settings with the three logical groups: the structured
 * company object, the VAT string, and the payment-instructions string.
 *
 * The PDF renderer reads these three platform_settings rows directly in
 * inbuilt/provider.ts → renderPdfForInvoice, so a save here is reflected
 * on the next issued invoice without any rebuild.
 */
export function CompanyDetailsForm({ initial }: { initial: Initial }) {
  const router = useRouter()
  const [form, setForm] = useState<Initial>(initial)
  const [saving, setSaving] = useState(false)
  const dirty =
    form.name !== initial.name ||
    form.address !== initial.address ||
    form.contact !== initial.contact ||
    form.vatNumber !== initial.vatNumber ||
    form.paymentInstructions !== initial.paymentInstructions

  function update<K extends keyof Initial>(key: K, value: Initial[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Company name is required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyDetails: {
            name: form.name.trim(),
            address: form.address.trim(),
            contact: form.contact.trim(),
          },
          vatNumber: form.vatNumber.trim(),
          paymentInstructions: form.paymentInstructions.trim(),
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Company details saved')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="co-name" className="text-xs">
            Company name
          </Label>
          <Input
            id="co-name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="LISTD Pro Ltd"
            className="h-9 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="co-vat" className="text-xs">
            VAT number
          </Label>
          <Input
            id="co-vat"
            value={form.vatNumber}
            onChange={(e) => update('vatNumber', e.target.value)}
            placeholder="GB123456789"
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="co-address" className="text-xs">
          Address (one line per row, up to 4 rendered)
        </Label>
        <Textarea
          id="co-address"
          value={form.address}
          onChange={(e) => update('address', e.target.value)}
          rows={3}
          placeholder={'12 Acacia Avenue\nLondon\nSW1A 1AA\nUnited Kingdom'}
          className="text-sm"
        />
      </div>
      <div>
        <Label htmlFor="co-contact" className="text-xs">
          Contact line (email · phone · website)
        </Label>
        <Input
          id="co-contact"
          value={form.contact}
          onChange={(e) => update('contact', e.target.value)}
          placeholder="hello@listd.pro · +44 20 1234 5678 · listd.pro"
          className="h-9 text-sm"
        />
      </div>
      <div>
        <Label htmlFor="co-pay" className="text-xs">
          Payment instructions
        </Label>
        <Textarea
          id="co-pay"
          value={form.paymentInstructions}
          onChange={(e) => update('paymentInstructions', e.target.value)}
          rows={3}
          placeholder="Bank: NatWest&#10;Account name: LISTD Pro Ltd&#10;Sort code: 00-00-00 · Account: 12345678&#10;Please quote the invoice reference."
          className="text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Rendered as the footer panel on the PDF. Plain text: line breaks
          preserved.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setForm(initial)}
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
