import type { Metadata } from 'next'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { CtaBand } from '@/components/site/views/cta-band'
import { ClientsSection } from '@/components/site/views/clients-section'
import { buildMarketingMetadata } from '@/lib/seo-meta'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/for-clients')
}

export default function ForClientsPage() {
  return (
    <>
      <SeoJsonLd path="/for-clients" />
      <section className="s-phead tint s-wrap">
        <div className="s-in">
          <span className="s-kicker">For agents, landlords and managers</span>
          <h1 className="s-h1" style={{ maxWidth: '16ch' }}>
            Property services without the admin
          </h1>
          <p className="s-lead">
            Book inventories, inspections, repairs and cleaning through one structured, tracked
            network of verified Pros.
          </p>
        </div>
      </section>
      <div style={{ paddingTop: 'var(--space-16)' }}>
        <ClientsSection />
      </div>
      <CtaBand />
    </>
  )
}
