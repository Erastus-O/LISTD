'use client'

import { Mail, Phone, User, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TenantData } from '@/lib/booking-types'

/** Hard ceiling so the list can't be abused. */
export const MAX_TENANTS = 10

const EMPTY_TENANT: TenantData = { fullName: '', email: '', phone: '' }

type Props = {
  tenants: TenantData[]
  onChange: (tenants: TenantData[]) => void
  /** Confirmed there's no tenant yet — waives the primary-name requirement. */
  noTenantConfirmed: boolean
  onNoTenantChange: (v: boolean) => void
}

/**
 * Step 6: tenant details — a dynamic list. Every job needs at least one named
 * tenant (so they can review + sign the report and pick an inspection slot),
 * UNLESS the client ticks "no tenant yet". The first entry is the primary
 * tenant; up to {@link MAX_TENANTS} can be added. Email + phone flow into
 * `tenant_details` rows at job creation so the tenant portal can email + resolve
 * a token later.
 */
export function TenantDetailsForm({
  tenants,
  onChange,
  noTenantConfirmed,
  onNoTenantChange,
}: Props) {
  // Defensive: always render at least the primary block.
  const list = tenants.length > 0 ? tenants : [EMPTY_TENANT]

  const update = (index: number, data: TenantData) => {
    onChange(list.map((t, i) => (i === index ? data : t)))
  }
  const add = () => {
    if (list.length >= MAX_TENANTS) return
    onChange([...list, { ...EMPTY_TENANT }])
  }
  const remove = (index: number) => {
    // Never remove the primary; keep at least one entry.
    if (index === 0 || list.length <= 1) return
    onChange(list.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Tenant details</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Add at least the primary tenant&rsquo;s name so they can review and
          sign the report and choose an inspection slot. An email lets us send
          them their portal link automatically.
        </p>
      </div>

      <fieldset
        disabled={noTenantConfirmed}
        className={noTenantConfirmed ? 'space-y-5 opacity-50' : 'space-y-5'}
      >
      {list.map((tenant, index) => (
        <div key={index}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
              <User className="h-3.5 w-3.5" />
              {index === 0 ? 'Primary tenant' : `Tenant ${index + 1}`}
            </h4>
            {index > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-destructive hover:text-destructive"
                onClick={() => remove(index)}
              >
                <X className="mr-1 h-3 w-3" />
                Remove
              </Button>
            )}
          </div>
          <TenantBlock
            data={tenant}
            onChange={(data) => update(index, data)}
            nameRequired={!noTenantConfirmed && index === 0}
            idPrefix={`tenant_${index}`}
          />
        </div>
      ))}

      {list.length < MAX_TENANTS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={add}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Add tenant
        </Button>
      )}
      </fieldset>

      <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground">
        <input
          type="checkbox"
          checked={noTenantConfirmed}
          onChange={(e) => onNoTenantChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
        />
        <span>
          There&rsquo;s no tenant for this property yet: I&rsquo;ll add their
          details later. I understand the tenant won&rsquo;t be able to choose a
          slot or sign the report until they&rsquo;re added.
        </span>
      </label>
    </div>
  )
}

function TenantBlock({
  data,
  onChange,
  nameRequired,
  idPrefix,
}: {
  data: TenantData
  onChange: (t: TenantData) => void
  nameRequired: boolean
  idPrefix: string
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}_name`} className="text-xs">
          Full name {nameRequired && <span className="text-destructive">*</span>}
        </Label>
        <Input
          id={`${idPrefix}_name`}
          value={data.fullName}
          onChange={(e) => onChange({ ...data, fullName: e.target.value })}
          placeholder="Tenant's full name"
          className="h-9 text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={`${idPrefix}_email`}
            className="flex items-center gap-1 text-xs"
          >
            <Mail className="h-3 w-3" /> Email
          </Label>
          <Input
            id={`${idPrefix}_email`}
            type="email"
            value={data.email}
            onChange={(e) => onChange({ ...data, email: e.target.value })}
            placeholder="tenant@email.com"
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={`${idPrefix}_phone`}
            className="flex items-center gap-1 text-xs"
          >
            <Phone className="h-3 w-3" /> Phone
          </Label>
          <Input
            id={`${idPrefix}_phone`}
            type="tel"
            value={data.phone}
            onChange={(e) => onChange({ ...data, phone: e.target.value })}
            placeholder="07xxx xxxxxx"
            className="h-9 text-xs"
          />
        </div>
      </div>
    </div>
  )
}
