import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { CtaBand } from '@/components/site/views/cta-band'
import { CleanersSection } from '@/components/site/views/cleaners-section'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/for-cleaners')
}

export default function ForCleanersPage() {
  return (
    <>
      <SeoJsonLd path="/for-cleaners" />
      <section className="s-phead tint s-wrap">
        <div className="s-in">
          <span className="s-kicker" style={{ color: 'var(--service-cleaning-text)' }}>
            For cleaning professionals
          </span>
          <h1 className="s-h1" style={{ maxWidth: '16ch' }}>
            Cleaning jobs that come to you
          </h1>
          <p className="s-lead">
            Clear standards, a room-by-room checklist on every job, and pay you can see before you
            accept.
          </p>
        </div>
      </section>
      <CleanersSection />
      <CtaBand />
    </>
  )
}
