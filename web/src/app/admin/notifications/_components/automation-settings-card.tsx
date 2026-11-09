'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { AutomationSettingRow } from '@/lib/dashboard/admin-notifications'

type Group = { category: string; label: string; items: AutomationSettingRow[] }

type Props = { grouped: Group[] }

/**
 * Automation settings table (Lovable port — `AutomationSettingsSection`).
 *
 * Each row is an independent inline-edit + Save pair backed by
 * `/api/admin/notifications/automation/[id]`. The server writes the audit
 * row in the same tx as the update.
 */
export function AutomationSettingsCard({ grouped }: Props) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">
            Automated notification settings
          </h2>
        </div>

        {grouped.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No automation settings configured.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">Setting</th>
                  <th className="w-32 px-3 py-2 text-left font-medium">Value</th>
                  <th className="w-24 px-3 py-2 text-left font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grouped.flatMap((group) =>
                  group.items.map((row, idx) => (
                    <AutomationRow
                      key={row.id}
                      row={row}
                      categoryLabel={idx === 0 ? group.label : null}
                      rowSpan={idx === 0 ? group.items.length : undefined}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AutomationRow({
  row,
  categoryLabel,
  rowSpan,
}: {
  row: AutomationSettingRow
  categoryLabel: string | null
  rowSpan?: number
}) {
  const router = useRouter()
  const [value, setValue] = useState(row.value)
  const [saving, setSaving] = useState(false)
  const dirty = value.trim() !== row.value.trim()

  async function handleSave() {
    if (saving || !dirty) return
    const numeric = Number.parseFloat(value)
    if (!Number.isFinite(numeric)) {
      toast.error('Value must be a number')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        `/api/admin/notifications/automation/${row.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: numeric }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Setting saved')
      router.refresh()
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="hover:bg-muted/30">
      {categoryLabel !== null && (
        <td
          rowSpan={rowSpan}
          className="px-3 py-2 align-top text-sm font-medium"
        >
          <Badge variant="outline" className="text-xs">
            {categoryLabel}
          </Badge>
        </td>
      )}
      <td className="px-3 py-2 text-sm">{row.label}</td>
      <td className="px-3 py-2">
        <Input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          className="h-8 w-24 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="gap-1"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </Button>
      </td>
    </tr>
  )
}
