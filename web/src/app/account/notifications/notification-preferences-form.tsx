'use client'

import { useState } from 'react'
import { Bell, Mail, MessageSquare, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'

type Prefs = {
  emailJobUpdates: boolean
  emailPaymentUpdates: boolean
  emailReportDelivery: boolean
  emailNewMessages: boolean
  emailMarketing: boolean
  inappJobUpdates: boolean
  inappPaymentUpdates: boolean
  inappReportDelivery: boolean
  inappNewMessages: boolean
  smsJobUpdates: boolean
  smsPaymentUpdates: boolean
  whatsappOptIn: boolean
  emailMidtermReminder: boolean
  emailCheckoutReminder: boolean
  emailNextServicePrompt: boolean
}

type Section = {
  key: keyof Prefs
  label: string
  description: string
  badge?: string
}

const EMAIL: Section[] = [
  {
    key: 'emailJobUpdates',
    label: 'Job updates',
    description: 'Status changes, assignments, scheduling.',
  },
  {
    key: 'emailPaymentUpdates',
    label: 'Payment updates',
    description: 'Payments secured and released, and payout confirmations.',
  },
  {
    key: 'emailReportDelivery',
    label: 'Report delivery',
    description: 'Reports submitted or ready for review.',
  },
  {
    key: 'emailNewMessages',
    label: 'New messages',
    description: 'Messages from clients or clerks.',
  },
  {
    key: 'emailMidtermReminder',
    label: 'Mid-term reminders',
    description: 'Reminders when a mid-term inspection is due.',
    badge: 'New',
  },
  {
    key: 'emailCheckoutReminder',
    label: 'Check-out reminders',
    description: 'Reminders when a check-out is approaching.',
    badge: 'New',
  },
  {
    key: 'emailNextServicePrompt',
    label: 'Next-service prompts',
    description: 'Prompts to book the next inspection in the tenancy lifecycle.',
    badge: 'New',
  },
  {
    key: 'emailMarketing',
    label: 'Product updates',
    description: 'New features, tips, and platform news.',
  },
]

const INAPP: Section[] = [
  {
    key: 'inappJobUpdates',
    label: 'Job updates',
    description: 'Status changes, assignments, scheduling.',
  },
  {
    key: 'inappPaymentUpdates',
    label: 'Payment updates',
    description: 'Payments secured and released, and payout confirmations.',
  },
  {
    key: 'inappReportDelivery',
    label: 'Report delivery',
    description: 'Reports submitted or ready for review.',
  },
  {
    key: 'inappNewMessages',
    label: 'New messages',
    description: 'Messages from clients or clerks.',
  },
]

const SMS: Section[] = [
  {
    key: 'smsJobUpdates',
    label: 'Job updates (SMS)',
    description: 'Receive job status updates by text.',
    badge: 'New',
  },
  {
    key: 'smsPaymentUpdates',
    label: 'Payment updates (SMS)',
    description: 'Receive payment notifications by text.',
    badge: 'New',
  },
]

const WHATSAPP: Section[] = [
  {
    key: 'whatsappOptIn',
    label: 'WhatsApp opt-in',
    description: 'Allow LISTD to message you on WhatsApp.',
    badge: 'New',
  },
]

export function NotificationPreferencesForm({
  initial,
}: {
  initial: Prefs
}) {
  const [prefs, setPrefs] = useState<Prefs>(initial)
  const [savingKeys, setSavingKeys] = useState<Set<keyof Prefs>>(new Set())

  async function toggle(key: keyof Prefs) {
    const next = !prefs[key]
    // Optimistic update
    setPrefs((p) => ({ ...p, [key]: next }))
    setSavingKeys((s) => new Set(s).add(key))

    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      // Roll back on failure
      setPrefs((p) => ({ ...p, [key]: !next }))
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSavingKeys((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  return (
    <div className="space-y-6">
      <PrefSection
        title="Email"
        icon={<Mail className="h-4 w-4" />}
        items={EMAIL}
        prefs={prefs}
        savingKeys={savingKeys}
        onToggle={toggle}
      />
      <PrefSection
        title="In-app"
        icon={<Bell className="h-4 w-4" />}
        items={INAPP}
        prefs={prefs}
        savingKeys={savingKeys}
        onToggle={toggle}
      />
      <PrefSection
        title="SMS"
        icon={<Smartphone className="h-4 w-4" />}
        items={SMS}
        prefs={prefs}
        savingKeys={savingKeys}
        onToggle={toggle}
        footnote="SMS dispatch ships in Phase 2 (Twilio). Toggling on now records your preference for when it lands."
      />
      <PrefSection
        title="WhatsApp"
        icon={<MessageSquare className="h-4 w-4" />}
        items={WHATSAPP}
        prefs={prefs}
        savingKeys={savingKeys}
        onToggle={toggle}
        footnote="WhatsApp dispatch ships in Phase 2 alongside SMS."
      />
    </div>
  )
}

function PrefSection({
  title,
  icon,
  items,
  prefs,
  savingKeys,
  onToggle,
  footnote,
}: {
  title: string
  icon: React.ReactNode
  items: Section[]
  prefs: Prefs
  savingKeys: Set<keyof Prefs>
  onToggle: (key: keyof Prefs) => void
  footnote?: string
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  {item.badge && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.description}
                </p>
              </div>
              <Toggle
                checked={prefs[item.key]}
                onChange={() => onToggle(item.key)}
                pending={savingKeys.has(item.key)}
                ariaLabel={item.label}
              />
            </div>
          ))}
        </div>
        {footnote && (
          <p className="mt-4 text-[11px] text-muted-foreground">{footnote}</p>
        )}
      </CardContent>
    </Card>
  )
}

function Toggle({
  checked,
  onChange,
  pending,
  ariaLabel,
}: {
  checked: boolean
  onChange: () => void
  pending: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={pending}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-border'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-background shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
