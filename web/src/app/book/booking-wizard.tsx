'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/listd/icon'
import { DateTimeSelector } from '@/components/booking/date-time-selector'
import { PromoCodeInput, type AppliedPromo } from '@/components/booking/promo-code-input'
import { PropertySelector } from '@/components/booking/property-selector'
import { TenantDetailsForm } from '@/components/booking/tenant-details-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BookingProperty } from '@/lib/booking-data'
import type { TenantData } from '@/lib/booking-types'
import { planBooking } from '@/lib/listd/booking-plan'
import {
  CLEAN_ADDON_LABEL,
  CLEAN_LABEL,
  type CleanAddon,
  type CleanCondition,
  type CleanType,
  type Pricing,
  type ServiceKey,
} from '@/lib/listd/pricing'
import { SERVICE_LABEL, toPricedProperty, type BookingScope } from '@/lib/listd/services'

const DRAFT_KEY = 'listd:booking-wizard'

const SERVICES: Array<{ key: ServiceKey; icon: string; color: string; desc: string }> = [
  { key: 'INVENTORY', icon: 'inventory', color: 'inventory', desc: 'Inspection and full schedule of condition.' },
  { key: 'CHECK_IN', icon: 'check-in', color: 'checkin', desc: 'Tenant walk-through at the start of the tenancy, with sign-off.' },
  { key: 'MID_TERM', icon: 'inspection', color: 'midterm', desc: 'Condition inspection during the tenancy.' },
  { key: 'CHECK_OUT', icon: 'check-out', color: 'checkout', desc: 'End-of-tenancy condition, compared with the earlier report, with sign-off.' },
  { key: 'REPAIRS_DAMAGES', icon: 'settings', color: 'repairs', desc: 'A fixed task price where the job is clear, or a paid diagnostic visit where it isn’t.' },
  { key: 'CLEANING', icon: 'cleaning', color: 'cleaning', desc: 'An estimate now, a fixed quote before you pay.' },
]

const INSPECTIONS: ServiceKey[] = ['INVENTORY', 'CHECK_IN', 'MID_TERM', 'CHECK_OUT']
const STEPS = ['Property', 'Services', 'Details', 'Date', 'Review'] as const

const money = (p: number) => `£${(p / 100).toFixed(2)}`

type Draft = {
  propertyId: string | null
  services: ServiceKey[]
  sameVisit: boolean
  scope: BookingScope
  date: string | null
  slot: string | null
  notes: string
  tenants: TenantData[]
  noTenant: boolean
}

const EMPTY: Draft = {
  propertyId: null,
  services: [],
  sameVisit: true,
  scope: { clean: 'standard', condition: 'vacant-tidy', addons: [], repairMode: 'diagnose' },
  date: null,
  slot: null,
  notes: '',
  tenants: [{ fullName: '', email: '', phone: '' }],
  noTenant: false,
}

/**
 * Booking wizard: any mix of the six services for one property. Prices come from
 * planBooking(), the same function the server uses to charge.
 */
export function BookingWizard({
  initialProperties,
  pricing,
  onBehalf = null,
  initialPromo = null,
}: {
  initialProperties: BookingProperty[]
  pricing: Pricing
  onBehalf?: { clientId: string; name: string } | null
  initialPromo?: AppliedPromo | null
}) {
  const router = useRouter()
  const [properties, setProperties] = useState(initialProperties)
  const [step, setStep] = useState(0)
  const [d, setD] = useState<Draft>(EMPTY)
  const [promo, setPromo] = useState<AppliedPromo | null>(initialPromo)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  // Before a date is chosen, preview at Standard: ten days ahead is never Priority.
  const [previewDate] = useState(() => new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10))

  // Save as you go. Per-browser convenience: losing it just means starting over.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of browser-only storage
      if (raw && !onBehalf) setD({ ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) })
    } catch {
      /* storage unavailable or an old draft: start fresh */
    }
    setHydrated(true)
  }, [onBehalf])
  useEffect(() => {
    if (!hydrated || onBehalf) return
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    } catch {
      /* ignore */
    }
  }, [d, hydrated, onBehalf])

  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const patchScope = (p: Partial<BookingScope>) => setD((x) => ({ ...x, scope: { ...x.scope, ...p } }))

  const property = properties.find((p) => p.id === d.propertyId) ?? null
  const has = (k: ServiceKey) => d.services.includes(k)
  const needsTenant = d.services.some((s) => INSPECTIONS.includes(s))
  const tenantOk = !needsTenant || d.noTenant || d.tenants.some((t) => t.fullName.trim())

  const priced = useMemo(() => {
    if (!property || !d.services.length) return null
    const date = d.date ?? previewDate
    return planBooking(
      pricing,
      { ...toPricedProperty(property), postcode: property.postcode },
      { services: d.services, sameVisit: d.sameVisit, scope: d.scope, scheduledDate: date }
    )
  }, [pricing, property, d.services, d.sameVisit, d.scope, d.date, previewDate])

  const coverageError = priced && !priced.ok && !d.date ? priced.error : null
  const planError = priced && !priced.ok ? priced.error : null

  const canNext = [
    Boolean(property),
    d.services.length > 0 && !coverageError,
    tenantOk,
    Boolean(d.date) && !planError,
    tenantOk && Boolean(d.date) && !planError,
  ][step]

  async function submit() {
    if (!property || !d.date || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          services: d.services,
          sameVisit: d.sameVisit,
          scope: d.scope,
          scheduledDate: d.date,
          scheduledTimeSlot: d.slot,
          specialInstructions: d.notes || undefined,
          tenants: d.tenants.filter((t) => t.fullName.trim() || t.email.trim() || t.phone.trim()),
          noTenantConfirmed: d.noTenant,
          ...(onBehalf ? { onBehalfOfClientId: onBehalf.clientId } : {}),
          ...(promo ? { promoCode: promo.code } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      try {
        window.localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl
        return
      }
      if (json.clientPaymentPending) {
        toast.success('Booked for the client', { description: `${onBehalf?.name ?? 'The client'} has been sent a secure payment link.` })
        router.push(`/admin/jobs/${json.jobs[0].id}`)
        return
      }
      if (json.ownerPaymentPending) {
        toast.success('Booking sent for payment', { description: 'Your organisation owner has a payment link.' })
      } else {
        toast.success('Booking made')
      }
      router.push('/client/jobs')
    } catch (err) {
      toast.error('Your booking wasn’t made', { description: err instanceof Error ? err.message : 'Please try again.' })
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>New booking{onBehalf ? ` for ${onBehalf.name}` : ''}</h1>
            <p>Choose one or more services for the property. You’ll see the price before anything is charged.</p>
          </div>
        </div>

        <div className="a-steps" aria-label="Booking steps">
          {STEPS.map((s, i) => (
            <span key={s} className={i === step ? 'on' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </span>
          ))}
        </div>

        <div className="a-card grid gap-5">
          {step === 0 && (
            <PropertySelector
              properties={properties}
              selectedPropertyId={d.propertyId}
              onSelect={(id) => patch({ propertyId: id })}
              onPropertyCreated={(p) => {
                setProperties((list) => [p, ...list])
                patch({ propertyId: p.id })
              }}
              defaultSize="2_bed"
              defaultFurnishing="unfurnished"
              createForClientId={onBehalf?.clientId ?? null}
            />
          )}

          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold">Which services do you need?</h2>
              <div className="a-choice">
                {SERVICES.map((s) => (
                  <label key={s.key} className="a-opt">
                    <input
                      type="checkbox"
                      checked={has(s.key)}
                      onChange={(e) =>
                        patch({ services: e.target.checked ? [...d.services, s.key] : d.services.filter((x) => x !== s.key) })
                      }
                    />
                    <span className="ic" style={{ '--c': `var(--service-${s.color}-subtle)` } as React.CSSProperties}>
                      <Icon name={s.icon} size={20} />
                    </span>
                    <b>{SERVICE_LABEL[s.key]}</b>
                    <span>{s.desc}</span>
                  </label>
                ))}
              </div>
              {has('INVENTORY') && has('CHECK_IN') && (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={d.sameVisit} onChange={(e) => patch({ sameVisit: e.target.checked })} />
                  <span>Do the inventory and check-in on the same visit. It costs less than booking them separately.</span>
                </label>
              )}
              {coverageError && (
                <p className="a-autherr" role="alert">
                  <Icon name="error" size={16} />
                  <span>{coverageError}</span>
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {has('CLEANING') && (
                <section className="grid gap-3">
                  <h2 className="text-lg font-semibold">Cleaning</h2>
                  <div className="a-choice">
                    {(Object.keys(CLEAN_LABEL) as CleanType[]).map((c) => (
                      <label key={c} className="a-opt">
                        <input type="radio" name="clean" checked={d.scope.clean === c} onChange={() => patchScope({ clean: c })} />
                        <b>{CLEAN_LABEL[c]}</b>
                      </label>
                    ))}
                  </div>
                  {d.scope.clean === 'office' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="area">Floor area (m²)</Label>
                        <Input id="area" type="number" min={1} className="mt-1.5" value={d.scope.areaM2 ?? ''} onChange={(e) => patchScope({ areaM2: Number(e.target.value) || undefined })} />
                      </div>
                      <div>
                        <Label htmlFor="freq">How often?</Label>
                        <Input id="freq" className="mt-1.5" placeholder="Weekly" value={d.scope.frequency ?? ''} onChange={(e) => patchScope({ frequency: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="cond">Condition</Label>
                      <select
                        id="cond"
                        className="mt-1.5 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        value={d.scope.condition}
                        onChange={(e) => patchScope({ condition: e.target.value as CleanCondition })}
                      >
                        <option value="vacant-tidy">Vacant and tidy</option>
                        <option value="vacant-dirty">Vacant, needs extra work</option>
                        <option value="occupied">Occupied</option>
                      </select>
                    </div>
                  )}
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-medium">Add-ons</legend>
                    {(Object.keys(CLEAN_ADDON_LABEL) as CleanAddon[]).map((a) => (
                      <label key={a} className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={(d.scope.addons ?? []).includes(a)}
                          onChange={(e) =>
                            patchScope({
                              addons: e.target.checked ? [...(d.scope.addons ?? []), a] : (d.scope.addons ?? []).filter((x) => x !== a),
                            })
                          }
                        />
                        {CLEAN_ADDON_LABEL[a]}
                      </label>
                    ))}
                  </fieldset>
                  {(d.scope.addons ?? []).includes('carpets') && (
                    <div className="max-w-40">
                      <Label htmlFor="carpets">Carpeted rooms</Label>
                      <Input id="carpets" type="number" min={1} className="mt-1.5" value={d.scope.carpetRooms ?? 1} onChange={(e) => patchScope({ carpetRooms: Number(e.target.value) || 1 })} />
                    </div>
                  )}
                </section>
              )}

              {has('REPAIRS_DAMAGES') && (
                <section className="grid gap-3">
                  <h2 className="text-lg font-semibold">Repairs & Maintenance</h2>
                  <div className="a-choice">
                    <label className="a-opt">
                      <input type="radio" name="repair" checked={d.scope.repairMode === 'diagnose'} onChange={() => patchScope({ repairMode: 'diagnose' })} />
                      <b>I’m not sure what’s wrong</b>
                      <span>A {money(pricing.repairs.diagnosisP)} diagnostic visit finds the cause and prices the repair. The fee is credited if you go ahead.</span>
                    </label>
                    <label className="a-opt">
                      <input type="radio" name="repair" checked={d.scope.repairMode === 'fixed'} onChange={() => patchScope({ repairMode: 'fixed' })} />
                      <b>I know what needs doing</b>
                      <span>LISTD sends a fixed quote for labour and materials before anything is booked.</span>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cat">Type of repair</Label>
                      <select id="cat" className="mt-1.5 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={d.scope.category ?? ''} onChange={(e) => patchScope({ category: e.target.value })}>
                        <option value="">Choose one</option>
                        {['Plumbing', 'Electrical', 'Appliances', 'Fixtures & decor', 'Other'].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="loc">Where in the property?</Label>
                      <Input id="loc" className="mt-1.5" placeholder="Kitchen" value={d.scope.location ?? ''} onChange={(e) => patchScope({ location: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="desc">What’s the problem?</Label>
                    <Textarea id="desc" className="mt-1.5" value={d.scope.description ?? ''} onChange={(e) => patchScope({ description: e.target.value })} />
                  </div>
                </section>
              )}

              {needsTenant && (
                <section className="grid gap-3">
                  <h2 className="text-lg font-semibold">Tenant</h2>
                  <TenantDetailsForm
                    tenants={d.tenants}
                    onChange={(tenants) => patch({ tenants })}
                    noTenantConfirmed={d.noTenant}
                    onNoTenantChange={(noTenant) => patch({ noTenant })}
                  />
                </section>
              )}

              <section className="grid gap-2">
                <Label htmlFor="notes">Access and anything else we should know</Label>
                <Textarea id="notes" value={d.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Keys, parking, alarms, pets" />
              </section>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-semibold">When do you need it?</h2>
              <DateTimeSelector
                scheduledDate={d.date}
                scheduledTimeSlot={d.slot}
                onDateChange={(date) => patch({ date })}
                onTimeSlotChange={(slot) => patch({ slot })}
              />
              {priced?.ok && d.date && (
                <div className={priced.plan.sched === 'priority' ? 'ld-alert ld-alert-warning' : 'ld-alert ld-alert-info'}>
                  <Icon name="info" size={20} />
                  <div>
                    <b>{priced.plan.sched === 'priority' ? `Priority booking, +${money(pricing.sched.priorityP)} per visit` : 'Standard booking'}</b>
                    <p>
                      {priced.plan.sched === 'priority'
                        ? 'This date is within two working days, when a Pro is available. It changes when the job happens, never how well it’s done.'
                        : 'Base price, no adjustment.'}
                    </p>
                  </div>
                  <span />
                </div>
              )}
              {planError && (
                <p className="a-autherr" role="alert">
                  <Icon name="error" size={16} />
                  <span>{planError}</span>
                </p>
              )}
            </>
          )}

          {step === 4 && priced?.ok && property && (
            <>
              <div className="a-summary">
                <div className="line"><span>Property</span><b>{property.addressLine1}, {property.postcode}</b></div>
                <div className="line"><span>Scheduling</span><b>{priced.plan.sched === 'priority' ? 'Priority' : 'Standard'} · {d.date}</b></div>
              </div>
              {priced.plan.plans.map((p) => (
                <div key={p.service} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <b>{SERVICE_LABEL[p.service]}</b>
                    <b className="num">{p.mode === 'pay' ? money(p.totalP) : p.estLowP != null ? `${money(p.estLowP)} to ${money(p.estHighP ?? 0)}` : 'Quote to follow'}</b>
                  </div>
                  {p.lines.map((l, i) => (
                    <div key={i} className="mt-1 flex justify-between gap-4 text-sm text-muted-foreground">
                      <span>{l.d}{l.q > 1 ? ` × ${l.q}` : ''}</span>
                      <span className="num">{money(l.q * l.u)}</span>
                    </div>
                  ))}
                  {p.reason && <p className="mt-2 text-sm text-muted-foreground">{p.reason.charAt(0).toUpperCase() + p.reason.slice(1)}.</p>}
                </div>
              ))}
              <PromoCodeInput applied={promo} onApply={setPromo} onRemove={() => setPromo(null)} clientId={onBehalf?.clientId ?? null} />
              <div className="ld-alert ld-alert-info">
                <Icon name="info" size={20} />
                <div>
                  <b>What happens next</b>
                  <p>
                    {priced.plan.payNowP > 0
                      ? `You pay ${money(priced.plan.payNowP)} now. It’s secured until you approve the finished job.`
                      : 'LISTD sends you a fixed quote. Nothing is charged until you accept it and pay.'}
                    {priced.plan.payNowP > 0 && priced.plan.plans.some((p) => p.mode === 'quote') ? ' Anything still to be quoted is paid separately.' : ''}
                  </p>
                </div>
                <span />
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-3">
            {step > 0 && (
              <button type="button" className="ld-btn ld-btn-secondary" onClick={() => setStep(step - 1)} disabled={submitting}>
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="ld-btn ld-btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue
              </button>
            ) : (
              <button type="button" className="ld-btn ld-btn-primary ld-btn-lg" onClick={submit} disabled={!canNext || submitting}>
                {submitting ? 'Booking...' : priced?.ok && priced.plan.payNowP > 0 ? `Book and pay ${money(priced.plan.payNowP)}` : 'Submit booking'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
