import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db, platformSettings, withServiceRole } from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'

/**
 * Careers / vacancies — admin-curated content for the marketing site.
 *
 * Admins post roles on /admin/careers; open roles show in the landing
 * page's "We're hiring" section and on /careers. Each role carries the
 * admin-saved Indeed and/or LinkedIn posting URL — the Apply buttons
 * deep-link applicants straight into those application flows, so they
 * complete the application on the platform the admin posted to.
 *
 * Stored as ONE JSON blob in `platform_settings` (same pattern as the SEO
 * overrides) — no migration needed.
 */

export const CAREERS_KEY = 'careers_vacancies'
const CACHE_KEY = cacheKey('careers', 'vacancies')
const CACHE_TTL_SECONDS = 5 * 60

export type Vacancy = {
  id: string
  /** URL slug for the role's public page (/careers/<slug>) — the link the
   *  admin pastes into Indeed/LinkedIn as the external apply URL. Computed
   *  from the title at save time; stable once set. */
  slug?: string
  title: string
  /** e.g. "London / Remote". */
  location: string
  /** e.g. "Full-time", "Part-time", "Contract". */
  employmentType: string
  /** Optional display string, e.g. "£28,000–£34,000". */
  salary?: string
  /** Short role summary shown on the card. */
  description: string
  /** Posting URLs — the Apply buttons. Either or both. */
  indeedUrl?: string
  linkedinUrl?: string
  enabled: boolean
  createdAt: string
}

/** URL slug for a vacancy: kebab-cased title + a short id suffix so two
 *  same-titled roles never collide. */
export function vacancySlug(v: Pick<Vacancy, 'id' | 'title'>): string {
  const base = v.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'role'}-${v.id.slice(0, 6)}`
}

function parseVacancy(v: unknown): Vacancy | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.title !== 'string' ||
    !o.title.trim()
  ) {
    return null
  }
  const str = (x: unknown) => (typeof x === 'string' ? x : '')
  return {
    id: o.id,
    slug: str(o.slug) || undefined,
    title: o.title,
    location: str(o.location),
    employmentType: str(o.employmentType) || 'Full-time',
    salary: str(o.salary) || undefined,
    description: str(o.description),
    indeedUrl: str(o.indeedUrl) || undefined,
    linkedinUrl: str(o.linkedinUrl) || undefined,
    enabled: o.enabled !== false,
    createdAt: str(o.createdAt) || new Date().toISOString(),
  }
}

/** All vacancies, newest first (cached 5 min; busted on save). Defensive:
 *  a malformed blob or DB hiccup yields an empty list, never a broken page. */
export async function loadVacancies(): Promise<Vacancy[]> {
  return getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    try {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, CAREERS_KEY))
        .limit(1)
      if (!row?.value) return []
      const parsed = JSON.parse(row.value) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(parseVacancy)
        .filter((v): v is Vacancy => v !== null)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
    } catch (err) {
      console.warn('[careers] vacancies unavailable; rendering none:', err)
      return []
    }
  })
}

/** The publicly visible roles (enabled only). */
export async function loadOpenVacancies(): Promise<Vacancy[]> {
  return (await loadVacancies()).filter((v) => v.enabled)
}

/** Resolve a vacancy by its public slug (or raw id, as a fallback for
 *  links copied before the slug existed). Open roles only. */
export async function findOpenVacancy(
  slugOrId: string
): Promise<Vacancy | null> {
  const open = await loadOpenVacancies()
  return (
    open.find((v) => v.slug === slugOrId) ??
    open.find((v) => v.id === slugOrId) ??
    null
  )
}

/** Persist the full vacancy list (admin API — caller verified the role). */
export async function saveVacancies(
  vacancies: Vacancy[],
  actorUserId: string
): Promise<void> {
  const value = JSON.stringify(vacancies)
  await withServiceRole((tx) =>
    tx
      .insert(platformSettings)
      .values({
        key: CAREERS_KEY,
        value,
        updatedBy: actorUserId,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedBy: actorUserId, updatedAt: sql`now()` },
      })
  )
  await bust(CACHE_KEY)
}
