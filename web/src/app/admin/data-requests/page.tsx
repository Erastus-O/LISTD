import { requireRole } from '@/lib/dal'
import { DsarConsole } from './_components/dsar-console'

export const metadata = { title: 'Admin · Data Requests' }
export const dynamic = 'force-dynamic'

/**
 * GDPR data-subject requests console (admin-only). Export a subject's data
 * (Subject Access Request) or erase it (right to be forgotten). The heavy
 * lifting lives in lib/privacy/dsar.ts via the /api/admin/dsar/* routes.
 */
export default async function DataRequestsPage() {
  await requireRole('admin')

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          Data Requests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Handle GDPR subject access (export) and erasure (right to be
          forgotten) requests. Every action is recorded in the audit log.
        </p>
      </div>

      <DsarConsole />
    </div>
  )
}
