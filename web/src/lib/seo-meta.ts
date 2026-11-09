import 'server-only'
import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { db, platformSettings, withServiceRole } from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'

/**
 * CMS-editable SEO meta for the marketing pages.
 *
 * Admins (or the SEO agency) edit each page's title + description on
 * /admin/seo without a deploy. Overrides live as one JSON blob in
 * `platform_settings` under {@link SEO_META_KEY} and are layered over the
 * code defaults below by {@link buildMarketingMetadata}, which every
 * marketing page calls from `generateMetadata`.
 *
 * An override replaces BOTH the meta tag and the Open Graph variant (one
 * mental model for editors); clearing a field falls back to the default.
 */

export const SEO_META_KEY = 'seo_meta_overrides'
const CACHE_KEY = cacheKey('seo', 'meta-overrides')
const CACHE_TTL_SECONDS = 5 * 60

export type SeoMetaDefault = {
  /** Shown on /admin/seo so editors know which page they're editing. */
  label: string
  title: string
  description: string
  /** Optional social-share variants; overridden together with the above. */
  ogTitle?: string
  ogDescription?: string
}

export type SeoMetaOverride = {
  title?: string
  description?: string
  /** Comma-separated keywords → the `keywords` meta tag. */
  keywords?: string
  /** Raw JSON-LD document, rendered as an `application/ld+json` script on
   *  the page. Stored as the string the editor typed; validated as JSON at
   *  save time and re-serialised (with `<` escaped) at render time. */
  jsonLd?: string
}
export type SeoMetaOverrides = Record<string, SeoMetaOverride>

export const DEFAULT_MARKETING_META: Record<string, SeoMetaDefault> = {
  '/': {
    label: 'Homepage',
    title: 'LISTD – The Property Services Platform UK',
    description:
      'LISTD connects UK landlords and letting agents with verified Pros for inventories, check-ins, check-outs, mid-term inspections and professional cleaning : all through one transparent platform. Evidence-based reports, escrow payments, instant booking.',
    ogDescription:
      'Book inventories, inspections, cleaning and property services through one transparent platform. Verified Pros, real-time updates, photo evidence, digital sign-off and secure escrow payments.',
  },
  '/how-it-works': {
    label: 'How It Works',
    title: 'How LISTD Works – Book, Track & Receive Property Services',
    description:
      'See how LISTD works: create an account, book a property service, get matched with a verified Pro, track delivery with photo evidence, and review completed reports : all in one transparent platform.',
    ogDescription:
      'From booking a service to receiving completed work in a structured, transparent workflow. Verified Pros, real-time updates, evidence-based delivery and escrow-secured payments.',
  },
  '/for-clients': {
    label: 'For Clients',
    title: 'For Letting Agents & Landlords – LISTD Property Services',
    description:
      'Book verified Pros instantly for inventories, inspections, check-ins, check-outs and cleaning. LISTD gives letting agents and landlords evidence-based reports, escrow-secured payments and full audit trails. No subscription required.',
    ogDescription:
      'Manage property services without the admin. Verified Pros, structured reports, real-time tracking and secure escrow payments.',
  },
  '/for-clerks': {
    label: 'For Pros',
    title: 'Become a Pro – Join the LISTD Pro Network',
    description:
      'Join LISTD as a verified Pro. Access consistent property service work (inventories, inspections, check-ins, check-outs and cleaning) through one platform, progress through levels, and get paid securely via escrow on every job.',
    ogDescription:
      'Flexible work, level progression, structured standards and secure escrow payments for verified property service professionals across the UK.',
  },
  '/for-cleaners': {
    label: 'For Cleaners',
    title: 'For Cleaners – Join the LISTD Cleaning Network',
    description:
      'Join LISTD as a professional cleaner. Pick up Light, General and Deep cleans in your area, work through a clear checklist, capture before/after photos, and get paid securely on every job.',
    ogDescription:
      'Flexible cleaning work in your coverage area, clear standards, and secure payments for professional cleaners across the UK.',
  },
  '/service-tiers': {
    label: 'Service Tiers / Pricing',
    title: 'Service Tiers – Flex, Core & Priority | LISTD',
    description:
      'Compare LISTD service tiers : Flex, Core and Priority. Every tier includes room-by-room checklists, timestamped photo evidence and digital sign-off. Choose the right level for your portfolio.',
    ogDescription:
      'Choose from Flex, Core or Priority service tiers. All plans include verified Pros, digital reports and secure escrow payments.',
  },
  '/about': {
    label: 'About',
    title: 'About LISTD – Our Mission & Values',
    description:
      "LISTD is building the UK's most trusted property services platform : verified Pros, escrow-secured payments, and full audit trails to protect landlords, tenants and agents.",
    ogDescription:
      "Learn about LISTD's mission to bring transparency, accountability and trust to UK property services.",
  },
  '/contact': {
    label: 'Contact',
    title: 'Contact LISTD – Get in Touch',
    description:
      'Contact the LISTD team. Chat with us live, send an email, or book a 15-minute walkthrough of the platform.',
  },
  '/careers': {
    label: 'Careers',
    title: 'Careers at LISTD – Join Our Team',
    description:
      "Explore open roles at LISTD. Help us build the UK's most trusted property services platform: transparent workflows, verified professionals, evidence-based delivery.",
    ogDescription:
      "We're hiring. See open roles at LISTD and apply via Indeed or LinkedIn.",
  },
  '/terms': {
    label: 'Terms of Service',
    title: 'Terms of Service',
    description:
      'LISTD Terms of Service. Read our platform rules, user obligations, payment terms, and dispute resolution procedures.',
  },
  '/privacy': {
    label: 'Privacy Policy',
    title: 'Privacy Policy',
    description:
      'LISTD Privacy Policy. Learn how we collect, use, and protect your personal data in compliance with UK GDPR.',
  },
  '/cookies': {
    label: 'Cookie Policy',
    title: 'Cookie Policy',
    description:
      'LISTD Cookie Policy. Learn about the cookies we use and how to manage your preferences.',
  },
}

export const MARKETING_META_PATHS = Object.keys(DEFAULT_MARKETING_META)

/** Load the admin overrides (cached 5 min; busted on save). Defensive: a
 *  malformed blob or DB hiccup yields no overrides, never a broken page. */
export async function loadSeoOverrides(): Promise<SeoMetaOverrides> {
  return getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    try {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, SEO_META_KEY))
        .limit(1)
      if (!row?.value) return {}
      const parsed = JSON.parse(row.value) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      const out: SeoMetaOverrides = {}
      for (const [path, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!DEFAULT_MARKETING_META[path] || !v || typeof v !== 'object') continue
        const { title, description, keywords, jsonLd } = v as Record<
          string,
          unknown
        >
        const entry: SeoMetaOverride = {}
        if (typeof title === 'string' && title.trim()) entry.title = title.trim()
        if (typeof description === 'string' && description.trim()) {
          entry.description = description.trim()
        }
        if (typeof keywords === 'string' && keywords.trim()) {
          entry.keywords = keywords.trim()
        }
        if (typeof jsonLd === 'string' && jsonLd.trim()) {
          entry.jsonLd = jsonLd.trim()
        }
        if (entry.title || entry.description || entry.keywords || entry.jsonLd) {
          out[path] = entry
        }
      }
      return out
    } catch (err) {
      console.warn('[seo-meta] overrides unavailable; using defaults:', err)
      return {}
    }
  })
}

/**
 * The full Metadata object for a marketing page — code defaults overlaid
 * with any admin override. Called from each page's `generateMetadata`.
 */
export async function buildMarketingMetadata(path: string): Promise<Metadata> {
  const d = DEFAULT_MARKETING_META[path]
  if (!d) return {}
  const o = (await loadSeoOverrides())[path]
  const title = o?.title ?? d.title
  const description = o?.description ?? d.description
  const keywords = o?.keywords
    ?.split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  return {
    title,
    description,
    ...(keywords?.length ? { keywords } : {}),
    alternates: { canonical: path },
    openGraph: {
      title: o?.title ?? d.ogTitle ?? d.title,
      description: o?.description ?? d.ogDescription ?? d.description,
      url: path,
      type: 'website',
    },
  }
}

/**
 * The page's JSON-LD payload, ready to inline into an
 * `application/ld+json` script tag — or null when the page has none.
 * Re-serialised from the parsed document (never the raw editor string) with
 * `<` escaped, so a crafted "</script>" can't break out of the tag.
 */
export async function loadJsonLdForPath(path: string): Promise<string | null> {
  const raw = (await loadSeoOverrides())[path]?.jsonLd
  if (!raw) return null
  try {
    return JSON.stringify(JSON.parse(raw)).replace(/</g, '\\u003c')
  } catch {
    // Should be unreachable (the save API validates), but a bad blob must
    // never break the public page.
    return null
  }
}

/** Persist the overrides blob (admin API). Caller has verified the admin
 *  role; entries are validated against the known path set. */
export async function saveSeoOverrides(
  overrides: SeoMetaOverrides,
  actorUserId: string
): Promise<void> {
  const value = JSON.stringify(overrides)
  await withServiceRole((tx) =>
    tx
      .insert(platformSettings)
      .values({
        key: SEO_META_KEY,
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
