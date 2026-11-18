'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'

export type ThreadMessageView = {
  id: string
  side: 'listd' | 'pro' | 'client' | 'system'
  senderName: string | null
  body: string
  createdAt: string
}

const SIDE_LABEL = { listd: 'LISTD', pro: 'Pro', client: 'Client', system: 'LISTD' } as const

/**
 * A job conversation with LISTD. `me` is the viewer's side, so their own
 * messages sit on the right. Pros and clients only ever reach LISTD.
 */
export function JobThread({
  jobId,
  channel,
  me,
  title,
  hint,
  messages,
  disabled,
}: {
  jobId: string
  channel: 'pro' | 'client'
  me: 'listd' | 'pro' | 'client'
  title: string
  hint?: string
  messages: ThreadMessageView[]
  disabled?: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, body }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setText('')
      router.refresh()
    } catch (err) {
      toast.error('Message not sent', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="a-card grid gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="a-muted mt-1 text-sm">{hint}</p>}
      </div>
      {messages.length === 0 ? (
        <p className="a-muted text-sm">No messages yet.</p>
      ) : (
        <ol className="grid max-h-[28rem] gap-2 overflow-y-auto">
          {messages.map((m) => {
            const mine = m.side === me
            return (
              <li
                key={m.id}
                className={`max-w-[85%] rounded-lg border border-border px-3 py-2 text-sm ${mine ? 'justify-self-end bg-primary/5' : 'justify-self-start bg-muted/30'}`}
              >
                <p className="text-xs text-muted-foreground">
                  {m.side === 'system' ? 'LISTD brief' : (m.senderName ?? SIDE_LABEL[m.side])}
                  {me === 'listd' && m.side !== 'system' && m.side !== 'listd' ? ` (${SIDE_LABEL[m.side]})` : ''}
                  {' · '}
                  {new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
              </li>
            )
          })}
        </ol>
      )}
      {!disabled && (
        <div className="grid gap-2">
          <Textarea
            aria-label="Message"
            rows={3}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder={me === 'listd' ? 'Reply' : 'Message LISTD'}
          />
          <div>
            <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy || !text.trim()} onClick={send}>
              {busy ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
