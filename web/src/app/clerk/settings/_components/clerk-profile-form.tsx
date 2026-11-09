'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Languages, Loader2, MapPin, Phone, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const LANGUAGE_OPTIONS = [
  'English',
  'Polish',
  'Romanian',
  'Hindi',
  'Urdu',
  'Bengali',
  'Punjabi',
  'Arabic',
  'French',
  'Spanish',
  'Portuguese',
] as const

type Props = {
  initial: {
    fullName: string | null
    phone: string | null
    coverageAreas: string[]
    serviceTypesOffered: string[]
    languages: string[]
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    email: string | null
  }
  /** Resolved server-side from `getBookableServices(getEffectivePricing())`
   *  so admin-defined custom types (added on /admin/pricing) show up here
   *  too. Was previously a hardcoded list, which left clerks unable to
   *  offer half the live services — including new_inventory. */
  services: ReadonlyArray<{ key: string; label: string }>
}

/**
 * Editable clerk profile form (Lovable port of `ClerkProfile.tsx`).
 *
 * Verification-affecting fields (DBS, insurance, qualification, gov ID)
 * intentionally absent — those route through `/onboarding/clerk` so changes
 * trigger admin re-verification.
 *
 * Coverage Areas takes a comma-separated list. A full postcode entry
 * (e.g. `BS6 7SA`) covers a 25 km radius around it; a district entry
 * (e.g. `BS6`) matches that district exactly. See lib/coverage-radius.ts.
 */
export function ClerkProfileForm({ initial, services }: Props) {
  const router = useRouter()
  const serviceKeys = services.map((s) => s.key)
  const [fullName, setFullName] = useState(initial.fullName ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [coverageAreasText, setCoverageAreasText] = useState(
    initial.coverageAreas.join(', ')
  )
  // Defensive init: drop any values that aren't in the current live
  // service list. Legacy / migrated data may carry stray entries (renamed
  // enum values, label-instead-of-value, dupes) that the toggles don't
  // render but would still be sent on submit and fail server-side
  // validation.
  const [serviceTypes, setServiceTypes] = useState<string[]>(() =>
    Array.from(
      new Set(
        initial.serviceTypesOffered.filter((v) => serviceKeys.includes(v))
      )
    )
  )
  const [languages, setLanguages] = useState<string[]>(initial.languages)
  const [emergencyName, setEmergencyName] = useState(
    initial.emergencyContactName ?? ''
  )
  const [emergencyPhone, setEmergencyPhone] = useState(
    initial.emergencyContactPhone ?? ''
  )
  const [saving, setSaving] = useState(false)

  function toggleService(value: string) {
    setServiceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  function toggleLanguage(value: string) {
    setLanguages((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  async function handleSave() {
    if (saving) return
    if (!fullName.trim()) {
      toast.error('Full name is required')
      return
    }
    setSaving(true)
    try {
      const coverageAreas = coverageAreasText
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      const res = await fetch('/api/clerk/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          coverageAreas,
          serviceTypesOffered: serviceTypes,
          languages,
          emergencyContactName: emergencyName.trim() || null,
          emergencyContactPhone: emergencyPhone.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Profile saved')
      router.refresh()
    } catch (err) {
      toast.error('Could not save profile', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <User className="h-4 w-4" />
            Personal Details
          </h2>
          <Field id="email" label="Email">
            <Input
              id="email"
              value={initial.email ?? ''}
              disabled
              className="bg-muted/50"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Email is read-only: contact support to change it.
            </p>
          </Field>
          <Field id="fullName" label="Full Name *">
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field id="phone" label="Phone">
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
              placeholder="+44…"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4" />
            Coverage &amp; Services
          </h2>
          <Field id="coverage" label="Coverage Areas">
            <Input
              id="coverage"
              value={coverageAreasText}
              onChange={(e) => setCoverageAreasText(e.target.value)}
              disabled={saving}
              placeholder="BS6 7SA, BS7, SW1…"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Comma-separated. A <strong>full postcode</strong> (
              <code className="rounded bg-muted px-1 font-mono">BS6 7SA</code>)
              covers everything within <strong>25&nbsp;km</strong> of it. A
              district (
              <code className="rounded bg-muted px-1 font-mono">BS6</code>)
              covers that district exactly.
            </p>
          </Field>
          <div>
            <Label className="mb-2 block">Service Types Offered</Label>
            <div className="flex flex-wrap gap-2">
              {services.map((opt) => {
                const active = serviceTypes.includes(opt.key)
                return (
                  <label
                    key={opt.key}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 cursor-pointer"
                      checked={active}
                      onChange={() => toggleService(opt.key)}
                      disabled={saving}
                    />
                    {opt.label}
                  </label>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Empty = show every type. Pick a subset to filter the available-jobs
              feed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Languages className="h-4 w-4" />
            Additional Details
          </h2>
          <div>
            <Label className="mb-2 block">Languages Spoken</Label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const active = languages.includes(lang)
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    disabled={saving}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {lang}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Phone className="h-4 w-4" />
            Emergency Contact
          </h2>
          <Field id="emergencyName" label="Contact Name">
            <Input
              id="emergencyName"
              value={emergencyName}
              onChange={(e) => setEmergencyName(e.target.value)}
              disabled={saving}
              placeholder="Full name"
            />
          </Field>
          <Field id="emergencyPhone" label="Contact Phone">
            <Input
              id="emergencyPhone"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              disabled={saving}
              placeholder="+44…"
            />
          </Field>
        </CardContent>
      </Card>

      <Button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full gap-1.5"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save Changes
      </Button>
    </div>
  )
}

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  )
}
