import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { CtaBand } from '@/components/site/views/cta-band'
import { AboutView } from '@/components/site/views/about'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/about')
}

export default function AboutPage() {
  return (
    <>
      <SeoJsonLd path="/about" />
      <AboutView />
      <CtaBand />
    </>
  )
}
