'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  Home,
  Loader2,
  MapPin,
  PoundSterling,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { usePostcodeLookup } from '@/lib/hooks/use-postcode-lookup'
import { PropertyPhotoUploader } from './property-photo-uploader'
import {
  DWELLING_TYPES,
  DWELLING_TYPE_LABELS,
} from '@/lib/property/dwelling'
import {
  computeClientPrice,
  FURNISHED_STATUS_LABELS,
  FURNISHED_STATUSES,
  PROPERTY_SIZES,
  PROPERTY_TYPE_LABELS,
  type ClientPropertyFeatures,
  type FurnishedStatus,
  type PricingMatrices,
  type PropertySize,
  type ServiceTier,
} from '@/lib/pricing-matrix'

/** Pricing context the booking flow passes so the form can show a live
 *  price breakdown as the client picks Type (size) + Furnished. Optional —
 *  when omitted (e.g. a property editor used outside booking) the form
 *  simply renders without the price panel. */
export type PropertyFormPricing = {
  matrices: PricingMatrices
  inspectionTypes: string[]
  tier: ServiceTier
}

export type PropertyFormData = {
  addressLine1: string
  addressLine2: string
  city: string
  postcode: string
  propertyType: PropertySize
  /** 0039 — flat / house / …. `propertyType` above is the bed COUNT and
   *  always was; this is the kind of building. Empty string = not stated. */
  dwellingType: string
  /** 0039 — optional property photo; becomes the job-card thumbnail. */
  imageUrl: string | null
  bedrooms: number
  bathrooms: number
  kitchens: number
  livingRooms: number
  diningAreas: number
  utilityRooms: number
  storageRooms: number
  hallwaysStairs: number
  gardens: number
  communalAreas: number
  furnishedStatus: FurnishedStatus
  heavilyFurnished: boolean
  notes: string
}

/** Radix `Select` reserves the empty string, so "no answer" needs its own
 *  token. Mapped back to '' on the way into form state. */
const UNSET = '__unset__'

const ROOM_PRESETS: Record<PropertySize, Partial<PropertyFormData>> = {
  studio: { bedrooms: 0 },
  '1_bed': { bedrooms: 1 },
  '2_bed': { bedrooms: 2 },
  '3_bed': { bedrooms: 3 },
  '4_bed': { bedrooms: 4 },
  '5_bed': { bedrooms: 5 },
  '6_bed': { bedrooms: 6 },
  '7_bed': { bedrooms: 7 },
  '8_bed': { bedrooms: 8 },
  '9_bed': { bedrooms: 9 },
}

const ROOM_FIELDS: Array<{
  key: keyof PropertyFormData
  label: string
  hint: string
}> = [
  { key: 'bedrooms', label: 'Bedrooms', hint: 'Sleeping rooms incl. box rooms.' },
  { key: 'bathrooms', label: 'Bathrooms', hint: 'Full bathrooms, en-suites, separate WCs.' },
  { key: 'kitchens', label: 'Kitchens', hint: 'Cooking areas; kitchenettes count.' },
  { key: 'livingRooms', label: 'Living rooms', hint: 'Lounges, sitting rooms, TV rooms.' },
  { key: 'diningAreas', label: 'Dining areas', hint: 'Dedicated dining rooms.' },
  { key: 'hallwaysStairs', label: 'Hallways', hint: 'Halls, corridors, landings, stairs.' },
  { key: 'utilityRooms', label: 'Utility', hint: 'Utility rooms, washing/drying rooms.' },
  { key: 'storageRooms', label: 'Storage', hint: 'Walk-in cupboards, lofts, etc.' },
  { key: 'gardens', label: 'Gardens', hint: 'Private gardens, terraces, balconies.' },
  { key: 'communalAreas', label: 'Communal', hint: 'Shared halls, gardens, bin stores.' },
]

const DEFAULT_DATA: PropertyFormData = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  postcode: '',
  propertyType: '2_bed',
  dwellingType: '',
  imageUrl: null,
  bedrooms: 2,
  bathrooms: 1,
  kitchens: 1,
  livingRooms: 1,
  diningAreas: 0,
  utilityRooms: 0,
  storageRooms: 0,
  hallwaysStairs: 0,
  gardens: 0,
  communalAreas: 0,
  furnishedStatus: 'unfurnished',
  heavilyFurnished: false,
  notes: '',
}

type Props = {
  initial?: Partial<PropertyFormData>
  onSubmit: (data: PropertyFormData) => Promise<void>
  onCancel: () => void
  submitting?: boolean
  submitLabel?: string
  /** When provided, a live price breakdown + total renders above the
   *  Save button, reflecting the Type (size) + Furnished selections. */
  pricing?: PropertyFormPricing
}

export function PropertyForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  submitLabel = 'Save property',
  pricing,
}: Props) {
  const [data, setData] = useState<PropertyFormData>({
    ...DEFAULT_DATA,
    ...initial,
  })

  // Track whether the city was auto-filled by postcode lookup. If the user
  // edits city manually, lock it so subsequent lookups don't overwrite.
  const cityManuallyEditedRef = useRef(false)
  const lookup = usePostcodeLookup(data.postcode)

  // Auto-fill city when a postcode resolves and the user hasn't typed
  // their own city. Also normalises postcode to the API's canonical
  // capitalised form (e.g. "sw1a1aa" → "SW1A 1AA").
  useEffect(() => {
    if (lookup.state !== 'valid') return
    setData((prev) => {
      const next = { ...prev }
      if (prev.postcode !== lookup.postcode) {
        next.postcode = lookup.postcode
      }
      if (!cityManuallyEditedRef.current && lookup.city) {
        next.city = lookup.city
      }
      return next
    })
  }, [lookup])

  function update<K extends keyof PropertyFormData>(
    key: K,
    value: PropertyFormData[K]
  ) {
    if (key === 'propertyType') {
      const preset = ROOM_PRESETS[value as PropertySize]
      setData((prev) => ({ ...prev, propertyType: value as PropertySize, ...preset }))
      return
    }
    if (key === 'city') {
      cityManuallyEditedRef.current = true
    }
    setData((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    await onSubmit(data)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Address */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-foreground">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Address
          </h3>
        </div>
        <div className="space-y-2">
          <Field
            id="addressLine1"
            label="Address line 1"
            required
            value={data.addressLine1}
            onChange={(v) => update('addressLine1', v)}
            placeholder="123 High Street"
          />
          <Field
            id="addressLine2"
            label="Address line 2"
            value={data.addressLine2}
            onChange={(v) => update('addressLine2', v)}
            placeholder="Flat 2, Building Name"
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              id="city"
              label="City"
              required
              value={data.city}
              onChange={(v) => update('city', v)}
              placeholder="London"
            />
            <div>
              <Label
                htmlFor="postcode"
                className="flex items-center gap-1.5 text-xs"
              >
                <span>
                  Postcode <span className="text-destructive">*</span>
                </span>
                {lookup.state === 'loading' && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                {lookup.state === 'valid' && (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                )}
                {lookup.state === 'invalid' && (
                  <XCircle className="h-3 w-3 text-destructive" />
                )}
              </Label>
              <Input
                id="postcode"
                value={data.postcode}
                onChange={(e) =>
                  update('postcode', e.target.value.toUpperCase())
                }
                placeholder="SW1A 1AA"
                required
                className="mt-1 h-9 text-xs"
              />
              {lookup.state === 'valid' && (
                <p className="mt-1 text-[10px] text-emerald-600">
                  {lookup.city}
                  {lookup.region && lookup.region !== lookup.city
                    ? ` · ${lookup.region}`
                    : ''}
                </p>
              )}
              {lookup.state === 'invalid' && (
                <p className="mt-1 text-[10px] text-destructive">
                  Postcode not recognised. Double-check the spelling.
                </p>
              )}
              {lookup.state === 'error' && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Lookup unavailable: keep typing, the address will save
                  regardless.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Property type + furnishing */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-foreground">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Property details
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label htmlFor="dwellingType" className="text-xs">
              Property kind
            </Label>
            <Select
              value={data.dwellingType || UNSET}
              onValueChange={(v) =>
                update('dwellingType', v === UNSET ? '' : v)
              }
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Not stated" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET} className="text-xs">
                  Not stated
                </SelectItem>
                {DWELLING_TYPES.map((d) => (
                  <SelectItem key={d} value={d} className="text-xs">
                    {DWELLING_TYPE_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Flat, house, maisonette… tells the clerk what they&apos;re
              walking into. &ldquo;Size&rdquo; below is the bedroom count.
            </p>
          </div>
          <div>
            <Label htmlFor="propertyType" className="text-xs">
              Size *
            </Label>
            <Select
              value={data.propertyType}
              onValueChange={(v) => update('propertyType', v as PropertySize)}
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_SIZES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {PROPERTY_TYPE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="furnishedStatus" className="text-xs">
              Furnished *
            </Label>
            <Select
              value={data.furnishedStatus}
              onValueChange={(v) =>
                update('furnishedStatus', v as FurnishedStatus)
              }
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FURNISHED_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {FURNISHED_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <PropertyPhotoUploader
          value={data.imageUrl}
          onChange={(url) => update('imageUrl', url)}
          disabled={submitting}
        />
      </section>

      {/* Rooms */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-foreground">
          <Home className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Rooms
          </h3>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Optional: helps the clerk prepare for the inspection.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {ROOM_FIELDS.map((f) => (
            <div key={f.key}>
              <Label
                htmlFor={f.key}
                className="text-xs"
                title={f.hint}
              >
                {f.label}
              </Label>
              <Input
                id={f.key}
                type="number"
                min={0}
                max={20}
                value={data[f.key] as number}
                onChange={(e) =>
                  update(f.key, Number.parseInt(e.target.value, 10) || 0)
                }
                className="mt-1 h-9 text-xs"
              />
            </div>
          ))}
        </div>
      </section>

      <div>
        <Label htmlFor="notes" className="text-xs">
          Notes
        </Label>
        <Textarea
          id="notes"
          value={data.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Access instructions, parking details…"
          rows={2}
          className="mt-1 text-xs"
        />
      </div>

      {pricing && (
        <PricePanel
          size={data.propertyType}
          furnishing={data.furnishedStatus}
          features={{
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            livingRooms: data.livingRooms,
            diningAreas: data.diningAreas,
            kitchens: data.kitchens,
            gardens: data.gardens,
            communalAreas: data.communalAreas,
            hallwaysStairs: data.hallwaysStairs,
            utilityRooms: data.utilityRooms,
            storageRooms: data.storageRooms,
          }}
          pricing={pricing}
        />
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
          className="text-xs"
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting} className="text-xs">
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  )
}

/**
 * Live price breakdown shown inside the add-property form so the client
 * can see how their Type (size) + Furnished choices add up — full
 * transparency before they commit. Each selected inspection service is
 * itemised at the current size/tier/furnishing, then totalled.
 *
 * Room counts above their included-free baseline DO add to the client price
 * (per the admin-editable client add-on rates) and are itemised by
 * {@link computeClientPrice}'s breakdown, alongside property size + furnishing
 * + the chosen services.
 */
function PricePanel({
  size,
  furnishing,
  features,
  pricing,
}: {
  size: PropertySize
  furnishing: FurnishedStatus
  features: ClientPropertyFeatures
  pricing: PropertyFormPricing
}) {
  const { matrices, inspectionTypes, tier } = pricing
  const breakdown = useMemo(
    () =>
      computeClientPrice(matrices, {
        services: inspectionTypes,
        size,
        tier,
        furnishing,
        features,
      }),
    [matrices, inspectionTypes, size, tier, furnishing, features]
  )

  if (inspectionTypes.length === 0) return null

  return (
    <section className="space-y-2 rounded-lg border border-primary/20 bg-accent/5 p-3">
      <div className="flex items-center gap-1.5 text-foreground">
        <PoundSterling className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider">
          Price for this property
        </h3>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Based on {PROPERTY_TYPE_LABELS[size]} ·{' '}
        {FURNISHED_STATUS_LABELS[furnishing]} + the rooms below. Updates live
        as you edit Type, Furnished, or room counts.
      </p>
      <div className="space-y-1">
        {breakdown.services.map((l) => (
          <div
            key={l.type}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-muted-foreground">{l.label}</span>
            <span className="font-medium text-foreground">£{l.price}</span>
          </div>
        ))}
        {breakdown.addons.map((a, i) => (
          <div
            key={`${a.label}-${i}`}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-medium text-foreground">£{a.amount}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-primary/20 pt-2">
        <span className="text-sm font-semibold text-foreground">Total</span>
        <span className="text-lg font-bold text-primary">
          £{breakdown.subtotal}
        </span>
      </div>
      <p className="text-[9px] leading-tight text-muted-foreground">
        Payment is processed upon report approval in line with LISTD terms.
        Short-notice surcharges (if any) are shown at the review step.
      </p>
    </section>
  )
}

function Field({
  id,
  label,
  required,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  required?: boolean
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 h-9 text-xs"
      />
    </div>
  )
}
