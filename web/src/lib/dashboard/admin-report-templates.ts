import 'server-only'
import { desc } from 'drizzle-orm'
import { db, reportTemplates } from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'

const REPORT_TEMPLATES_TTL_SECONDS = 5 * 60
const REPORT_TEMPLATES_KEY = cacheKey('admin', 'report-templates')

/**
 * Server-only data layer for the admin Report Templates page (Lovable port
 * of `src/pages/admin/ReportTemplateManager.tsx`).
 *
 * Returns every template (active + inactive) — admins see the full set so
 * they can toggle and edit. Clerks see only active rows; their access goes
 * through RLS, not this loader.
 */

export type TemplateItem = { name: string }
export type TemplateArea = { name: string; items: TemplateItem[] }

export type ReportTemplateRow = {
  id: string
  name: string
  structure: TemplateArea[]
  isActive: boolean
  createdAt: string
  itemCount: number
}

export async function loadReportTemplates(): Promise<ReportTemplateRow[]> {
  return getOrSet(REPORT_TEMPLATES_KEY, REPORT_TEMPLATES_TTL_SECONDS, async () => {
    const rows = await db
      .select({
        id: reportTemplates.id,
        name: reportTemplates.name,
        structure: reportTemplates.structure,
        isActive: reportTemplates.isActive,
        createdAt: reportTemplates.createdAt,
      })
      .from(reportTemplates)
      .orderBy(desc(reportTemplates.createdAt))

    return rows.map((r) => {
      const structure = normaliseStructure(r.structure)
      const itemCount = structure.reduce((n, a) => n + a.items.length, 0)
      return {
        id: r.id,
        name: r.name,
        structure,
        isActive: r.isActive,
        createdAt: r.createdAt,
        itemCount,
      }
    })
  })
}

/**
 * Bust the report-templates cache. Call after any admin write that
 * creates/updates/toggles a template so the next admin view is fresh.
 */
export async function bustReportTemplates(): Promise<void> {
  return bust(REPORT_TEMPLATES_KEY)
}

/**
 * Defensive parse of the jsonb column. Bad data shouldn't crash the page —
 * we drop entries that don't match the expected shape, leaving the rest
 * usable.
 */
function normaliseStructure(raw: unknown): TemplateArea[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateArea[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string') continue
    const items = Array.isArray(e.items) ? e.items : []
    const cleanedItems: TemplateItem[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const i = item as Record<string, unknown>
      if (typeof i.name !== 'string') continue
      cleanedItems.push({ name: i.name })
    }
    out.push({ name: e.name, items: cleanedItems })
  }
  return out
}
