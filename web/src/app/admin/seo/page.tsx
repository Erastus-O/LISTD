import { Search } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import {
  DEFAULT_MARKETING_META,
  MARKETING_META_PATHS,
  loadSeoOverrides,
} from '@/lib/seo-meta'
import { loadSiteScripts } from '@/lib/site-scripts'
import { SeoMetaForm } from './_components/seo-meta-form'
import { SiteScriptsForm } from './_components/site-scripts-form'

export const metadata = { title: 'Admin · SEO' }
export const dynamic = 'force-dynamic'

/**
 * Admin SEO editor — per-page title + description for the public marketing
 * site, editable without a deploy. Overrides layer over the code defaults;
 * clearing a field falls back to the default. Saving revalidates the pages,
 * so changes are live within seconds.
 */
export default async function AdminSeoPage() {
  // 'marketing' is the SEO agency's restricted seat — this page (plus its
  // save API) is the only admin surface it can reach.
  await requireRole('admin', 'marketing')
  const [overrides, scripts] = await Promise.all([
    loadSeoOverrides(),
    loadSiteScripts(),
  ])

  const rows = MARKETING_META_PATHS.map((path) => {
    const d = DEFAULT_MARKETING_META[path]
    return {
      path,
      label: d.label,
      defaultTitle: d.title,
      defaultDescription: d.description,
      title: overrides[path]?.title ?? '',
      description: overrides[path]?.description ?? '',
      keywords: overrides[path]?.keywords ?? '',
      jsonLd: overrides[path]?.jsonLd ?? '',
    }
  })

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl text-foreground">
          <Search className="h-6 w-6 text-primary" />
          SEO
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit each public page&rsquo;s meta title, description, keywords and
          JSON-LD schema. Leave a field empty to use the built-in default.
          Changes go live within seconds of saving. No deploy needed.
        </p>
      </div>
      <SiteScriptsForm
        initialHead={scripts.head}
        initialBodyEnd={scripts.bodyEnd}
      />

      <div>
        <h2 className="text-xl font-semibold text-foreground">Page meta</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Title, description, keywords and JSON-LD schema per public page.
        </p>
      </div>
      <SeoMetaForm initialRows={rows} />
    </div>
  )
}
