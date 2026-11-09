'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  /** POST endpoint that accepts `{ adminNotes: string | null }`. */
  endpoint: string
  /** Current note value (or null for a fresh row). */
  initial: string | null
  /** Placeholder copy — defaults to a generic prompt. */
  placeholder?: string
}

/**
 * Inline editor for the various `admin_notes` columns across the admin
 * surfaces. Hoisted out of the job-detail page so client/clerk admin notes
 * can reuse the exact same UX — pass the endpoint, the rest is identical.
 *
 * The endpoint contract is the same everywhere:
 *   POST  body: { adminNotes: string | null }
 *   200   on success (writes the column + audit row inside one tx)
 *
 * See [/api/admin/jobs/[id]/admin-notes](../../app/api/admin/jobs/[jobId]/admin-notes/route.ts)
 * for the canonical implementation.
 */
export function AdminNotesEditor({
  endpoint,
  initial,
  placeholder = 'Admin-only notes…',
}: Props) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)

  const dirty = (value.trim() || null) !== (initial?.trim() || null)

  async function handleSave() {
    if (saving || !dirty) return
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNotes: value.trim() || null }),
      })
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
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        rows={4}
        placeholder={placeholder}
        className="text-xs"
      />
      <div className="flex justify-start">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save Notes
        </Button>
      </div>
    </div>
  )
}
