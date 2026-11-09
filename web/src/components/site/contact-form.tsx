'use client'

import { useState } from 'react'
import { Icon } from '@/components/listd/icon'

const ROLES = [
  'Letting agent',
  'Landlord',
  'Property manager',
  'Pro Clerk',
  'Pro Cleaner',
  'Pro Trades',
  'Something else',
]

type Errors = Partial<Record<'name' | 'email' | 'message', string>>

function Field({
  id,
  label,
  optional,
  error,
  area,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error?: string
  area?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="ld-field">
      <label className="ld-label" htmlFor={id}>
        {label} {optional && <small>Optional</small>}
      </label>
      <div className={`ld-control${area ? ' ld-control-area' : ''}${error ? ' is-invalid' : ''}`}>
        {children}
      </div>
      {error && (
        <span className="ld-error" id={`${id}-err`}>
          <Icon name="error" size={16} />
          {error}
        </span>
      )}
    </div>
  )
}

/** Contact form, posting to the same /api/contact endpoint as production. */
export function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', company: '', role: ROLES[0], message: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: Errors = {}
    if (!form.name.trim()) next.name = 'Enter your name'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = 'Enter an email address, like name@agency.co.uk'
    if (!form.message.trim()) next.message = 'Tell us how we can help'
    setErrors(next)
    if (Object.keys(next).length) return

    setState('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          company: form.company,
          // The API has no role field; keep it with the message so support sees it.
          message: `I am a: ${form.role}\n\n${form.message}`,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  if (state === 'sent') {
    return (
      <div className="s-form">
        <div className="ld-alert ld-alert-success" role="status">
          <Icon name="success" size={20} />
          <div>
            <b>Message sent</b>
            <p>Thanks for getting in touch. We’ll reply within 24–48 hours.</p>
          </div>
          <span />
        </div>
      </div>
    )
  }

  return (
    <form className="s-form" noValidate onSubmit={submit}>
      <div>
        <h2 style={{ font: '400 28px/34px var(--font-display)', letterSpacing: '-0.02em' }}>
          Send us a message
        </h2>
        <p className="s-fine" style={{ marginTop: 6 }}>
          We’ll get back to you within 24–48 hours.
        </p>
      </div>
      <div className="two">
        <Field id="cf-name" label="Name" error={errors.name}>
          <input className="ld-input" id="cf-name" autoComplete="name" required value={form.name} onChange={set('name')} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'cf-name-err' : undefined} />
        </Field>
        <Field id="cf-email" label="Work email" error={errors.email}>
          <input className="ld-input" id="cf-email" type="email" autoComplete="email" placeholder="name@agency.co.uk" required value={form.email} onChange={set('email')} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'cf-email-err' : undefined} />
        </Field>
      </div>
      <Field id="cf-co" label="Company or organisation" optional>
        <input className="ld-input" id="cf-co" autoComplete="organization" value={form.company} onChange={set('company')} />
      </Field>
      <Field id="cf-role" label="I am a">
        <select className="ld-select" id="cf-role" value={form.role} onChange={set('role')}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} />
      </Field>
      <Field id="cf-msg" label="Message" area error={errors.message}>
        <textarea className="ld-input" id="cf-msg" rows={4} placeholder="Tell us about your properties or the area you cover" required value={form.message} onChange={set('message')} aria-invalid={!!errors.message} aria-describedby={errors.message ? 'cf-msg-err' : undefined} />
      </Field>
      <button className="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending...' : 'Send message'}
      </button>
      <p className="s-fine">
        By submitting this form you agree to our <a className="ld-link" href="/privacy">Privacy Policy</a>.
      </p>
      {state === 'failed' && (
        <div className="ld-alert ld-alert-danger" role="alert">
          <Icon name="error" size={20} />
          <div>
            <b>Your message wasn’t sent</b>
            <p>Try again, or email support@listd.co.uk.</p>
          </div>
          <span />
        </div>
      )}
    </form>
  )
}
