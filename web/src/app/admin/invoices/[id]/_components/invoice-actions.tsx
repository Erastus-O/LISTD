'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Loader2,
  Mail,
  Receipt,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void'

type InvoiceKind = 'invoice' | 'credit_note'

type Props = {
  invoiceId: string
  status: InvoiceStatus
  kind: InvoiceKind
  total: string
  paidTotal: string
  currency: string
  hasPdf: boolean
}

type CreditNoteLineSeed = {
  description: string
  quantity: number
  unitPrice: number
  taxRateId: string | null
  jobId: string | null
}

/**
 * Lifecycle action panel on the admin invoice detail page. Renders
 * status-aware buttons:
 *   draft           → Issue
 *   issued / sent / overdue → Send · Record payment · Void
 *   paid            → Send (re-send), Void (with reason)
 *   void            → no actions (terminal)
 *
 * Each action POSTs to the corresponding `/api/billing/invoices/[id]/*`
 * route which delegates to the active provider.
 */
export function InvoiceActions({
  invoiceId,
  status,
  kind,
  total,
  paidTotal,
  currency,
  hasPdf,
  creditNoteLineSeed,
}: Props & { creditNoteLineSeed?: CreditNoteLineSeed[] }) {
  const isTerminal = status === 'void'
  const isPayable =
    status === 'issued' || status === 'sent' || status === 'overdue'
  const remaining = Math.max(0, Number(total) - Number(paidTotal))
  // Credit notes can only be raised against regular invoices that have
  // been issued (or beyond) and aren't void. No "credit note of a
  // credit note" — that's a fresh invoice the other way round.
  const canCreditNote =
    kind === 'invoice' &&
    status !== 'draft' &&
    status !== 'void' &&
    !!creditNoteLineSeed?.length

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Receipt className="h-4 w-4" /> Actions
        </h2>

        {status === 'draft' && (
          <IssueButton invoiceId={invoiceId} />
        )}

        {hasPdf && status !== 'draft' && !isTerminal && (
          <SendButton invoiceId={invoiceId} />
        )}

        {isPayable && (
          <RecordPaymentButton
            invoiceId={invoiceId}
            remaining={remaining}
            currency={currency}
          />
        )}

        {canCreditNote && creditNoteLineSeed && (
          <CreditNoteButton
            invoiceId={invoiceId}
            currency={currency}
            seed={creditNoteLineSeed}
          />
        )}

        {!isTerminal && status !== 'draft' && (
          <VoidButton invoiceId={invoiceId} />
        )}

        {isTerminal && (
          <p className="text-xs text-muted-foreground">
            This invoice is void. No further actions are possible.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CreditNoteButton({
  invoiceId,
  currency,
  seed,
}: {
  invoiceId: string
  currency: string
  seed: CreditNoteLineSeed[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency })
  const total = seed.reduce(
    (n, l) => n + l.quantity * l.unitPrice,
    0
  )

  async function handle() {
    if (pending) return
    if (reason.trim().length < 3) {
      toast.error('Reason is required (3+ characters).')
      return
    }
    setPending(true)
    try {
      const res = await fetch(
        `/api/billing/invoices/${invoiceId}/credit-notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: reason.trim(),
            lineItems: seed.map((l, i) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRateId: l.taxRateId,
              jobId: l.jobId,
              position: i,
            })),
          }),
        }
      )
      const json = (await res.json().catch(() => ({}))) as {
        creditNote?: { id: string }
        error?: string
      }
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      if (!json.creditNote?.id) throw new Error('Server returned no id')
      toast.success('Credit note draft created')
      router.push(`/admin/invoices/${json.creditNote.id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create')
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full justify-start gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Receipt className="h-3.5 w-3.5" />
        Generate credit note
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate credit note</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Creates a draft credit note for{' '}
            <strong className="text-foreground">{fmt.format(total)}</strong>{' '}
            mirroring this invoice&rsquo;s line items. Edit, issue, and send
            it like a normal invoice : the reference will be in the{' '}
            <span className="font-mono">CN-YYYY-NNNNN</span> series.
          </p>
          <div>
            <Label htmlFor="cn-reason" className="text-xs">
              Reason
            </Label>
            <Textarea
              id="cn-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Cancelled inspection: partial refund of advance payment"
              className="text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Captured in the audit trail and printed on the PDF.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handle} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IssueButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function handle() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/billing/invoices/${invoiceId}/issue`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Invoice issued', {
        description: 'PDF generated and reference allocated.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Could not issue', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <Button
      type="button"
      size="sm"
      onClick={handle}
      disabled={pending}
      className="w-full justify-start gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      Issue invoice
    </Button>
  )
}

function SendButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function handle() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Invoice emailed')
      router.refresh()
    } catch (err) {
      toast.error('Could not send', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handle}
      disabled={pending}
      className="w-full justify-start gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Mail className="h-3.5 w-3.5" />
      )}
      Send by email
    </Button>
  )
}

function RecordPaymentButton({
  invoiceId,
  remaining,
  currency,
}: {
  invoiceId: string
  remaining: number
  currency: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [paidAt, setPaidAt] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [method, setMethod] = useState<
    'bank_transfer' | 'card' | 'cash' | 'other'
  >('bank_transfer')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  async function handle() {
    if (pending) return
    const numeric = Number.parseFloat(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Amount must be a positive number')
      return
    }
    setPending(true)
    try {
      const res = await fetch(
        `/api/billing/invoices/${invoiceId}/payments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paidAmount: numeric,
            paidAt,
            method,
            reference: reference.trim() || undefined,
            note: note.trim() || undefined,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Payment recorded')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not record payment', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-1.5"
      >
        <Send className="h-3.5 w-3.5" />
        Record payment
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Outstanding balance:{' '}
            <span className="font-medium text-foreground">
              {new Intl.NumberFormat('en-GB', {
                style: 'currency',
                currency,
              }).format(remaining)}
            </span>
          </p>
          <div>
            <Label htmlFor="payment-amount" className="text-xs">
              Amount
            </Label>
            <Input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={pending}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="payment-date" className="text-xs">
              Paid date
            </Label>
            <Input
              id="payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              disabled={pending}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as typeof method)}
              disabled={pending}
            >
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="payment-ref" className="text-xs">
              Reference (optional)
            </Label>
            <Input
              id="payment-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={pending}
              className="mt-1 h-9"
              placeholder="Bank transaction id, cheque no., etc."
            />
          </div>
          <div>
            <Label htmlFor="payment-note" className="text-xs">
              Note (optional)
            </Label>
            <Textarea
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              rows={2}
              className="mt-1 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handle}
            disabled={pending}
            className="gap-1.5"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VoidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState('')

  async function handle() {
    if (pending) return
    if (reason.trim().length < 3) {
      toast.error('Reason required (at least 3 characters)')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Invoice voided')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not void', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        <XCircle className="h-3.5 w-3.5" />
        Void invoice
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void this invoice?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Voided invoices keep their reference (per HMRC record-keeping)
          but can&apos;t be paid, edited, or re-sent. The reason is
          captured in the audit log.
        </p>
        <div>
          <Label htmlFor="void-reason" className="text-xs">
            Reason
          </Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={3}
            className="mt-1 text-sm"
            placeholder="Duplicate / wrong client / contract cancelled / …"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handle}
            disabled={pending || reason.trim().length < 3}
            className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
