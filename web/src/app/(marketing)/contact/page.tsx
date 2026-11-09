import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { ContactView } from '@/components/site/views/contact'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/contact')
}

export default function ContactPage() {
  return (
    <>
      <SeoJsonLd path="/contact" />
      <ContactView />
    </>
  )
}
