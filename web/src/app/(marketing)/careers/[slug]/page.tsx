import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, MapPin, PoundSterling } from 'lucide-react'
import { findOpenVacancy, type Vacancy } from '@/lib/careers'
import { ApplyButtons } from '@/components/careers/apply-buttons'
import { ApplicationForm } from '@/components/careers/application-form'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const v = await findOpenVacancy(slug)
  if (!v) return { title: 'Careers at LISTD' }
  const description =
    v.description.slice(0, 200) ||
    `Apply for ${v.title} at LISTD, ${v.location || 'UK'}.`
  return {
    title: `${v.title} – Careers at LISTD`,
    description,
    alternates: { canonical: `/careers/${v.slug ?? v.id}` },
    openGraph: {
      title: `${v.title} – Careers at LISTD`,
      description,
      type: 'website',
    },
  }
}

/**
 * Public vacancy page + LISTD-hosted application form. This URL is what the
 * admin pastes into Indeed / LinkedIn as the "apply on company website"
 * link — applicants arriving from those boards complete the application
 * right here (POST /api/careers/apply). Roles that also carry outbound
 * posting links offer those as alternatives.
 */
export default async function VacancyPage({ params }: Props) {
  const { slug } = await params
  const vacancy = await findOpenVacancy(slug)
  if (!vacancy) notFound()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: vacancyJsonLd(vacancy) }}
      />

      <section className="s-phead tint s-wrap">
        <div className="s-in">
          <Link
            href="/careers"
            className="s-kicker inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            All open roles
          </Link>
          <h1 className="s-h1">{vacancy.title}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm s-muted">
            {vacancy.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {vacancy.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {vacancy.employmentType}
            </span>
            {vacancy.salary && (
              <span className="inline-flex items-center gap-1.5">
                <PoundSterling className="h-4 w-4" />
                {vacancy.salary}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="s-sec s-wrap">
        <div className="s-in max-w-[820px] space-y-12">
          {vacancy.description && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">
                About the role
              </h2>
              <p className="leading-relaxed whitespace-pre-line text-muted-foreground">
                {vacancy.description}
              </p>
            </div>
          )}

          <div id="apply" className="ld-card p-8 scroll-mt-28">
            <h2 className="text-lg font-semibold">Apply for this role</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Complete the form below. We review every application and reply
              by email.
            </p>
            <div className="mt-6">
              <ApplicationForm vacancySlug={vacancy.slug ?? vacancy.id} />
            </div>
          </div>

          {(vacancy.indeedUrl || vacancy.linkedinUrl) && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                Prefer to apply elsewhere?
              </h3>
              <ApplyButtons
                indeedUrl={vacancy.indeedUrl}
                linkedinUrl={vacancy.linkedinUrl}
                compact
              />
            </div>
          )}
        </div>
      </section>
    </>
  )
}

/** Google Jobs structured data, pointing at THIS page (direct apply). */
function vacancyJsonLd(v: Vacancy): string {
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: v.title,
    description: v.description || v.title,
    datePosted: v.createdAt.slice(0, 10),
    employmentType: v.employmentType.toUpperCase().replace(/[^A-Z]/g, '_'),
    directApply: true,
    hiringOrganization: {
      '@type': 'Organization',
      name: 'LISTD',
      sameAs: 'https://www.listd.co.uk',
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: v.location || 'UK',
        addressCountry: 'GB',
      },
    },
    url: `https://www.listd.co.uk/careers/${v.slug ?? v.id}`,
  }
  return JSON.stringify(posting).replace(/</g, '\\u003c')
}
