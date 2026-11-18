import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { loadAdminInbox } from '@/lib/listd/job-messages'
import { SERVICE_LABEL, serviceFromType } from '@/lib/listd/services'

export const metadata = { title: 'Admin · Messages' }
export const dynamic = 'force-dynamic'

/** Every job conversation with LISTD, unread first. Reply on the job page. */
export default async function AdminMessagesPage() {
  await requireRole('admin')
  const inbox = await loadAdminInbox()

  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>Messages</h1>
            <p>Pros (and clients, when client chat is on) message LISTD about a job. Open the job to reply.</p>
          </div>
        </div>
        {inbox.length === 0 ? (
          <div className="a-card text-sm text-muted-foreground">No messages yet.</div>
        ) : (
          <ul className="grid gap-2">
            {inbox.map((m) => (
              <li key={`${m.jobId}-${m.channel}`}>
                <Link href={`/admin/jobs/${m.jobId}`} className="a-card grid gap-1 hover:bg-muted/30">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{m.jobId.slice(0, 8)}</span>
                    <span>{SERVICE_LABEL[serviceFromType(m.inspectionType)]}</span>
                    <span>{m.channel === 'pro' ? 'Pro' : 'Client'} conversation</span>
                    <span>{new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {m.unread > 0 && <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">{m.unread} new</span>}
                  </span>
                  <span className="text-sm">
                    <b>{m.lastSide === 'listd' ? 'LISTD' : (m.senderName ?? (m.channel === 'pro' ? 'Pro' : 'Client'))}:</b> {m.body.length > 200 ? `${m.body.slice(0, 197)}...` : m.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
