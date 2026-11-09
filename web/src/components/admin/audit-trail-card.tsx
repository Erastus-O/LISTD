import {
  CheckCircle2,
  CircleSlash,
  History,
  KeySquare,
  PoundSterling,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UserMinus,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { AuditTrailEntry } from '@/lib/audit-events'

type Props = {
  entries: AuditTrailEntry[]
  /** Used in the empty-state copy ("No audit events recorded for this <noun>"). */
  entityNoun?: string
}

/**
 * Generic audit-trail card. Renders any `audit_events` rows newest-first,
 * formatted by category — pricing rows show before/after, status flips show
 * prior → new, dispute transitions show prior → new + narrative, etc.
 *
 * Source of truth is the `payload` JSONB column. The handler that wrote the
 * row chose what to put there (see the per-handler audit calls); this card
 * is purely presentational.
 *
 * Used by:
 *   - admin job detail (S6c-3) — `loadJobAuditTrail(jobId)`
 *   - admin dispute detail (S6d-2 + dispute audit category) — `loadAuditTrail('dispute', id)`
 *
 * Add a category here if a new audit category lands and the icon / label /
 * payload renderer needs domain-specific phrasing.
 */
export function AuditTrailCard({ entries, entityNoun = 'entity' }: Props) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4" />
          Audit trail
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'event' : 'events'}
          </span>
        </h2>

        {entries.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No audit events recorded for this {entityNoun} yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {entries.map((e) => {
              const Icon = iconFor(e.category, e.action)
              return (
                <li
                  key={e.id}
                  className="flex gap-2.5 border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="mt-0.5 shrink-0 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs font-medium text-foreground">
                      {humanAction(e)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.actorName ??
                        (e.actorUserId ? 'Unknown user' : 'System')}
                      {' · '}
                      {formatDateTime(e.createdAt)}
                    </p>
                    {renderPayload(e)}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function iconFor(category: string, action: string): LucideIcon {
  if (action === 'verification.suspended') return ShieldAlert
  if (action === 'verification.approved') return ShieldCheck
  switch (category) {
    case 'pricing_override':
      return PoundSterling
    case 'job_lifecycle':
      return CheckCircle2
    case 'verification':
      return KeySquare
    case 'impersonation':
      return UserCog
    case 'strike':
      return ShieldAlert
    case 'dispute':
      return Scale
    case 'account_status':
      return UserMinus
    default:
      return CircleSlash
  }
}

/**
 * Action label per row. Falls back to a slugified version of the action key
 * if no specific phrasing is wired — better for reviewers than showing a raw
 * `pricing.override.clerkBonus` token.
 */
function humanAction(e: AuditTrailEntry): string {
  const p = e.payload
  switch (e.action) {
    case 'pricing.override.quotedPrice':
      return 'Client price override'
    case 'pricing.override.finalPrice':
      return 'Final price override'
    case 'pricing.override.clerkPayout':
      return 'Clerk payout override'
    case 'pricing.override.clerkBonus':
      return 'Clerk bonus override'
    case 'pricing.override.clerkFinalPayout':
      return 'Final clerk payout override'
    case 'job.created':
      return 'Job created'
    case 'job.published':
      return 'Job published'
    case 'job.assigned':
      return 'Clerk assigned'
    case 'job.cancelled':
      return 'Job cancelled'
    case 'job.completed':
      return 'Job marked completed'
    case 'job.in_progress':
      return asString(p.reason) === 'returned_for_amends'
        ? 'Report returned for amends'
        : 'Job moved to in-progress'
    case 'job.status_override':
      return `Status override → ${asString(p.newStatus) ?? '—'}`
    case 'job.recycle_promoted':
      return `Recycle promoted ${asString(p.fromStage) ?? '?'} → ${asString(p.toStage) ?? '?'}`
    case 'report.rejected':
      return 'Report rejected'
    case 'dispute.under_review':
      return 'Dispute moved to under review'
    case 'dispute.resolved':
      return 'Dispute resolved'
    case 'dispute.escalated':
      return 'Dispute escalated'
    case 'dispute.open':
      return 'Dispute reopened'
    case 'account_status.changed':
      return `Account status → ${asString(p.after) ?? '—'}`
    case 'strike.issued':
      return `Strike issued (severity ${asString(p.severity) ?? '?'})`
    default:
      return e.action.replace(/[._]/g, ' ')
  }
}

/**
 * Per-row payload preview. Each lifecycle / pricing action ships specific
 * payload keys; this picks the salient diff for reviewers without spilling
 * the full JSON.
 */
function renderPayload(e: AuditTrailEntry) {
  const p = e.payload
  if (e.action.startsWith('pricing.override.')) {
    const before = formatMoney(p.before)
    const after = formatMoney(p.after)
    const reason = asString(p.reason)
    return (
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono">
          {before} <span className="text-foreground">→</span> {after}
        </span>
        {reason ? <span className="ml-2 italic">: {reason}</span> : null}
      </p>
    )
  }

  if (e.action === 'job.assigned') {
    const prior = asString(p.priorClerkId)
    const reason = asString(p.reason)
    return (
      <p className="text-[11px] text-muted-foreground">
        {prior ? `Reassigned from ${prior.slice(0, 8)}…` : 'First assignment'}
        {reason ? ` · ${reason}` : ''}
      </p>
    )
  }

  if (e.action === 'job.cancelled') {
    const fee = formatMoney(p.cancellationFee)
    const reason = asString(p.reason)
    return (
      <p className="text-[11px] text-muted-foreground">
        {`Prior status: ${asString(p.priorStatus) ?? '—'} · Fee: ${fee}`}
        {reason ? ` · ${reason}` : ''}
      </p>
    )
  }

  if (e.action === 'job.status_override') {
    const reason = asString(p.reason)
    return (
      <p className="text-[11px] text-muted-foreground">
        {asString(p.priorStatus) ?? '—'}{' → '}
        {asString(p.newStatus) ?? '—'}
        {reason ? ` · ${reason}` : ''}
      </p>
    )
  }

  if (e.action === 'job.completed') {
    const finalPrice = formatMoney(p.finalPrice)
    const payout = formatMoney(p.clerkFinalPayout)
    return (
      <p className="text-[11px] text-muted-foreground">
        Prior status: {asString(p.priorStatus) ?? '—'} · Final {finalPrice} ·
        Clerk pay {payout}
      </p>
    )
  }

  if (e.action.startsWith('dispute.')) {
    const prior = asString(p.priorStatus)
    const next = asString(p.newStatus)
    const resolution = asString(p.resolution)
    return (
      <p className="text-[11px] text-muted-foreground">
        {prior && next ? (
          <span className="font-mono">
            {prior.replace(/_/g, ' ')}{' '}
            <span className="text-foreground">→</span>{' '}
            {next.replace(/_/g, ' ')}
          </span>
        ) : null}
        {resolution ? <span className="ml-2 italic">: {resolution}</span> : null}
      </p>
    )
  }

  if (e.action === 'account_status.changed') {
    const before = asString(p.before)
    const after = asString(p.after)
    const reason = asString(p.reason)
    return (
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono">
          {before ?? '—'} <span className="text-foreground">→</span>{' '}
          {after ?? '—'}
        </span>
        {reason ? <span className="ml-2 italic">: {reason}</span> : null}
      </p>
    )
  }

  if (e.action === 'strike.issued') {
    const reason = asString(p.reason)
    const jobId = asString(p.jobId)
    return (
      <p className="text-[11px] text-muted-foreground">
        {jobId ? `Job ${jobId.slice(0, 8)} · ` : ''}
        {reason ?? ''}
      </p>
    )
  }

  return null
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

function formatMoney(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return `£${n.toFixed(2)}`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
