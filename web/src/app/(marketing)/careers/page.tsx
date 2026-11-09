import type { Metadata } from 'next'
import Link from 'next/link'
import { Briefcase, Clock, MapPin, PoundSterling } from 'lucide-react'
import { buildMarketingMetadata } from '@/lib/seo-meta'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { loadOpenVacancies, type Vacancy } from '@/lib/careers'
import { ApplyButtons } from '@/components/careers/apply-buttons'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/careers')
}

/**
 * /careers — public vacancy list, admin-managed on /admin/careers. Each
 * role's Apply buttons deep-link into the Indeed / LinkedIn posting the
 * admin saved, so applicants complete the application there. JobPosting
 * structured data is auto-generated per open role for Google Jobs.
 */
export default async function CareersPage() {
  const vacancies = await loadOpenVacancies()

  return (
    <>
      <SeoJsonLd path="/careers" />
      {vacancies.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jobPostingsJsonLd(vacancies) }}
        />
      )}

      <section className="s-phead tint s-wrap">
        <div className="s-in">
          <span className="s-kicker">Careers at LISTD</span>
          <h1 className="s-h1" style={{ maxWidth: '16ch' }}>
            Help build the UK&rsquo;s most trusted property services platform
          </h1>
          <p className="s-lead">
            We hire people who care about transparency, evidence and doing right by clients, Pros
            and tenants.
          </p>
        </div>
      </section>

      <section className="s-sec s-wrap">
        <div className="s-in">
          {vacancies.length === 0 ? (
            <div className="ld-empty">
              <Briefcase className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h2 className="text-xl font-semibold text-foreground">
                No open roles right now
              </h2>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                We post every vacancy here first. Check back soon, or follow
                LISTD on LinkedIn to hear about new roles as they open.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
                {vacancies.length} open role{vacancies.length === 1 ? '' : 's'}
              </h2>
              {vacancies.map((v) => (
                <article
                  key={v.id}
                  className="ld-card p-8"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-xl font-semibold text-foreground">
                        <Link
                          href={`/careers/${v.slug ?? v.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {v.title}
                        </Link>
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                        {v.location && (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            {v.location}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {v.employmentType}
                        </span>
                        {v.salary && (
                          <span className="inline-flex items-center gap-1.5">
                            <PoundSterling className="h-3.5 w-3.5" />
                            {v.salary}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {v.description && (
                    <p className="mt-4 leading-relaxed whitespace-pre-line text-muted-foreground">
                      {v.description}
                    </p>
                  )}
                  <div className="mt-6">
                    <ApplyButtons
                      applyPath={`/careers/${v.slug ?? v.id}#apply`}
                      indeedUrl={v.indeedUrl}
                      linkedinUrl={v.linkedinUrl}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

/**
 * Google Jobs structured data — one JobPosting per open role, pointing at
 * the admin-saved application URL. Serialised with `<` escaped so the
 * inline script can't be broken out of.
 */
function jobPostingsJsonLd(vacancies: Vacancy[]): string {
  const postings = vacancies.map((v) => ({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: v.title,
    description: v.description || v.title,
    datePosted: v.createdAt.slice(0, 10),
    employmentType: v.employmentType.toUpperCase().replace(/[^A-Z]/g, '_'),
    hiringOrganization: {
      '@type': 'Organization',
      name: 'LISTD',
      sameAs: 'https://www.listd.co.uk',
    },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: v.location || 'UK', addressCountry: 'GB' },
    },
    ...(v.salary ? { baseSalary: v.salary } : {}),
    directApply: true,
    url: `https://www.listd.co.uk/careers/${v.slug ?? v.id}`,
  }))
  return JSON.stringify(postings).replace(/</g, '\\u003c')
}
