import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { CtaBand } from '@/components/site/views/cta-band'
import { ProsView } from '@/components/site/views/pros'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/for-clerks')
}

export default function ForProsPage() {
  return (
    <>
      <SeoJsonLd path="/for-clerks" />
      <ProsView />
      <CtaBand />
    </>
  )
}
