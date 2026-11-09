'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  initial: {
    fullName: string | null
    phone: string | null
    companyName: string | null
    email: string | null
  }
}

export function ClientProfileForm({ initial }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initial.fullName ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [companyName, setCompanyName] = useState(initial.companyName ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (saving) return
    if (!fullName.trim()) {
      toast.error('Full name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/client/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          companyName: companyName.trim() || null,
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

  const initials = (fullName || initial.email || 'U')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <User className="h-4 w-4" />
          Profile
        </h2>

        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {fullName || initial.email || 'User'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {initial.email ?? '—'}
            </p>
          </div>
        </div>

        <div className="my-2 h-px bg-border" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="fullName" label="Full Name *">
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={saving}
              placeholder="Your name"
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
          <Field id="companyName" label="Company Name">
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={saving}
              placeholder="Optional"
            />
          </Field>
          <Field id="email" label="Email">
            <Input
              id="email"
              value={initial.email ?? ''}
              disabled
              className="bg-muted/50"
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
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
