'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileSignature,
  Loader2,
  Upload,
  User,
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
import { Textarea } from '@/components/ui/textarea'
import { isValidUkPhone } from '@/lib/uk-phone'
import { namesMatch } from '@/lib/name-match'
import { createClient } from '@/lib/supabase/client'

type OrgChoice = 'create' | 'join' | 'individual' | null

const STEPS = [
  { label: 'Personal Details', icon: User },
  { label: 'Organisation', icon: Building2 },
  { label: 'Terms of Business', icon: FileSignature },
] as const

const ROLE_SUBTYPES = [
  { value: 'letting_agent', label: 'Letting Agent' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'housing_association', label: 'Housing Association' },
  { value: 'other', label: 'Other' },
]

const TERMS_BULLETS = [
  'LISTD Pro acts as a marketplace and escrow agent between you and verified clerks. We do not perform the inspection ourselves.',
  'You agree to pay the published rate-card price per job, with funds held in escrow until the report is delivered and accepted.',
  'Disputes go through the LISTD Pro dispute panel; outcomes are binding for the duration of the engagement.',
  'You will not solicit or engage clerks introduced via LISTD Pro outside the platform for 12 months: see the Non-Circumvention clause in the full Terms.',
  'You can withdraw consent at any time by closing your account; in-flight jobs will be honoured to completion.',
]

type Props = {
  initial: {
    fullName: string
    phone: string
    roleSubtype: string
  }
  userId: string
}

export function ClientOnboarding({ initial, userId }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [fullName, setFullName] = useState(initial.fullName)
  const [phone, setPhone] = useState(initial.phone)
  const [roleSubtype, setRoleSubtype] = useState(initial.roleSubtype)

  // Step 2
  const [orgChoice, setOrgChoice] = useState<OrgChoice>(null)
  const [orgName, setOrgName] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [companyReg, setCompanyReg] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)

  // Step 3
  const [signature, setSignature] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  function canProceed() {
    if (step === 0) {
      return (
        fullName.trim().length > 0 &&
        isValidUkPhone(phone) &&
        roleSubtype.length > 0
      )
    }
    if (step === 1) {
      if (!orgChoice) return false
      if (orgChoice === 'create') {
        return orgName.trim().length > 0 && billingAddress.trim().length > 0
      }
      return true
    }
    if (step === 2) {
      return acknowledged && namesMatch(signature, fullName)
    }
    return false
  }

  async function handleLogoUpload(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo too large', { description: 'Max 2 MB.' })
      return
    }
    setLogoUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${userId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('organisation-logos')
        .upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage
        .from('organisation-logos')
        .getPublicUrl(path)
      setLogoUrl(data.publicUrl)
    } catch (err) {
      console.error('[onboarding/client] logo upload failed:', err)
      toast.error('Logo upload failed', {
        description:
          err instanceof Error
            ? err.message
            : 'Bucket may not be set up yet. You can skip and add a logo later.',
      })
    } finally {
      setLogoUploading(false)
    }
  }

  async function postStep(): Promise<boolean> {
    setSubmitting(true)
    try {
      if (step === 0) {
        const res = await fetch('/api/onboarding/client/personal', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            phone: phone.trim(),
            roleSubtype,
          }),
        })
        if (!res.ok) throw await asError(res)
        return true
      }
      if (step === 1) {
        const body =
          orgChoice === 'create'
            ? {
                choice: 'create' as const,
                name: orgName.trim(),
                billingAddress: billingAddress.trim(),
                companyRegNumber: companyReg.trim() || undefined,
                vatNumber: vatNumber.trim() || undefined,
                logoUrl: logoUrl || undefined,
              }
            : { choice: orgChoice as 'join' | 'individual' }
        const res = await fetch('/api/onboarding/client/organisation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw await asError(res)
        return true
      }
      if (step === 2) {
        const res = await fetch('/api/onboarding/client/terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signature: signature.trim(),
            confirmed: true,
          }),
        })
        if (!res.ok) throw await asError(res)
        return true
      }
      return false
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
      toast.success('Welcome to LISTD Pro', {
        description: 'Your account is ready.',
      })
      router.push('/post-signin')
      router.refresh()
    }
  }

  function handleBack() {
    if (step === 0 || submitting) return
    setStep((s) => s - 1)
  }

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            Set up your account
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
        </header>

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
                <h2 className="text-lg font-semibold">Personal Details</h2>
              </div>

              <div>
                <Label htmlFor="fullName">
                  Full name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Sarah Johnson"
                  maxLength={100}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="phone">
                  Phone number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+44 7700 900000"
                  maxLength={20}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  UK format. Mobile or landline accepted.
                </p>
                {phone && !isValidUkPhone(phone) && (
                  <p className="mt-1 text-xs text-destructive">
                    Enter a valid UK phone number.
                  </p>
                )}
              </div>

              <div>
                <Label>
                  I am a… <span className="text-destructive">*</span>
                </Label>
                <Select value={roleSubtype} onValueChange={setRoleSubtype}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select your role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_SUBTYPES.map((rt) => (
                      <SelectItem key={rt.value} value={rt.value}>
                        {rt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Organisation Setup</h2>
              </div>

              <p className="text-sm text-muted-foreground">
                Are you part of an agency or organisation?
              </p>

              <div className="grid gap-3">
                {(
                  [
                    {
                      key: 'create',
                      label: 'Create a new organisation',
                      desc: 'Set up your company profile',
                    },
                    {
                      key: 'join',
                      label: 'Join an existing organisation',
                      desc: 'Use an invite link from your admin',
                    },
                    {
                      key: 'individual',
                      label: 'I am an individual',
                      desc: 'Skip organisation setup',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setOrgChoice(opt.key)}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      orgChoice === opt.key
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {orgChoice === 'create' && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div>
                    <Label htmlFor="orgName">
                      Organisation name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="e.g. Andrews Property Group"
                      maxLength={100}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="billingAddress">
                      Billing address <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="billingAddress"
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      placeholder="Full billing address"
                      rows={3}
                      className="mt-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="companyReg">Company reg number</Label>
                      <Input
                        id="companyReg"
                        value={companyReg}
                        onChange={(e) => setCompanyReg(e.target.value)}
                        placeholder="e.g. 12345678"
                        maxLength={20}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="vatNumber">VAT number</Label>
                      <Input
                        id="vatNumber"
                        value={vatNumber}
                        onChange={(e) => setVatNumber(e.target.value)}
                        placeholder="e.g. GB123456789"
                        maxLength={20}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Organisation logo (optional)</Label>
                    <div className="mt-1.5 flex items-center gap-3">
                      {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoUrl}
                          alt="Logo preview"
                          className="h-14 w-14 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          {logoUploading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Upload className="h-5 w-5" />
                          )}
                        </div>
                      )}
                      <label className="cursor-pointer text-sm text-primary hover:underline">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleLogoUpload(file)
                          }}
                          disabled={logoUploading}
                        />
                        {logoUrl ? 'Replace' : 'Upload PNG / JPG / SVG'}
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Up to 2 MB. Used on invoices and reports.
                    </p>
                  </div>
                </div>
              )}

              {orgChoice === 'join' && (
                <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  Ask your organisation admin to send you an invite link. You
                  can complete this step later from Settings.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="mb-2 flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Terms of Business</h2>
              </div>

              <p className="text-sm text-muted-foreground">
                Please review and sign the LISTD Pro Terms of Business. You
                cannot post jobs until this is complete.
              </p>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
                <p className="mb-3">
                  By signing below you agree to be bound by the LISTD Pro Terms
                  of Business. The full document is available at{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    /terms
                  </a>
                  . Key points:
                </p>
                <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                  {TERMS_BULLETS.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm text-foreground">
                  I have read and agree to the LISTD Pro Terms of Business.
                </span>
              </label>

              <div>
                <Label htmlFor="signature">
                  Signature <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="signature"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder={`Type your full name: ${fullName}`}
                  className="mt-1.5 font-semibold text-lg italic"
                  maxLength={100}
                />
                {signature.trim().length > 0 &&
                !namesMatch(signature, fullName) ? (
                  <p className="mt-1 text-xs text-destructive">
                    This doesn&rsquo;t match the name from Step 1 (
                    {fullName.trim()}).
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Type your full name exactly as in Step 1 to sign.
                  </p>
                )}
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
                Sign &amp; finish
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

async function asError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string; details?: unknown }
    if (body?.error) return new Error(body.error)
  } catch {
    /* fall through */
  }
  return new Error(`HTTP ${res.status}`)
}
