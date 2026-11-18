import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { loadApprovalQueue } from '@/lib/listd/job-approval'
import { getProWorkflow } from '@/lib/listd/pro-workflow'

export const metadata = { title: 'Admin · Approvals' }
export const dynamic = 'force-dynamic'

/** Accepted jobs waiting for LISTD before the Pro gets the address and brief. */
export default async function AdminApprovalsPage() {
  await requireRole('admin')
  const [queue, workflow] = await Promise.all([loadApprovalQueue(), getProWorkflow()])

  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>Approvals</h1>
            <p>
              Jobs a Pro has accepted. The Pro gets the address, access codes, contacts and brief once you approve.{' '}
              {workflow.autoApproveFromLevel > 0
                ? `Pros at Level ${workflow.autoApproveFromLevel} and above are approved automatically.`
                : 'Every accepted job is approved by hand.'}{' '}
              <Link className="underline" href="/admin/settings#pro-jobs">Change this in Settings</Link>.
            </p>
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="a-card text-sm text-muted-foreground">Nothing waiting for approval.</div>
        ) : (
          <div className="a-card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Job</th>
                  <th className="px-4 py-2.5 font-medium">Service</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Area</th>
                  <th className="px-4 py-2.5 font-medium">Pro</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pro earns</th>
                  <th className="px-4 py-2.5 font-medium">Accepted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queue.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-2.5">
                      <Link className="font-mono underline" href={`/admin/jobs/${j.id}`}>{j.id.slice(0, 8)}</Link>
                    </td>
                    <td className="px-4 py-2.5">{j.serviceLabel}</td>
                    <td className="px-4 py-2.5">{j.scheduledDate}</td>
                    <td className="px-4 py-2.5">{j.postcode ?? ''}</td>
                    <td className="px-4 py-2.5">
                      {j.proName ?? 'Unnamed Pro'}
                      {j.proVerification !== 'verified' && <span className="ml-1 text-xs text-destructive">({(j.proVerification ?? 'unverified').replace(/_/g, ' ')})</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">£{(j.netP / 100).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {j.acceptedAt ? new Date(j.acceptedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
