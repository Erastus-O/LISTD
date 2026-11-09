'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { contribution, linesTotal, repairProFee, type LineTag, type Pricing, type QuoteLine } from '@/lib/listd/pricing'

const money = (p: number) => `£${(p / 100).toFixed(2)}`

type Row = { d: string; pounds: string; q: string; tag: LineTag }

export type AdminQuote = { version: number; status: string; totalP: number; issuedAt: string; why: string | null }
export type AdminChangeOrder = { id: string; description: string; estimateP: number | null; status: string; totalP: number | null }

const toRows = (lines: QuoteLine[]): Row[] =>
  lines.map((l) => ({ d: l.d, pounds: (l.u / 100).toFixed(2), q: String(l.q), tag: l.tag }))

const toLines = (rows: Row[]): QuoteLine[] =>
  rows
    .filter((r) => r.d.trim())
    .map((r) => ({ d: r.d.trim(), q: Number(r.q) || 1, u: Math.round((Number(r.pounds) || 0) * 100), tag: r.tag }))

/** Quote builder and change-order pricing on the admin job page. */
export function AdminQuotePanel({
  jobId,
  jobStatus,
  isRepair,
  pricing,
  current,
  suggested,
  defaultProFeeP,
  changeOrders,
}: {
  jobId: string
  jobStatus: string
  isRepair: boolean
  pricing: Pricing
  current: AdminQuote | null
  /** Prefilled from the rate card. */
  suggested: QuoteLine[]
  defaultProFeeP: number | null
  changeOrders: AdminChangeOrder[]
}) {
  const router = useRouter()
  const canQuote = jobStatus === 'pending' || jobStatus === 'draft'
  const [editing, setEditing] = useState(!current && canQuote)
  const [rows, setRows] = useState<Row[]>(
    suggested.length ? toRows(suggested) : [{ d: 'Labour', pounds: '', q: '1', tag: 'svc' }, { d: 'Materials', pounds: '', q: '1', tag: 'materials' }]
  )
  const [proFee, setProFee] = useState(defaultProFeeP != null ? (defaultProFeeP / 100).toFixed(2) : '')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const lines = toLines(rows)
  const totalP = linesTotal(lines)
  const feeP = proFee ? Math.round(Number(proFee) * 100) : isRepair ? repairProFee(pricing, lines) : (defaultProFeeP ?? 0)
  const c = contribution(pricing, totalP, feeP)

  async function send() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, proFeeP: proFee ? feeP : undefined, why: why || undefined }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success(`Quote v${json.version} sent to the client`)
      setEditing(false)
      setWhy('')
      router.refresh()
    } catch (err) {
      toast.error('Quote not sent', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  async function priceCo(id: string, poundsText: string) {
    const u = Math.round(Number(poundsText) * 100)
    if (!u) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/change-orders/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: [{ d: 'Extra work', q: 1, u, tag: 'svc' }] }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Priced and sent to the client')
      router.refresh()
    } catch (err) {
      toast.error('Not priced', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const proposed = changeOrders.filter((co) => co.status === 'PROPOSED')
  if (!canQuote && !current && !proposed.length) return null

  return (
    <div className="a-card grid gap-4">
      <h2 className="text-base font-semibold">Quote</h2>

      {current && !editing && (
        <div className="grid gap-2 text-sm">
          <p>
            <b>Quote v{current.version} {current.status === 'ACCEPTED' ? 'accepted' : 'sent to client'}</b>: {money(current.totalP)}
          </p>
          <p className="a-muted">Sent {new Date(current.issuedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          {canQuote && (
            <div>
              <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm" onClick={() => setEditing(true)}>
                Update quote
              </button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="grid gap-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_90px_60px] gap-2">
              <Input aria-label="Description" value={r.d} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, d: e.target.value } : x)))} />
              <Input aria-label="Price in pounds" inputMode="decimal" placeholder="£" value={r.pounds} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, pounds: e.target.value } : x)))} />
              <Input aria-label="Quantity" inputMode="numeric" value={r.q} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} />
            </div>
          ))}
          <div>
            <button type="button" className="ld-btn ld-btn-ghost ld-btn-sm" onClick={() => setRows([...rows, { d: '', pounds: '', q: '1', tag: 'svc' }])}>
              Add line
            </button>
          </div>
          <div className="max-w-48">
            <Label htmlFor="pro-fee">Pro fee (£, hidden from client)</Label>
            <Input id="pro-fee" className="mt-1.5" inputMode="decimal" value={proFee} placeholder={(feeP / 100).toFixed(2)} onChange={(e) => setProFee(e.target.value)} />
          </div>
          {current && (
            <div>
              <Label htmlFor="why">Why is it changing? The client sees this.</Label>
              <Input id="why" className="mt-1.5" value={why} onChange={(e) => setWhy(e.target.value)} />
            </div>
          )}
          <div className="a-summary">
            <div className="line"><span>Client total</span><b>{money(totalP)}</b></div>
            <div className="line"><span>Pro fee</span><b>{money(feeP)}</b></div>
            <div className="line"><span>Payment, operations and rework</span><b>{money(c.costsP)}</b></div>
            <div className="line tot">
              <span>Contribution</span>
              <span>{money(c.contribP)} {c.ok ? '· above floor' : '· below floor'}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" className="ld-btn ld-btn-primary" disabled={busy || totalP <= 0} onClick={send}>
              {current ? `Send v${current.version + 1}` : 'Send quote'}
            </button>
            {current && (
              <button type="button" className="ld-btn ld-btn-secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {proposed.map((co) => (
        <ChangeOrderRow key={co.id} co={co} busy={busy} onPrice={priceCo} />
      ))}
    </div>
  )
}

function ChangeOrderRow({ co, busy, onPrice }: { co: AdminChangeOrder; busy: boolean; onPrice: (id: string, pounds: string) => void }) {
  const [v, setV] = useState(co.estimateP ? (co.estimateP / 100).toFixed(2) : '')
  return (
    <div className="grid gap-2 border-t border-border pt-3 text-sm">
      <p><b>Extra work proposed:</b> {co.description}</p>
      <div className="flex gap-2">
        <Input aria-label="Price in pounds" className="max-w-32" inputMode="decimal" placeholder="£" value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy || !Number(v)} onClick={() => onPrice(co.id, v)}>
          Price and send
        </button>
      </div>
    </div>
  )
}
