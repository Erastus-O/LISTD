import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppRole } from '@/lib/dal'

/**
 * Server-side reader for the role-scoped user guides at
 * `Docs/guides/{slug}.md`. Markdown source is git-tracked so PR review
 * catches doc drift the same way it catches code drift.
 *
 * Each guide has a small frontmatter block:
 *
 *   ---
 *   title: Clerk Handbook
 *   role: clerk
 *   summary: A field guide for verified LISTD clerks.
 *   updated: 2026-05-17
 *   ---
 *
 * We parse it with a tiny hand-rolled splitter instead of gray-matter —
 * the format is constrained, the parser is six lines, and we skip a
 * dependency. If we ever need richer frontmatter we can swap in.
 */

export type GuideSlug = 'admin' | 'client' | 'worker' | 'clerk'

export type GuideMeta = {
  slug: GuideSlug
  title: string
  summary: string
  /** Which app roles see this guide on the /help index. Admins always
   *  see everything regardless. */
  visibleTo: AppRole[]
  /** Last-edited date (ISO YYYY-MM-DD) — sourced from the frontmatter
   *  `updated:` field. */
  updated: string | null
}

export type Guide = GuideMeta & {
  /** Raw markdown body, frontmatter stripped. Pass straight into
   *  `<ReactMarkdown>`. */
  content: string
}

/**
 * Canonical list of guides. Updating this list IS how a new guide
 * shows up in the /help index — the page reads from here, never
 * scans the filesystem at runtime.
 */
const GUIDES: Array<Omit<GuideMeta, 'updated'> & { filename: string }> = [
  {
    slug: 'clerk',
    title: 'Pro Handbook',
    summary: 'Field guide for verified LISTD Pros : capture, sync, submit.',
    visibleTo: ['clerk'],
    filename: 'clerk.md',
  },
  {
    slug: 'client',
    title: 'Client Guide',
    summary: 'Book inspections, track progress, review and sign off reports.',
    visibleTo: ['client'],
    filename: 'client.md',
  },
  {
    slug: 'worker',
    title: 'Worker Guide',
    summary: 'Manage bookings on behalf of your organisation (for org members).',
    // Workers are `client`-role users distinguished by their
    // organisation_members.org_role rather than a top-level app role,
    // so the visibility filter targets clients. Solo clients see this
    // guide listed too — title + summary make the audience clear.
    visibleTo: ['client'],
    filename: 'worker.md',
  },
  {
    slug: 'admin',
    title: 'Admin Operations Guide',
    summary:
      'Quality review, dispute handling, clerk verification, platform settings.',
    visibleTo: ['admin'],
    filename: 'admin.md',
  },
]

// Tenants aren't a Supabase app_role (they hit the portal via a magic
// token, no session), so the /help routes — gated by requireSession — can't
// serve them. The tenant guide lives in `content/guides/tenant.md` and is
// rendered by `/tenant/portal/help`, which validates the token instead.

export type TenantGuide = {
  title: string
  summary: string
  updated: string | null
  content: string
}

/** Tenant-portal counterpart to `loadGuide` — no role gate because the
 *  caller (the portal page) has already validated the magic token. */
export async function loadTenantGuide(): Promise<TenantGuide | null> {
  const filePath = path.join(GUIDES_DIR, 'tenant.md')
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const { frontmatter, body } = splitFrontmatter(raw)
  return {
    title: frontmatter.title ?? 'Tenant Guide',
    summary: frontmatter.summary ?? '',
    updated: frontmatter.updated ?? null,
    content: body,
  }
}

// Guides live inside the Next app so they ship with the deployment — the
// previous `../Docs/guides` path 404'd on Vercel (and in the flat prod
// repo) because those files weren't bundled. `next.config` traces this
// directory into the serverless functions via `outputFileTracingIncludes`.
const GUIDES_DIR = path.resolve(process.cwd(), 'content', 'guides')

/**
 * Return the metadata for every guide visible to the caller's roles.
 * Admins see all. Each guide is opened once to extract its `updated`
 * date; the body is NOT loaded here — call `loadGuide(slug)` for that.
 */
export async function listGuidesFor(roles: AppRole[]): Promise<GuideMeta[]> {
  const isAdmin = roles.includes('admin')
  const visible = GUIDES.filter(
    (g) => isAdmin || g.visibleTo.some((r) => roles.includes(r))
  )
  // Read `updated:` out of frontmatter for each. Cheap — < 1KB read
  // per file, files are tiny.
  const results: GuideMeta[] = []
  for (const g of visible) {
    const updated = await safeReadUpdated(g.filename)
    results.push({
      slug: g.slug,
      title: g.title,
      summary: g.summary,
      visibleTo: g.visibleTo,
      updated,
    })
  }
  return results
}

/**
 * Load a single guide's full content. Returns null if:
 *   - the slug doesn't match a known guide
 *   - the caller's roles can't see this guide (and they're not admin)
 *   - the file is missing on disk
 */
export async function loadGuide(
  slug: string,
  roles: AppRole[]
): Promise<Guide | null> {
  const meta = GUIDES.find((g) => g.slug === slug)
  if (!meta) return null
  const isAdmin = roles.includes('admin')
  if (!isAdmin && !meta.visibleTo.some((r) => roles.includes(r))) {
    return null
  }
  const filePath = path.join(GUIDES_DIR, meta.filename)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const { frontmatter, body } = splitFrontmatter(raw)
  return {
    slug: meta.slug,
    title: meta.title,
    summary: meta.summary,
    visibleTo: meta.visibleTo,
    updated: frontmatter.updated ?? null,
    content: body,
  }
}

// ── helpers ─────────────────────────────────────────────────────────

async function safeReadUpdated(filename: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(GUIDES_DIR, filename), 'utf8')
    return splitFrontmatter(raw).frontmatter.updated ?? null
  } catch {
    return null
  }
}

/**
 * Tiny `---`-fenced frontmatter splitter. Recognises `key: value` pairs
 * separated by `:`; values are trimmed strings. No quoting, no nested
 * structure, no arrays — keep the guide files boring. If we ever need
 * richer frontmatter, swap in `gray-matter`.
 */
function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>
  body: string
} {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { frontmatter: {}, body: raw }
  const fmBlock = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const frontmatter: Record<string, string> = {}
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) frontmatter[key] = value
  }
  return { frontmatter, body }
}
