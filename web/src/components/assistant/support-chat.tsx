'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

/**
 * In-app support assistant (help chatbot) — a floating button + slide-up
 * panel. Available in the client / clerk / cleaner / tenant portals (not
 * admin). Stateless on the server; the running conversation lives here and
 * is posted to /api/assistant/chat each turn. The server tailors answers to
 * the caller's role (derived from the session), so `greeting`/`suggestions`
 * here are display-only.
 */
export function SupportChat({
  greeting = 'Hi! I’m LISTD Helper. Ask me how to do anything on LISTD Pro.',
  suggestions = [],
  endpoint = '/api/assistant/chat',
  tenantMode = false,
}: {
  greeting?: string
  suggestions?: string[]
  /** Chat API to POST to. Defaults to the session-authed assistant. */
  endpoint?: string
  /** Token-based tenant portal: read `?token=` from the URL and send it with
   *  each message (the tenant portal has no session). */
  tenantMode?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tenant portal credential lives in the URL; read it client-side (lazy init,
  // null during SSR) so the widget can sit in the session-less tenant layout.
  const [token] = useState<string | null>(() =>
    tenantMode && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy, open])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    setError(null)
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setInput('')
    if (tenantMode && !token) {
      setError('Open this page from your access link to use the assistant.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-20),
          ...(tenantMode ? { token } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.reply as string },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open help assistant"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <MessageCircle className="h-5 w-5" />
        Help
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(34rem,80vh)] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-semibold">LISTD Helper</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded-md p-1 hover:bg-white/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        <Bubble role="assistant">{greeting}</Bubble>
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content}
          </Bubble>
        ))}
        {busy && (
          <Bubble role="assistant">
            <Loader2 className="h-4 w-4 animate-spin" />
          </Bubble>
        )}
        {error && (
          <p className="text-center text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask a question…"
          className="max-h-28 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          type="submit"
          size="icon"
          disabled={busy || !input.trim()}
          className="h-9 w-9 shrink-0"
          aria-label="Send"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  )
}

function Bubble({
  role,
  children,
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted text-foreground'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
