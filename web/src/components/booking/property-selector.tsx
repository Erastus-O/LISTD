'use client'

import { useState } from 'react'
import { Building2, Check, MapPin, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FURNISHED_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type FurnishedStatus,
  type PropertySize,
} from '@/lib/pricing-matrix'
import type { BookingProperty } from '@/lib/booking-data'
import {
  PropertyForm,
  type PropertyFormData,
  type PropertyFormPricing,
} from './property-form'

type Props = {
  properties: BookingProperty[]
  selectedPropertyId: string | null
  onSelect: (propertyId: string) => void
  onPropertyCreated: (property: BookingProperty) => void
  defaultSize: PropertySize
  defaultFurnishing: FurnishedStatus
  /** Pricing context so the add-new form can show a live price breakdown
   *  as the client picks the property's Type + Furnished. */
  pricing?: PropertyFormPricing
  /** ADMIN on-behalf booking: new properties are created for this client. */
  createForClientId?: string | null
}

/**
 * Step 4: pick an existing property or expand the inline form to create a
 * new one. The Lovable version used a Dialog modal; this port uses an
 * inline-expand pattern (better mobile UX, no extra shadcn dep).
 */
export function PropertySelector({
  properties,
  selectedPropertyId,
  onSelect,
  onPropertyCreated,
  defaultSize,
  defaultFurnishing,
  pricing,
  createForClientId = null,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(data: PropertyFormData) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          ...(createForClientId ? { forClientId: createForClientId } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { property: BookingProperty }
      onPropertyCreated(json.property)
      onSelect(json.property.id)
      setShowForm(false)
      toast.success('Property added')
    } catch (err) {
      toast.error('Could not save property', {
        description:
          err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Select property
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose the property for this inspection
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs"
          onClick={() => setShowForm((v) => !v)}
          type="button"
        >
          {showForm ? (
            <>
              <X className="h-3.5 w-3.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Add new
            </>
          )}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4">
          <PropertyForm
            initial={{
              propertyType: defaultSize,
              furnishedStatus: defaultFurnishing,
              bedrooms: parseInt(defaultSize.replace('_bed', ''), 10) || 0,
            }}
            onSubmit={handleSubmit}
            onCancel={() => setShowForm(false)}
            submitting={submitting}
            submitLabel="Save & select"
            pricing={pricing}
          />
        </div>
      )}

      {!showForm && properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="mb-1 text-sm font-medium text-foreground">
            No properties yet
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Add your first property to book an inspection.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(true)}
            className="gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add property
          </Button>
        </div>
      ) : !showForm ? (
        <div className="space-y-2">
          {properties.map((p) => {
            const isSelected = selectedPropertyId === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-accent/5 ring-1 ring-accent/20'
                    : 'border-border bg-card hover:border-primary/30'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-2.5">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        isSelected ? 'bg-accent/10' : 'bg-muted'
                      )}
                    >
                      <Building2
                        className={cn(
                          'h-4 w-4',
                          isSelected ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {p.addressLine1}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {p.city}, {p.postcode}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {PROPERTY_TYPE_LABELS[p.propertyType as PropertySize] ?? p.propertyType}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {FURNISHED_STATUS_LABELS[
                            p.furnishedStatus as FurnishedStatus
                          ] ?? p.furnishedStatus}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
                      <Check className="h-3 w-3 text-accent-foreground" />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
