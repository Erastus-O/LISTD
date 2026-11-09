'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { namesMatch } from '@/lib/name-match'
import {
  AdoptSignature,
  type AdoptedSignature,
} from '@/components/signature/adopt-signature'

type Props = {
  jobId: string
  signoffBy: 'client' | 'tenant'
  clientAckRequired: boolean
  /** The signer's profile full name — used to flag (not block) a typed
   *  signature that doesn't match the name on the account. */
  accountName: string | null
  /** Client-signs: already signed (clientReportAccepted). */
  signed: boolean
  signatureName: string | null
  signedAt: string | null
  /** Tenant-signs + ack: when the client confirmed read & receipt. */
  acknowledgedAt: string | null
  /** Tenant-signs: the tenant's typed signature + when they signed (if yet). */
  tenantSignature?: string | null
  tenantSignedAt?: string | null
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
}

export function ReportSignoffAction(props: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<AdoptedSignature | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [pending, setPending] = useState(false)

  async function post(path: string, body: Record<string, unknown>) {
    setPending(true)
    try {
      const res = await fetch(`/api/client/jobs/${props.jobId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      return true
    } catch (err) {
      toast.error('Something went wrong', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
      return false
    }
  }

  // ── CLIENT SIGNS ──────────────────────────────────────────────────────────
  if (props.signoffBy === 'client') {
    if (props.signed) {
      return (
        <Done
          title="Report signed"
          body={`Signed${props.signatureName ? ` by ${props.signatureName}` : ''}${
            props.signedAt ? ` on ${fmt(props.signedAt)}` : ''
          }.`}
        />
      )
    }
    // A mark is required alongside the typed name — the name identifies,
    // the mark signs.
    const canSign =
      name.trim().length >= 2 && confirmChecked && Boolean(signature) && !pending
    // The signer is already authenticated, so a mismatch is most likely a
    // typo or nickname — warn, don't block.
    const nameMismatch =
      name.trim().length > 0 &&
      Boolean(props.accountName) &&
      !namesMatch(name, props.accountName ?? '')
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <PenLine className="h-4 w-4 text-primary" />
            Sign this report
          </h3>
          <p className="text-xs text-muted-foreground">
            This service requires your signature. Type your full name,
            adopt a signature, and confirm to sign off.
          </p>
          <div className="space-y-1">
            <Label htmlFor="sig-name" className="text-xs">
              Full name
            </Label>
            <Input
              id="sig-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              placeholder="Your full name"
              className="h-9 text-sm"
            />
            {nameMismatch && (
              <p className="text-xs text-amber-700">
                This doesn&rsquo;t match the name on your account (
                {props.accountName}). You can still sign, but please check
                for typos.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Your signature</Label>
            <AdoptSignature
              fullName={name}
              value={signature}
              onChange={setSignature}
              disabled={pending}
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <span>I confirm I have read and accept this report.</span>
          </label>
          <Button
            type="button"
            disabled={!canSign}
            onClick={async () => {
              if (
                await post('sign-report', {
                  name: name.trim(),
                  signatureImage: signature?.dataUrl ?? null,
                  signatureMode: signature?.mode ?? null,
                })
              ) {
                toast.success('Report signed')
                router.refresh()
              }
            }}
            className="w-full gap-1.5"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign report
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── TENANT SIGNS ──────────────────────────────────────────────────────────
  if (!props.clientAckRequired) {
    return (
      <Done
        title="Tenant sign-off"
        body="The tenant signs this report. No action is needed from you."
        muted
      />
    )
  }
  if (props.acknowledgedAt) {
    return (
      <Done
        title="Receipt confirmed"
        body={`You confirmed you read & received this report on ${fmt(
          props.acknowledgedAt
        )}.`}
      />
    )
  }
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">Confirm receipt</h3>
        <p className="text-xs text-muted-foreground">
          The tenant signs this report. Please confirm you&rsquo;ve read and
          received it — the time is recorded and our team is notified.
        </p>
        <p className="text-xs">
          {props.tenantSignedAt ? (
            <span className="text-success">
              ✓ Signed by the tenant
              {props.tenantSignature ? ` (${props.tenantSignature})` : ''} on{' '}
              {fmt(props.tenantSignedAt)}.
            </span>
          ) : (
            <span className="text-amber-700">
              Awaiting the tenant&rsquo;s signature — you can still confirm
              receipt of the report.
            </span>
          )}
        </p>
        <label className="flex items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
          />
          <span>I confirm I have read and received this report.</span>
        </label>
        <Button
          type="button"
          disabled={!confirmChecked || pending}
          onClick={async () => {
            if (await post('acknowledge-report', {})) {
              toast.success('Receipt confirmed')
              router.refresh()
            }
          }}
          className="w-full gap-1.5"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm read &amp; receipt
        </Button>
      </CardContent>
    </Card>
  )
}

function Done({
  title,
  body,
  muted,
}: {
  title: string
  body: string
  muted?: boolean
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-5">
        <CheckCircle2
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            muted ? 'text-muted-foreground' : 'text-success'
          }`}
        />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  )
}
