'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck,
  IdCard,
  Loader2,
  MapPin,
  ShieldCheck,
  Upload,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isValidUkPhone } from '@/lib/uk-phone'
import { createClient } from '@/lib/supabase/client'

const STEPS = [
  { label: 'Identity & Profile', icon: User },
  { label: 'Coverage & Services', icon: MapPin },
  { label: 'DBS', icon: ShieldCheck },
  { label: 'Qualifications', icon: FileCheck },
  { label: 'Insurance', icon: IdCard },
] as const

const QUALIFICATION_KINDS = [
  { value: 'arla', label: 'ARLA Propertymark' },
  { value: 'nfopp', label: 'NFOPP' },
  { value: 'rics', label: 'RICS' },
  { value: 'listd_academy', label: 'LISTD Academy' },
  { value: 'other', label: 'Other' },
]

type Props = {
  userId: string
  initial: {
    fullName: string
    phone: string
    emergencyContactName: string
    emergencyContactPhone: string
    coverageAreas: string[]
    serviceTypesOffered: string[]
    languages: string[]
  }
  rejectionReason: string | null
  /** Live service list (built-ins + admin-defined custom types). Resolved
   *  on the server from `getBookableServices(getEffectivePricing())` so the
   *  set the clerk picks from matches the keys the booking flow actually
   *  creates jobs with — the old hardcoded list was out of sync, e.g.
   *  'Inventory' saved as 'inventory' but bookings use 'new_inventory'. */
  serviceOptions: ReadonlyArray<{ key: string; label: string }>
}

type UploadedDoc = {
  path: string
  uploading: boolean
}

export function ClerkOnboarding({
  userId,
  initial,
  rejectionReason,
  serviceOptions,
}: Props) {
  const validServiceKeys = serviceOptions.map((s) => s.key)
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [fullName, setFullName] = useState(initial.fullName)
  const [phone, setPhone] = useState(initial.phone)
  const [emergencyName, setEmergencyName] = useState(initial.emergencyContactName)
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergencyContactPhone)
  const [govId, setGovId] = useState<UploadedDoc>({ path: '', uploading: false })
  const [govIdExpiry, setGovIdExpiry] = useState('')

  // Step 2
  const [coverageAreas, setCoverageAreas] = useState<string[]>(
    initial.coverageAreas
  )
  const [coverageInput, setCoverageInput] = useState('')
  // Filter the saved list against the live service set on mount so renamed
  // / removed keys (e.g. legacy 'inventory') don't get re-submitted.
  const [services, setServices] = useState<string[]>(() =>
    initial.serviceTypesOffered.filter((v) => validServiceKeys.includes(v))
  )
  const [languages, setLanguages] = useState<string[]>(initial.languages)
  const [languageInput, setLanguageInput] = useState('')

  // Step 3
  const [dbs, setDbs] = useState<UploadedDoc>({ path: '', uploading: false })
  const [dbsExpiry, setDbsExpiry] = useState('')

  // Step 4
  const [qualKind, setQualKind] = useState('')
  const [qualDoc, setQualDoc] = useState<UploadedDoc>({
    path: '',
    uploading: false,
  })

  // Step 5
  const [insurance, setInsurance] = useState<UploadedDoc>({
    path: '',
    uploading: false,
  })
  const [insuranceExpiry, setInsuranceExpiry] = useState('')
  const [insuranceProvider, setInsuranceProvider] = useState('')
  const [coverAmount, setCoverAmount] = useState('')

  function canProceed() {
    if (step === 0) {
      return (
        fullName.trim() !== '' &&
        isValidUkPhone(phone) &&
        emergencyName.trim() !== '' &&
        isValidUkPhone(emergencyPhone) &&
        govId.path !== ''
      )
    }
    if (step === 1) {
      return coverageAreas.length > 0 && services.length > 0
    }
    if (step === 2) return dbs.path !== '' && dbsExpiry !== ''
    if (step === 3) return qualKind !== '' && qualDoc.path !== ''
    if (step === 4) {
      return (
        insurance.path !== '' &&
        insuranceExpiry !== '' &&
        insuranceProvider.trim() !== ''
      )
    }
    return false
  }

  async function uploadDoc(
    docType: string,
    file: File,
    setDoc: (d: UploadedDoc) => void
  ) {
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File too large', { description: 'Max 8 MB.' })
      return
    }
    setDoc({ path: '', uploading: true })
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'pdf'
      const path = `${userId}/${docType}_${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('clerk-documents')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      setDoc({ path, uploading: false })
    } catch (err) {
      console.error('[onboarding/clerk] upload failed:', err)
      toast.error('Upload failed', {
        description:
          err instanceof Error
            ? err.message
            : 'Bucket may not be set up yet: apply clerk_documents_bucket.sql.',
      })
      setDoc({ path: '', uploading: false })
    }
  }

  async function postStep(): Promise<boolean> {
    setSubmitting(true)
    try {
      let url: string
      let body: Record<string, unknown>
      if (step === 0) {
        url = '/api/onboarding/clerk/identity'
        body = {
          fullName: fullName.trim(),
          phone: phone.trim(),
          emergencyContactName: emergencyName.trim(),
          emergencyContactPhone: emergencyPhone.trim(),
          governmentIdUrl: govId.path,
          ...(govIdExpiry ? { governmentIdExpiry: govIdExpiry } : {}),
        }
      } else if (step === 1) {
        url = '/api/onboarding/clerk/coverage'
        body = {
          coverageAreas,
          serviceTypesOffered: services,
          ...(languages.length > 0 ? { languages } : {}),
        }
      } else if (step === 2) {
        url = '/api/onboarding/clerk/dbs'
        body = { dbsCertificateUrl: dbs.path, dbsExpiry }
      } else if (step === 3) {
        url = '/api/onboarding/clerk/qualification'
        body = { qualificationKind: qualKind, qualificationUrl: qualDoc.path }
      } else {
        url = '/api/onboarding/clerk/insurance'
        body = {
          insuranceUrl: insurance.path,
          insuranceExpiry,
          insuranceProvider: insuranceProvider.trim(),
          ...(coverAmount.trim() ? { coverAmount: coverAmount.trim() } : {}),
        }
      }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await asError(res)
      return true
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function handleNext() {
    if (!canProceed()) return
    const ok = await postStep()
    if (!ok) return
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      toast.success('Application submitted', {
        description: "We'll review your documents and let you know: usually within 24 hours.",
      })
      router.push('/clerk/dashboard')
      router.refresh()
    }
  }

  function handleBack() {
    if (step === 0 || submitting) return
    setStep((s) => s - 1)
  }

  function addCoverage() {
    const pc = coverageInput.trim().toUpperCase()
    if (!pc || coverageAreas.includes(pc)) return
    setCoverageAreas([...coverageAreas, pc])
    setCoverageInput('')
  }
  function addLanguage() {
    const l = languageInput.trim()
    if (!l || languages.includes(l)) return
    setLanguages([...languages, l])
    setLanguageInput('')
  }
  function toggleService(v: string) {
    setServices((prev) =>
      prev.includes(v) ? prev.filter((s) => s !== v) : [...prev, v]
    )
  }

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            Pro verification
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
        </header>

        {rejectionReason && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              Previous application returned
            </div>
            <p className="text-muted-foreground">{rejectionReason}</p>
            <p className="mt-1 text-muted-foreground">
              Update the affected documents and resubmit.
            </p>
          </div>
        )}

        <div className="mb-8 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`h-1.5 w-full rounded-full transition-colors ${
                  i <= step ? 'bg-primary' : 'bg-border'
                }`}
              />
              <span
                className={`hidden text-[10px] sm:block ${
                  i <= step ? 'font-medium text-primary' : 'text-muted-foreground'
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Identity & Profile</h2>
              </div>

              <FieldGroup label="Full name" required>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. James Wilson"
                  maxLength={100}
                />
              </FieldGroup>

              <FieldGroup label="Phone number" required>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+44 7700 900000"
                  maxLength={20}
                />
                {phone && !isValidUkPhone(phone) && (
                  <p className="mt-1 text-xs text-destructive">
                    Enter a valid UK phone number.
                  </p>
                )}
              </FieldGroup>

              <DocUpload
                label="Government-issued photo ID"
                desc="Passport or driving licence"
                doc={govId}
                onUpload={(f) => uploadDoc('government_id', f, setGovId)}
                accept="image/*,application/pdf"
                required
              />

              <FieldGroup label="ID expiry">
                <Input
                  type="date"
                  value={govIdExpiry}
                  onChange={(e) => setGovIdExpiry(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional — leave blank for passports / non-expiring IDs.
                </p>
              </FieldGroup>

              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm font-medium">Emergency contact</p>
                <div className="space-y-4">
                  <FieldGroup label="Name" required>
                    <Input
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      placeholder="Next of kin / emergency contact"
                      maxLength={100}
                    />
                  </FieldGroup>
                  <FieldGroup label="Phone" required>
                    <Input
                      value={emergencyPhone}
                      onChange={(e) => setEmergencyPhone(e.target.value)}
                      placeholder="+44 7700 900000"
                      maxLength={20}
                    />
                    {emergencyPhone && !isValidUkPhone(emergencyPhone) && (
                      <p className="mt-1 text-xs text-destructive">
                        Enter a valid UK phone number.
                      </p>
                    )}
                  </FieldGroup>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Coverage & Services</h2>
              </div>

              <FieldGroup label="Postcodes you cover" required>
                <p className="text-xs text-muted-foreground">
                  Add your base postcode(s) — each full postcode covers a
                  25&nbsp;km radius around it. You can also add district
                  prefixes (e.g. BS6) to cover a district exactly.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={coverageInput}
                    onChange={(e) => setCoverageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCoverage()
                      }
                    }}
                    placeholder="e.g. BS6 7SA"
                    maxLength={8}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCoverage}
                  >
                    Add
                  </Button>
                </div>
                <ChipList
                  items={coverageAreas}
                  onRemove={(pc) =>
                    setCoverageAreas(coverageAreas.filter((p) => p !== pc))
                  }
                />
              </FieldGroup>

              <FieldGroup label="Service types offered" required>
                <div className="space-y-2">
                  {serviceOptions.map((svc) => (
                    <label
                      key={svc.key}
                      className="flex cursor-pointer items-center gap-3"
                    >
                      <input
                        type="checkbox"
                        checked={services.includes(svc.key)}
                        onChange={() => toggleService(svc.key)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="text-sm">{svc.label}</span>
                    </label>
                  ))}
                </div>
              </FieldGroup>

              <FieldGroup label="Languages spoken">
                <div className="flex gap-2">
                  <Input
                    value={languageInput}
                    onChange={(e) => setLanguageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addLanguage()
                      }
                    }}
                    placeholder="e.g. Polish"
                    maxLength={40}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addLanguage}
                  >
                    Add
                  </Button>
                </div>
                <ChipList
                  items={languages}
                  onRemove={(l) =>
                    setLanguages(languages.filter((p) => p !== l))
                  }
                />
              </FieldGroup>

            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">DBS Certificate</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Upload your Enhanced DBS certificate. The expiry drives our
                60-day pre-renewal reminders — please double-check.
              </p>

              <DocUpload
                label="Enhanced DBS certificate"
                desc="PDF or photograph of the certificate"
                doc={dbs}
                onUpload={(f) => uploadDoc('dbs', f, setDbs)}
                accept="image/*,application/pdf"
                required
              />

              <FieldGroup label="Expiry date" required>
                <Input
                  type="date"
                  value={dbsExpiry}
                  onChange={(e) => setDbsExpiry(e.target.value)}
                />
              </FieldGroup>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Qualifications</h2>
              </div>

              <FieldGroup label="Qualification" required>
                <Select value={qualKind} onValueChange={setQualKind}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select your highest qualification" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALIFICATION_KINDS.map((q) => (
                      <SelectItem key={q.value} value={q.value}>
                        {q.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>

              <DocUpload
                label="Certificate"
                desc="Upload the awarding-body certificate"
                doc={qualDoc}
                onUpload={(f) => uploadDoc('qualification', f, setQualDoc)}
                accept="image/*,application/pdf"
                required
              />
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <IdCard className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  Professional Indemnity Insurance
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Upload your insurance certificate. The expiry drives our 60-day
                renewal reminders.
              </p>

              <DocUpload
                label="Insurance certificate"
                desc="Schedule or full policy document"
                doc={insurance}
                onUpload={(f) => uploadDoc('insurance', f, setInsurance)}
                accept="image/*,application/pdf"
                required
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldGroup label="Provider" required>
                  <Input
                    value={insuranceProvider}
                    onChange={(e) => setInsuranceProvider(e.target.value)}
                    placeholder="e.g. Hiscox"
                    maxLength={100}
                  />
                </FieldGroup>
                <FieldGroup label="Cover amount">
                  <Input
                    value={coverAmount}
                    onChange={(e) => setCoverAmount(e.target.value)}
                    placeholder="e.g. £1m"
                    maxLength={40}
                  />
                </FieldGroup>
              </div>

              <FieldGroup label="Expiry date" required>
                <Input
                  type="date"
                  value={insuranceExpiry}
                  onChange={(e) => setInsuranceExpiry(e.target.value)}
                />
              </FieldGroup>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleBack}
            disabled={step === 0 || submitting}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <Button
            type="button"
            onClick={handleNext}
            disabled={!canProceed() || submitting}
            className="gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : step === STEPS.length - 1 ? (
              <>
                <Check className="h-4 w-4" />
                Submit for review
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  )
}

function FieldGroup({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function ChipList({
  items,
  onRemove,
}: {
  items: string[]
  onRemove: (item: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs"
        >
          {it}
          <button
            type="button"
            onClick={() => onRemove(it)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${it}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

function DocUpload({
  label,
  desc,
  doc,
  onUpload,
  accept,
  required,
}: {
  label: string
  desc?: string
  doc: UploadedDoc
  onUpload: (file: File) => void
  accept: string
  required?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-2">
        <p className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
        {doc.uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : doc.path ? (
          <FileCheck className="h-4 w-4 text-primary" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        <span>
          {doc.uploading
            ? 'Uploading…'
            : doc.path
              ? 'Replace file'
              : 'Choose file (max 8 MB)'}
        </span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
          }}
          disabled={doc.uploading}
        />
      </label>
      {doc.path && !doc.uploading && (
        <p className="mt-2 text-xs text-muted-foreground">Uploaded.</p>
      )}
    </div>
  )
}

async function asError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return new Error(body.error)
  } catch {
    /* fall through */
  }
  return new Error(`HTTP ${res.status}`)
}
