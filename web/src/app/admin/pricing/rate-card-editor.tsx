'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SIZE_LABEL, type Pricing, type ProRole } from '@/lib/listd/pricing'

const RATE_ROWS: Array<[keyof Pricing['rates'], string]> = [
  ['INVENTORY', 'Inventory & Condition'],
  ['CHECK_IN', 'Standalone check-in'],
  ['COMBO', 'Inventory + check-in, same visit'],
  ['MID_TERM', 'Mid-term'],
  ['CHECK_OUT', 'Check-out'],
]
const ROLE_ROWS: Array<[ProRole, string]> = [
  ['CLERK', 'Pro Clerk'],
  ['CLEANER', 'Pro Cleaner'],
  ['TRADES', 'Pro Trades'],
]

const toP = (v: string) => Math.round((Number(v) || 0) * 100)
const toPounds = (p: number) => String(p / 100)

function Money({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (p: number) => void }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="mt-1.5" inputMode="decimal" defaultValue={toPounds(value)} onBlur={(e) => onChange(toP(e.target.value))} />
    </div>
  )
}

export function RateCardEditor({ initial }: { initial: Pricing }) {
  const [pr, setPr] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<Pricing>) => setPr((x) => ({ ...x, ...p }))

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/pricing-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rates: pr.rates,
          furnish: pr.furnish,
          extraRoomP: pr.extraRoomP,
          outbuildingP: pr.outbuildingP,
          outdoorP: pr.outdoorP,
          sched: pr.sched,
          pro: pr.pro,
          repairs: pr.repairs,
          rebate: pr.rebate,
          taxPct: pr.taxPct,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Rate card saved. New bookings use it straight away.')
    } catch (err) {
      toast.error('Not saved', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>Pricing</h1>
            <p>Pilot prices. Changes apply to new bookings; existing quotes keep their price. The public Pricing page is separate copy, so keep it in step.</p>
          </div>
        </div>

        <section className="a-card grid gap-3">
          <h2 className="text-base font-semibold">Inspection rate card (£, Standard, unfurnished)</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Service</th>
                  {SIZE_LABEL.map((s) => <th key={s} className="p-2 text-left font-medium">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {RATE_ROWS.map(([key, label]) => (
                  <tr key={key} className="border-t border-border">
                    <th scope="row" className="p-2 text-left font-medium">{label}</th>
                    {pr.rates[key].map((p, i) => (
                      <td key={i} className="p-1">
                        <Input
                          aria-label={`${label}, ${SIZE_LABEL[i]}`}
                          inputMode="decimal"
                          defaultValue={toPounds(p)}
                          onBlur={(e) => {
                            const next = [...pr.rates[key]]
                            next[i] = toP(e.target.value)
                            set({ rates: { ...pr.rates, [key]: next } })
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="a-card grid gap-3">
          <h2 className="text-base font-semibold">Adjustments (£)</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Money id="f-part" label="Part-furnished" value={pr.furnish.part} onChange={(part) => set({ furnish: { ...pr.furnish, part } })} />
            <Money id="f-small" label="Furnished, studio to 2 bed" value={pr.furnish.furnishedSmall} onChange={(furnishedSmall) => set({ furnish: { ...pr.furnish, furnishedSmall } })} />
            <Money id="f-large" label="Furnished, 3 to 4 bed" value={pr.furnish.furnishedLarge} onChange={(furnishedLarge) => set({ furnish: { ...pr.furnish, furnishedLarge } })} />
            <Money id="x-room" label="Extra room" value={pr.extraRoomP} onChange={(extraRoomP) => set({ extraRoomP })} />
            <Money id="x-out" label="Outbuildings" value={pr.outbuildingP} onChange={(outbuildingP) => set({ outbuildingP })} />
            <Money id="x-door" label="Large outdoor area" value={pr.outdoorP} onChange={(outdoorP) => set({ outdoorP })} />
            <Money id="s-pri" label="Priority (client)" value={pr.sched.priorityP} onChange={(priorityP) => set({ sched: { ...pr.sched, priorityP } })} />
            <Money id="s-pro" label="Priority (to the Pro)" value={pr.sched.priorityProP} onChange={(priorityProP) => set({ sched: { ...pr.sched, priorityProP } })} />
            <Money id="r-diag" label="Repair diagnosis" value={pr.repairs.diagnosisP} onChange={(diagnosisP) => set({ repairs: { ...pr.repairs, diagnosisP } })} />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={pr.sched.priorityOpen} onChange={(e) => set({ sched: { ...pr.sched, priorityOpen: e.target.checked } })} />
            Offer Priority bookings
          </label>
        </section>

        <section className="a-card grid gap-3">
          <h2 className="text-base font-semibold">Pro hourly rates (£)</h2>
          {ROLE_ROWS.map(([role, label]) => (
            <div key={role} className="grid gap-3 sm:grid-cols-4">
              <p className="self-center text-sm font-medium">{label}</p>
              {pr.pro.rates[role].map((p, i) => (
                <Money
                  key={i}
                  id={`rate-${role}-${i}`}
                  label={`Level ${i + 1}`}
                  value={p}
                  onChange={(v) => {
                    const next = [...pr.pro.rates[role]]
                    next[i] = v
                    set({ pro: { ...pr.pro, rates: { ...pr.pro.rates, [role]: next } } })
                  }}
                />
              ))}
            </div>
          ))}
        </section>

        <section className="a-card grid gap-3 sm:grid-cols-3">
          <h2 className="text-base font-semibold sm:col-span-3">VAT and portfolio</h2>
          <div>
            <Label htmlFor="tax">VAT %</Label>
            <Input id="tax" className="mt-1.5" inputMode="decimal" defaultValue={pr.taxPct} onBlur={(e) => set({ taxPct: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <Label htmlFor="r-pct">Rebate %</Label>
            <Input id="r-pct" className="mt-1.5" inputMode="decimal" defaultValue={pr.rebate.pct} onBlur={(e) => set({ rebate: { ...pr.rebate, pct: Number(e.target.value) || 0 } })} />
          </div>
          <div>
            <Label htmlFor="r-t1">Rebate from (jobs a month)</Label>
            <Input id="r-t1" className="mt-1.5" inputMode="numeric" defaultValue={pr.rebate.tier1} onBlur={(e) => set({ rebate: { ...pr.rebate, tier1: Number(e.target.value) || 0 } })} />
          </div>
        </section>

        <div>
          <button type="button" className="ld-btn ld-btn-primary ld-btn-lg" disabled={busy} onClick={save}>
            {busy ? 'Saving...' : 'Save rate card'}
          </button>
        </div>
      </div>
    </div>
  )
}
