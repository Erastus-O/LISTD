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
import { isValidUkPhone } from '@/lib/uk-phone'
import { createClient } from '@/lib/supabase/client'

const STEPS = [
  { label: 'Identity', icon: User },
  { label: 'Coverage', icon: MapPin },
  { label: 'Documents', icon: ShieldCheck },
] as const

type Props = {
  userId: string
  initial: {
    fullName: string
    phone: string
    emergencyContactName: string
    emergencyContactPhone: string
    coverageAreas: string[]
  }
  rejectionReason: string | null
}

type UploadedDoc = { path: string; uploading: boolean }

/**
 * Cleaner verification onboarding — a streamlined 3-step form that submits all
 * fields at once to POST /api/onboarding/cleaner/submit (unlike the clerk flow,
 * which saves per step). Documents upload to the shared `clerk-documents`
 * bucket. Cleaners perform all three clean levels, so there's no service-type
 * picker — the server seeds those.
 */
export function CleanerOnboarding({ userId, initial, rejectionReason }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Step 0 — identity
  const [fullName, setFullName] = useState(initial.fullName)
  const [phone, setPhone] = useState(initial.phone)
  const [emergencyName, setEmergencyName] = useState(initial.emergencyContactName)
  const [emergencyPhone, setEmergencyPhone] = useState(
    initial.emergencyContactPhone
  )
  const [govId, setGovId] = useState<UploadedDoc>({ path: '', uploading: false })
  const [govIdExpiry, setGovIdExpiry] = useState('')

  // Step 1 — coverage
  const [coverageAreas, setCoverageAreas] = useState<string[]>(
    initial.coverageAreas
  )
  const [coverageInput, setCoverageInput] = useState('')

  // Step 2 — documents
  const [dbs, setDbs] = useState<UploadedDoc>({ path: '', uploading: false })
  const [dbsExpiry, setDbsExpiry] = useState('')
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
    if (step === 1) return coverageAreas.length > 0
    if (step === 2) {
      return (
        dbs.path !== '' &&
        dbsExpiry !== '' &&
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
      const path = `${userId}/cleaner_${docType}_${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('clerk-documents')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      setDoc({ path, uploading: false })
    } catch (err) {
      console.error('[onboarding/cleaner] upload failed:', err)
      toast.error('Upload failed', {
        description:
          err instanceof Error
            ? err.message
            : 'Bucket may not be set up yet: apply clerk_documents_bucket.sql.',
      })
      setDoc({ path: '', uploading: false })
    }
  }

  async function submit() {
    setSubmitting(true)
    try {
      const body = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        governmentIdUrl: govId.path,
        ...(govIdExpiry ? { governmentIdExpiry: govIdExpiry } : {}),
        emergencyContactName: emergencyName.trim(),
        emergencyContactPhone: emergencyPhone.trim(),
        coverageAreas,
        dbsCertificateUrl: dbs.path,
        dbsExpiry,
        insuranceUrl: insurance.path,
        insuranceExpiry,
        insuranceProvider: insuranceProvider.trim(),
        ...(coverAmount.trim() ? { coverAmount: coverAmount.trim() } : {}),
      }
      const res = await fetch('/api/onboarding/cleaner/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await asError(res)
      toast.success('Application submitted', {
        description:
          "We'll review your documents and let you know: usually within 24 hours.",
      })
      router.push('/cleaner/dashboard')
      router.refresh()
    } catch (err) {
      toast.error('Could not submit', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setSubmitting(false)
    }
  }

  function handleNext() {
    if (!canProceed()) return
    if (step < STEPS.length - 1) setStep((s) => s + 1)
    else submit()
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

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            Cleaner verification
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
                className={`text-[10px] ${
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
                  placeholder="e.g. Maria Santos"
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
                <h2 className="text-lg font-semibold">Coverage areas</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                The postcode districts you&rsquo;re willing to travel to for
                cleaning jobs. You can change these later in settings.
              </p>

              <FieldGroup label="Postcode districts you cover" required>
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
                    placeholder="e.g. BS1"
                    maxLength={6}
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
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">DBS & Insurance</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Expiry dates drive our 60-day pre-renewal reminders — please
                double-check them.
              </p>

              <DocUpload
                label="Enhanced DBS certificate"
                desc="PDF or photograph of the certificate"
                doc={dbs}
                onUpload={(f) => uploadDoc('dbs', f, setDbs)}
                accept="image/*,application/pdf"
                required
              />
              <FieldGroup label="DBS expiry date" required>
                <Input
                  type="date"
                  value={dbsExpiry}
                  onChange={(e) => setDbsExpiry(e.target.value)}
                />
              </FieldGroup>

              <div className="border-t border-border pt-4">
                <div className="mb-3 flex items-center gap-2">
                  <IdCard className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">
                    Public Liability Insurance
                  </p>
                </div>
                <div className="space-y-4">
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
                        placeholder="e.g. Simply Business"
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
                  <FieldGroup label="Insurance expiry date" required>
                    <Input
                      type="date"
                      value={insuranceExpiry}
                      onChange={(e) => setInsuranceExpiry(e.target.value)}
                    />
                  </FieldGroup>
                </div>
              </div>
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
