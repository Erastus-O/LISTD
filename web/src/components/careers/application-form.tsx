'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Send, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const CV_MAX_BYTES = 5 * 1024 * 1024
const CV_EXTS = ['pdf', 'doc', 'docx']

/**
 * LISTD-hosted application form (public — applicants aren't users). Posts
 * multipart to /api/careers/apply with the CV attached. Includes a hidden
 * honeypot field for naive bots. Success swaps to a confirmation state.
 */
export function ApplicationForm({ vacancySlug }: { vacancySlug: string }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [coverNote, setCoverNote] = useState('')
  const [cv, setCv] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  function onCvChange(file: File | null) {
    if (!file) {
      setCv(null)
      return
    }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!CV_EXTS.includes(ext)) {
      toast.error('CV must be a PDF or Word document (.pdf, .doc, .docx)')
      return
    }
    if (file.size > CV_MAX_BYTES) {
      toast.error('CV must be 5 MB or smaller')
      return
    }
    setCv(file)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!cv) {
      toast.error('Please attach your CV')
      return
    }
    setSubmitting(true)
    try {
      const body = new FormData()
      body.set('vacancy', vacancySlug)
      body.set('fullName', fullName)
      body.set('email', email)
      if (phone.trim()) body.set('phone', phone)
      if (linkedinUrl.trim()) body.set('linkedinUrl', linkedinUrl)
      if (coverNote.trim()) body.set('coverNote', coverNote)
      body.set('cv', cv)
      // Honeypot — left empty by humans; the API drops filled ones.
      const hp = document.getElementById(
        `hp-${vacancySlug}`
      ) as HTMLInputElement | null
      if (hp?.value) body.set('website', hp.value)

      const res = await fetch('/api/careers/apply', { method: 'POST', body })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setDone(true)
    } catch (err) {
      toast.error('Could not submit your application', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          Application received
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Thanks {fullName.split(' ')[0] || ''}, we&rsquo;ve got your
          application and CV. We review every application and will reply to{' '}
          {email} either way.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Honeypot: visually hidden, tabIndex -1 — bots fill it, humans don't. */}
      <input
        id={`hp-${vacancySlug}`}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="app-name">Full name *</Label>
          <Input
            id="app-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="Your full name"
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-email">Email *</Label>
          <Input
            id="app-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={255}
            placeholder="you@example.com"
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-phone">Phone</Label>
          <Input
            id="app-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={50}
            placeholder="07…"
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-li">LinkedIn profile</Label>
          <Input
            id="app-li"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            maxLength={300}
            placeholder="https://www.linkedin.com/in/…"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-cv">CV / Résumé * (PDF or Word, max 5 MB)</Label>
        <label
          htmlFor="app-cv"
          className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
            cv
              ? 'border-primary/50 bg-primary/5 text-foreground'
              : 'border-border text-muted-foreground hover:border-primary/40'
          }`}
        >
          <Upload className="h-4 w-4 shrink-0" />
          {cv ? cv.name : 'Choose a file…'}
        </label>
        <input
          id="app-cv"
          type="file"
          accept=".pdf,.doc,.docx"
          onChange={(e) => onCvChange(e.target.files?.[0] ?? null)}
          disabled={submitting}
          className="sr-only"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-note">Cover note (optional)</Label>
        <Textarea
          id="app-note"
          value={coverNote}
          onChange={(e) => setCoverNote(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Tell us briefly why you're a great fit…"
          disabled={submitting}
        />
      </div>

      <Button type="submit" disabled={submitting} className="gap-2">
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {submitting ? 'Submitting…' : 'Submit application'}
      </Button>
      <p className="text-xs text-muted-foreground">
        By applying you consent to LISTD processing your details and CV for
        recruitment purposes, per our{' '}
        <a href="/privacy" target="_blank" className="underline underline-offset-2">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  )
}
