import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db, platformSettings, withServiceRole } from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'

/**
 * Site-wide tracking / marketing code for the PUBLIC pages.
 *
 * The SEO agency needs a snippet (GTM, GA4, Hotjar, Ahrefs, …) to run on
 * every public page load. Rather than a code change + deploy per tweak,
 * admins and the restricted `marketing` seat paste it on /admin/seo and it
 * goes live within seconds.
 *
 * Scope is deliberately the `(marketing)` route group ONLY — the same set
 * of pages listed in sitemap.xml. Authenticated app surfaces (client, Pro,
 * cleaner, admin) never execute this code: crawlers never see them, so
 * there's no SEO value, and third-party JS has no business running on
 * pages that show account, payment and admin data.
 *
 * SECURITY: these fields are raw HTML injected into public pages, i.e.
 * effectively "run arbitrary JS on our marketing site". Only trusted staff
 * roles ('admin', 'marketing') can write them, and every save is audited.
 * That role gate is the trust boundary.
 */

export const SITE_SCRIPTS_KEY = 'site_scripts'
const CACHE_KEY = cacheKey('site', 'scripts')
const CACHE_TTL_SECONDS = 5 * 60

/** Max characters per slot — comfortably fits a GTM/GA/Hotjar snippet. */
export const SITE_SCRIPT_MAX = 20000

export type SiteScripts = {
  /** Runs as early as possible on load (the classic "head" snippet). */
  head: string
  /** Runs at the end of the body (deferred pixels, chat widgets, …). */
  bodyEnd: string
}

export const EMPTY_SITE_SCRIPTS: SiteScripts = { head: '', bodyEnd: '' }

/** Cached 5 min; busted on save. Defensive: any failure yields no scripts
 *  rather than a broken public page. */
export async function loadSiteScripts(): Promise<SiteScripts> {
  return getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    try {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, SITE_SCRIPTS_KEY))
        .limit(1)
      if (!row?.value) return EMPTY_SITE_SCRIPTS
      const parsed = JSON.parse(row.value) as unknown
      if (!parsed || typeof parsed !== 'object') return EMPTY_SITE_SCRIPTS
      const o = parsed as Record<string, unknown>
      return {
        head: typeof o.head === 'string' ? o.head.slice(0, SITE_SCRIPT_MAX) : '',
        bodyEnd:
          typeof o.bodyEnd === 'string' ? o.bodyEnd.slice(0, SITE_SCRIPT_MAX) : '',
      }
    } catch (err) {
      console.warn('[site-scripts] unavailable; rendering none:', err)
      return EMPTY_SITE_SCRIPTS
    }
  })
}

/** Persist both slots (admin/marketing API — caller verified the role). */
export async function saveSiteScripts(
  scripts: SiteScripts,
  actorUserId: string
): Promise<void> {
  const value = JSON.stringify({
    head: scripts.head.slice(0, SITE_SCRIPT_MAX),
    bodyEnd: scripts.bodyEnd.slice(0, SITE_SCRIPT_MAX),
  })
  await withServiceRole((tx) =>
    tx
      .insert(platformSettings)
      .values({
        key: SITE_SCRIPTS_KEY,
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
