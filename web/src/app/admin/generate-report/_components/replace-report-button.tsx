'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileCheck, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

const MAX_PDF_BYTES = 20 * 1024 * 1024

type Props = {
  jobId: string
}

/**
 * Inline-expand replace-PDF action. Browser-direct upload to Supabase
 * storage (admin RLS lets admins write to any folder in
 * `generated-reports`), then POSTs the URL to
 * [/api/admin/jobs/[id]/replace-report](../../../../api/admin/jobs/[jobId]/replace-report/route.ts)
 * which writes the audit row.
 */
export function ReplaceReportButton({ jobId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<
    null | 'uploading' | 'submitting'
  >(null)

  function reset() {
    setOpen(false)
    setFile(null)
    setReason('')
    setPending(null)
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') {
      toast.error('PDF only')
      return
    }
    if (f.size > MAX_PDF_BYTES) {
      toast.error('PDF must be under 20 MB')
      return
    }
    setFile(f)
  }

  async function submit() {
    if (!file || pending) return
    setPending('uploading')
    try {
      const supabase = createClient()
      const storagePath = `${jobId}/admin-replace-${Date.now()}.pdf`
      const upload = await supabase.storage
        .from('generated-reports')
        .upload(storagePath, file, {
          contentType: 'application/pdf',
          upsert: false,
        })
      if (upload.error) throw new Error(`Upload: ${upload.error.message}`)
      const { data: pub } = supabase.storage
        .from('generated-reports')
        .getPublicUrl(storagePath)

      setPending('submitting')
      const res = await fetch(
        `/api/admin/jobs/${jobId}/replace-report`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportUrl: pub.publicUrl,
            storagePath,
            reason: reason.trim() || undefined,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Report PDF replaced')
      reset()
      router.refresh()
    } catch (err) {
      toast.error('Could not replace PDF', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(null)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Upload className="h-3.5 w-3.5" />
        Replace
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Replace report PDF
      </Label>
      <div className="rounded border border-dashed border-border p-3 text-center text-xs">
        {file ? (
          <span className="inline-flex items-center gap-1.5 text-primary">
            <FileCheck className="h-3.5 w-3.5" />
            {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
          </span>
        ) : (
          <span className="text-muted-foreground">PDF only · max 20 MB</span>
        )}
        <Input
          type="file"
          accept=".pdf,application/pdf"
          onChange={pickFile}
          disabled={pending !== null}
          className="mx-auto mt-2 max-w-xs text-xs"
        />
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, captured in audit log)…"
        rows={2}
        disabled={pending !== null}
        className="text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={pending !== null}
          className="text-xs"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!file || pending !== null}
          className="gap-1 text-xs"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending === 'uploading'
            ? 'Uploading…'
            : pending === 'submitting'
              ? 'Saving…'
              : 'Replace PDF'}
        </Button>
      </div>
    </div>
  )
}
