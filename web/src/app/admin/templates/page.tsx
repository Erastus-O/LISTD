import { FilePlus2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadReportTemplates } from '@/lib/dashboard/admin-report-templates'
import { TemplatesGrid } from './_components/templates-grid'
import { TemplateEditorTrigger } from './_components/template-editor'

export const metadata = { title: 'Admin · Report Templates' }
export const dynamic = 'force-dynamic'

/**
 * Admin Report Templates (Lovable port of `ReportTemplateManager.tsx`).
 *
 * Server-renders the list of templates; the editor (create / edit) and
 * destructive actions (delete / toggle active) live in client islands that
 * call back into `/api/admin/report-templates/*`.
 *
 * Templates seed the clerk inspection wizard with a starting set of areas
 * and items — once a clerk submits, the resulting `inspection_rooms` /
 * `inspection_items` rows are independent copies, so editing or deleting a
 * template here does not retroactively affect prior reports.
 */
export default async function AdminTemplatesPage() {
  await requireRole('admin')
  const templates = await loadReportTemplates()

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl text-foreground">
              Report Templates
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Create reusable inspection templates with predefined areas and
              items.
            </p>
          </div>
        </div>
        <TemplateEditorTrigger mode="create" />
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No templates yet. Create your first one.
          </CardContent>
        </Card>
      ) : (
        <TemplatesGrid templates={templates} />
      )}
    </div>
  )
}
