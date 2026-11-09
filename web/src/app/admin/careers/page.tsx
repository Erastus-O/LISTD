import { desc } from 'drizzle-orm'
import { Megaphone } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { jobApplications, withServiceRole } from '@/db'
import { loadVacancies } from '@/lib/careers'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { CareersManager } from './_components/careers-manager'
import {
  ApplicationsList,
  type ApplicationRow,
} from './_components/applications-list'

export const metadata = { title: 'Admin · Careers' }
export const dynamic = 'force-dynamic'

const CV_BUCKET = 'job-applications'

/**
 * Admin careers manager — post/manage vacancies AND review the applications
 * submitted through the LISTD-hosted careers pages. Two application routes
 * per role: outbound (Indeed/LinkedIn posting links → Apply buttons on our
 * site) and inbound (the role's LISTD application link, pasted into
 * Indeed/LinkedIn as the external apply URL — applicants complete the form
 * on LISTD and land here with their CV).
 */
export default async function AdminCareersPage() {
  await requireRole('admin')
  const vacancies = await loadVacancies()

  // Applications + short-lived signed CV URLs. Defensive: pre-migration
  // (0037) this table doesn't exist — render the manager with an empty list.
  const applications: ApplicationRow[] = await (async () => {
    try {
      const rows = await withServiceRole((tx) =>
        tx
          .select()
          .from(jobApplications)
          .orderBy(desc(jobApplications.createdAt))
          .limit(200)
      )
      const storage = getSupabaseAdmin().storage.from(CV_BUCKET)
      return await Promise.all(
        rows.map(async (r) => {
          let cvUrl: string | null = null
          if (r.cvPath) {
            const signed = await storage
              .createSignedUrl(r.cvPath, 3600)
              .catch(() => null)
            cvUrl = signed?.data?.signedUrl ?? null
          }
          return {
            id: r.id,
            vacancyTitle: r.vacancyTitle,
            fullName: r.fullName,
            email: r.email,
            phone: r.phone,
            linkedinUrl: r.linkedinUrl,
            coverNote: r.coverNote,
            cvUrl,
            status: r.status,
            createdAt: r.createdAt,
          }
        })
      )
    } catch {
      return []
    }
  })()

  return (
    <div className="w-full space-y-10 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl text-foreground">
          <Megaphone className="h-6 w-6 text-primary" />
          Careers
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Post vacancies for the public site. Open roles appear on the
          homepage and /careers within seconds of saving. Each saved role
          gets a LISTD application link to paste into Indeed / LinkedIn, and
          you can also add those boards&rsquo; posting links for outbound
          Apply buttons.
        </p>
      </div>

      <CareersManager initialVacancies={vacancies} />

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Applications
            {applications.length > 0 ? ` (${applications.length})` : ''}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Submitted through the LISTD application form — including
            applicants who arrived from Indeed or LinkedIn via your role
            links. CV links are valid for one hour; reload for fresh ones.
          </p>
        </div>
        <ApplicationsList initialApplications={applications} />
      </div>
    </div>
  )
}
