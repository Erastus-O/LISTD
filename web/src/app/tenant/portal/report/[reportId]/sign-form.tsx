'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { namesMatch } from '@/lib/name-match'
import {
  AdoptSignature,
  type AdoptedSignature,
} from '@/components/signature/adopt-signature'

type Props = {
  reportId: string
  token: string
  /** The tenant's full name as recorded on `tenant_details.full_name`. The
   *  signed name must match (case-insensitive, trimmed) — type-to-sign with
   *  identity check, the same legal weight as DocuSign's typed-signature mode. */
  expectedSignature: string
}

/**
 * Tenant signing UX. Type-to-sign: the user types their full name; if it
 * matches the name on file (case-insensitive, whitespace-tolerant), we
 * POST `/api/tenant/sign` which records the signature server-side and
 * (per the Lovable port roadmap Q4 default) **rotates the token**, so the
 * URL the user holds remains valid for read-only access for the
 * 5-minute grace window.
 */
export function SignForm({ reportId, token, expectedSignature }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<AdoptedSignature | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const matches = namesMatch(name, expectedSignature)
  const showHint = name.trim().length > 0 && !matches
  // The typed name is still the identity check; the adopted mark is the
  // signature itself. Both are required — a name with no mark is what we
  // had before, and a mark with an unmatched name proves nothing.
  const canSign = matches && Boolean(signature)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSign || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/tenant/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          token,
          signature: name.trim(),
          signatureImage: signature?.dataUrl ?? null,
          signatureMode: signature?.mode ?? null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Report signed', {
        description: 'Thanks: your signature has been recorded.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Could not sign report', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Type your full name, adopt a signature, and confirm you have
        reviewed this report and agree with its contents.
      </p>

      <div>
        <Label htmlFor="signature" className="text-xs">
          Full name
        </Label>
        <Input
          id="signature"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Type your full name${expectedSignature ? `: ${expectedSignature}` : ''}`}
          className="mt-1 font-semibold text-base italic"
          maxLength={100}
          autoComplete="off"
          disabled={submitting}
        />
        {showHint && (
          <p className="mt-1 text-xs text-destructive">
            Signature must match the full name on the booking ({expectedSignature}).
          </p>
        )}
        {!expectedSignature && (
          <p className="mt-1 text-xs text-muted-foreground">
            We don&rsquo;t have a name on file for you yet. Please ask your
            letting agent to update your tenant record before signing.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Your signature</Label>
        <AdoptSignature
          fullName={name}
          value={signature}
          onChange={setSignature}
          disabled={submitting}
        />
      </div>

      <div>
        <Label className="text-xs">Date</Label>
        <Input value={today} disabled className="mt-1 bg-muted/50" />
      </div>

      <Button
        type="submit"
        disabled={!canSign || submitting}
        className="w-full"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Confirm &amp; Sign Report
      </Button>
    </form>
  )
}
