import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { CtaBand } from '@/components/site/views/cta-band'
import { HowItWorksView } from '@/components/site/views/how-it-works'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/how-it-works')
}

export default function HowItWorksPage() {
  return (
    <>
      <SeoJsonLd path="/how-it-works" />
      <HowItWorksView />
      <CtaBand />
    </>
  )
}
