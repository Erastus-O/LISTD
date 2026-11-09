'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Image as ImageIcon, Loader2, MessageSquareText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ModelOption = { id: string; label: string; hint: string }

type Props = {
  initial: { visionModel: string; textModel: string }
  visionOptions: ReadonlyArray<ModelOption>
  textOptions: ReadonlyArray<ModelOption>
}

export function AiSettingsForm({ initial, visionOptions, textOptions }: Props) {
  const router = useRouter()
  const [visionModel, setVisionModel] = useState(initial.visionModel)
  const [textModel, setTextModel] = useState(initial.textModel)
  const [saving, setSaving] = useState(false)
  const dirty =
    visionModel !== initial.visionModel || textModel !== initial.textModel

  async function handleSave() {
    if (saving || !dirty) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visionModel, textModel }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('AI settings updated')
      router.refresh()
    } catch (err) {
      toast.error('Could not save AI settings', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <ModelCard
        title="Vision model"
        icon={<ImageIcon className="h-4 w-4" />}
        subtitle="Used by every image-aware agent: currently the condition assist on /inspect."
        value={visionModel}
        onChange={setVisionModel}
        options={visionOptions}
        disabled={saving}
      />

      <ModelCard
        title="Text model"
        icon={<MessageSquareText className="h-4 w-4" />}
        subtitle="Reserved for future text-only agents. Choice is stored now so the next agent picks it up without a code change: no agent calls it yet."
        value={textModel}
        onChange={setTextModel}
        options={textOptions}
        disabled={saving}
      />

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
    </div>
  )
}

function ModelCard({
  title,
  icon,
  subtitle,
  value,
  onChange,
  options,
  disabled,
}: {
  title: string
  icon: React.ReactNode
  subtitle: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<ModelOption>
  disabled?: boolean
}) {
  const current = options.find((o) => o.id === value)
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {icon}
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {opt.hint}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {current.hint} · OpenRouter id{' '}
              <code className="rounded bg-muted px-1 font-mono">
                {current.id}
              </code>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
