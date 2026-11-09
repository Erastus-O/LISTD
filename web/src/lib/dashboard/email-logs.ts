import 'server-only'
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm'
import { db, emailLogs } from '@/db'

/**
 * Server-only data layer for the admin Email Log dashboard (M2 #12).
 * URL-driven filters, server-rendered table, optional CSV export.
 */

const STATUSES = ['sent', 'failed', 'bounced', 'webhook'] as const
export type EmailLogStatus = (typeof STATUSES)[number]

export type EmailLogsFilter = {
  q?: string
  template?: string
  status?: EmailLogStatus
  from?: string
  to?: string
}

export type EmailLogRow = {
  id: string
  functionName: string
  recipientEmail: string
  subject: string
  status: string
  resendId: string | null
  errorMessage: string | null
  metadata: unknown
  createdAt: string
  templateVersion: string | null
}

const PAGE_SIZE = 100
const EXPORT_LIMIT = 5000

export async function loadEmailLogs(
  filter: EmailLogsFilter,
  opts: { limit?: number } = {}
): Promise<{ rows: EmailLogRow[]; total: number; functionNames: string[] }> {
  return db.transaction(async (tx) => {
    const where = buildWhere(filter)

    const rows = await tx
      .select({
        id: emailLogs.id,
        functionName: emailLogs.functionName,
        recipientEmail: emailLogs.recipientEmail,
        subject: emailLogs.subject,
        status: emailLogs.status,
        resendId: emailLogs.resendId,
        errorMessage: emailLogs.errorMessage,
        metadata: emailLogs.metadata,
        createdAt: emailLogs.createdAt,
      })
      .from(emailLogs)
      .where(where)
      .orderBy(desc(emailLogs.createdAt))
      .limit(opts.limit ?? PAGE_SIZE)

    const [totalRow] = await tx
      .select({ c: count(emailLogs.id) })
      .from(emailLogs)
      .where(where)

    const distinctFns = await tx
      .selectDistinct({ functionName: emailLogs.functionName })
      .from(emailLogs)
      .orderBy(emailLogs.functionName)

    return {
      rows: rows.map((r) => ({
        ...r,
        templateVersion: extractTemplateVersion(r.metadata),
      })),
      total: totalRow?.c ?? 0,
      functionNames: distinctFns.map((d) => d.functionName),
    }
  })
}

export async function loadEmailLogsForExport(
  filter: EmailLogsFilter
): Promise<EmailLogRow[]> {
  const { rows } = await loadEmailLogs(filter, { limit: EXPORT_LIMIT })
  return rows
}

function buildWhere(f: EmailLogsFilter): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = []
  if (f.template) clauses.push(eq(emailLogs.functionName, f.template))
  if (f.status) clauses.push(eq(emailLogs.status, f.status))
  if (f.from) clauses.push(gte(emailLogs.createdAt, `${f.from}T00:00:00Z`))
  if (f.to) clauses.push(lte(emailLogs.createdAt, `${f.to}T23:59:59Z`))
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`
    const search = or(
      ilike(emailLogs.recipientEmail, like),
      ilike(emailLogs.subject, like),
      ilike(emailLogs.resendId, like)
    )
    if (search) clauses.push(search)
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

export function parseEmailLogsFilter(
  sp: Record<string, string | string[] | undefined>
): EmailLogsFilter {
  const f: EmailLogsFilter = {}
  const status = first(sp.status)
  if (status && (STATUSES as readonly string[]).includes(status)) {
    f.status = status as EmailLogStatus
  }
  const template = first(sp.template)
  if (template) f.template = template
  const q = first(sp.q)
  if (q) f.q = q
  const from = first(sp.from)
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) f.from = from
  const to = first(sp.to)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) f.to = to
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

function extractTemplateVersion(metadata: unknown): string | null {
  if (
    metadata &&
    typeof metadata === 'object' &&
    'templateVersion' in metadata &&
    typeof (metadata as { templateVersion: unknown }).templateVersion === 'string'
  ) {
    return (metadata as { templateVersion: string }).templateVersion
  }
  return null
}

/**
 * Encode a list of EmailLogRow to a CSV string. Quotes any field containing
 * comma / quote / newline; uses CRLF line endings (Excel-friendly).
 */
export function emailLogsToCsv(rows: EmailLogRow[]): string {
  const header = [
    'createdAt',
    'functionName',
    'templateVersion',
    'status',
    'recipientEmail',
    'subject',
    'resendId',
    'errorMessage',
  ]
  const lines = [header.map(csvEscape).join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.functionName,
        r.templateVersion ?? '',
        r.status,
        r.recipientEmail,
        r.subject,
        r.resendId ?? '',
        r.errorMessage ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\r\n')
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
