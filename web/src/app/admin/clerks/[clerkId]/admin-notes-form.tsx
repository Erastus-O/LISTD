'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  /** Profile id — works for both clerks and clients (handler is profile-keyed). */
  userId: string
  initialNotes: string | null
}

/**
 * Admin Notes (internal) save form. Backed by `profiles.admin_notes`
 * (migration 0007). Persists via [POST /api/admin/profiles/[userId]/admin-notes](
 * ../../../api/admin/profiles/[userId]/admin-notes/route.ts).
 *
 * No audit row is written — admin notes are free-form context, not state
 * transitions. If compliance later asks for diff history, add a
 * `profile_metadata` audit category in a follow-up.
 */
export function AdminNotesForm({ userId, initialNotes }: Props) {
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/admin/profiles/${userId}/admin-notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Notes saved')
      router.refresh()
    } catch (err) {
      toast.error('Could not save notes', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-base font-semibold">Admin Notes</h2>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes about this clerk…"
          rows={5}
          className="resize-y text-xs"
          disabled={saving}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Notes
        </Button>
      </CardContent>
    </Card>
  )
}
