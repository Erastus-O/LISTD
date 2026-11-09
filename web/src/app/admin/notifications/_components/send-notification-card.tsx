'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

type Target = 'all_clients' | 'all_clerks' | 'all_users' | 'individual'

type Channels = { inapp: boolean; email: boolean; sms: boolean }

type UserSuggestion = { userId: string; fullName: string }

/**
 * Send Manual Notification card (Lovable port — `SendNotificationSection`).
 *
 * Posts to `/api/admin/notifications/broadcast`. The server resolves the
 * target group and inserts in batches; this client just collects the form
 * and surfaces the typed-confirm step when the resolved recipient count
 * exceeds the server-side threshold (>50 recipients require typing "SEND").
 *
 * Individual-user mode uses a debounced typeahead against
 * `/api/admin/notifications/search-users`.
 */
export function SendNotificationCard() {
  const router = useRouter()
  const [target, setTarget] = useState<Target>('all_clients')
  const [channels, setChannels] = useState<Channels>({
    inapp: true,
    email: false,
    sms: false,
  })
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<UserSuggestion[]>([])
  const [selectedUser, setSelectedUser] = useState<UserSuggestion | null>(null)
  const [searchPending, setSearchPending] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [needsTypedConfirm, setNeedsTypedConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  // Debounced user search — fires when target=individual and query >= 2 chars.
  // The early clear path uses a functional setter that no-ops when already
  // empty, so the lint rule's "cascading renders" concern doesn't apply.
  useEffect(() => {
    if (target !== 'individual' || userSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserResults((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const handle = setTimeout(async () => {
      setSearchPending(true)
      try {
        const res = await fetch(
          `/api/admin/notifications/search-users?q=${encodeURIComponent(userSearch.trim())}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { results: UserSuggestion[] }
        setUserResults(json.results ?? [])
      } catch {
        setUserResults([])
      } finally {
        setSearchPending(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [userSearch, target])

  const channelSelected = channels.inapp || channels.email || channels.sms
  const canTriggerConfirm =
    body.trim().length > 0 &&
    channelSelected &&
    (target !== 'individual' || !!selectedUser) &&
    !sending

  function openConfirm() {
    setNeedsTypedConfirm(target !== 'individual')
    setConfirmText('')
    setConfirmOpen(true)
  }

  async function send() {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch('/api/admin/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          userId: target === 'individual' ? selectedUser?.userId : undefined,
          channels,
          subject: subject.trim() || undefined,
          body: body.trim(),
          confirmText: needsTypedConfirm ? confirmText.trim() : undefined,
        }),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        const message = errBody?.error ?? `HTTP ${res.status}`
        // Server signals "confirmation required" via 400. If we haven't
        // shown the typed-confirm field yet, surface it now and let the
        // admin re-submit.
        if (
          message.toLowerCase().includes('confirmation required') &&
          !needsTypedConfirm
        ) {
          setNeedsTypedConfirm(true)
          toast.message(message)
          return
        }
        throw new Error(message)
      }
      const json = (await res.json()) as { recipientCount: number }
      toast.success(
        `Sent to ${json.recipientCount} ${json.recipientCount === 1 ? 'user' : 'users'}`
      )
      setSubject('')
      setBody('')
      setConfirmOpen(false)
      setConfirmText('')
      router.refresh()
    } catch (err) {
      toast.error('Could not send notification', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Send manual notification</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs">Recipient</Label>
            <Select
              value={target}
              onValueChange={(v) => {
                setTarget(v as Target)
                setSelectedUser(null)
                setUserSearch('')
              }}
            >
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_clients">All clients</SelectItem>
                <SelectItem value="all_clerks">All clerks</SelectItem>
                <SelectItem value="all_users">All users</SelectItem>
                <SelectItem value="individual">Individual user</SelectItem>
              </SelectContent>
            </Select>

            {target === 'individual' && (
              <div className="mt-2 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value)
                      setSelectedUser(null)
                    }}
                    placeholder="Search by name…"
                    className="h-9 pl-8 text-sm"
                    disabled={sending}
                  />
                </div>
                {searchPending && (
                  <p className="text-[11px] text-muted-foreground">Searching…</p>
                )}
                {!searchPending && userResults.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-md border border-border">
                    {userResults.map((u) => (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => {
                          setSelectedUser(u)
                          setUserSearch(u.fullName)
                          setUserResults([])
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
                          selectedUser?.userId === u.userId
                            ? 'bg-primary/10 font-medium'
                            : ''
                        }`}
                      >
                        {u.fullName}
                      </button>
                    ))}
                  </div>
                )}
                {selectedUser && (
                  <p className="text-[11px] text-muted-foreground">
                    Selected:{' '}
                    <span className="text-foreground">{selectedUser.fullName}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Channel</Label>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {(['inapp', 'email', 'sms'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={channels[ch]}
                    onChange={(e) =>
                      setChannels((prev) => ({
                        ...prev,
                        [ch]: e.target.checked,
                      }))
                    }
                    disabled={sending}
                    className="h-4 w-4"
                  />
                  {ch === 'inapp' ? 'In-app' : ch.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
        </div>

        {channels.email && (
          <div>
            <Label className="text-xs">Subject (email)</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Notification subject"
              className="mt-1 h-9 text-sm"
              disabled={sending}
            />
          </div>
        )}

        <div>
          <Label className="text-xs">Message body</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your notification…"
            rows={4}
            className="mt-1 text-sm"
            disabled={sending}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={openConfirm}
            disabled={!canTriggerConfirm}
            className="gap-1.5"
          >
            <Send className="h-4 w-4" />
            Send
          </Button>
          {body.trim() && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Channels:{' '}
              {[
                channels.inapp && (
                  <Badge key="i" variant="secondary" className="text-[10px]">
                    In-app
                  </Badge>
                ),
                channels.email && (
                  <Badge key="e" variant="secondary" className="text-[10px]">
                    Email
                  </Badge>
                ),
                channels.sms && (
                  <Badge key="s" variant="secondary" className="text-[10px]">
                    SMS
                  </Badge>
                ),
              ]
                .filter(Boolean)
                .map((node) => node)}
            </span>
          )}
        </div>

        <Dialog open={confirmOpen} onOpenChange={(v) => !sending && setConfirmOpen(v)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm send</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                This will send a notification to{' '}
                <strong className="text-foreground">
                  {target === 'individual'
                    ? selectedUser?.fullName ?? '1 user'
                    : target.replace(/_/g, ' ')}
                </strong>{' '}
                via{' '}
                {[
                  channels.inapp && 'In-app',
                  channels.email && 'Email',
                  channels.sms && 'SMS',
                ]
                  .filter(Boolean)
                  .join(', ')}
                .
              </p>
              {needsTypedConfirm && (
                <div>
                  <Label className="text-xs">
                    Type{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                      SEND
                    </code>{' '}
                    to confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    disabled={sending}
                    className="mt-1 h-9 font-mono text-sm"
                    placeholder="SEND"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={sending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={send}
                disabled={
                  sending ||
                  (needsTypedConfirm && confirmText.trim() !== 'SEND')
                }
                className="gap-1.5"
              >
                {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Send now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
