import { SiteBehaviors } from '@/components/site/site-behaviors'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SiteScripts } from '@/components/seo/site-scripts'
import { loadSiteScripts } from '@/lib/site-scripts'
import './site-theme.css'

/**
 * Layout for public marketing + legal pages.
 *
 * Site-wide marketing/tracking code (pasted on /admin/seo) is injected here,
 * so it runs on every page in this group (exactly the set listed in
 * sitemap.xml) and nowhere else. The authenticated app deliberately never
 * executes it.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const scripts = await loadSiteScripts()
  return (
    <>
      <SiteScripts html={scripts.head} slot="head" />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <SiteBehaviors />
      <SiteScripts html={scripts.bodyEnd} slot="bodyEnd" />
    </>
  )
}
