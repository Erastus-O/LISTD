import type { Metadata } from 'next'
import { buildMarketingMetadata } from '@/lib/seo-meta'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/cookies')
}

type Cookie = { name: string; purpose: string; duration: string }

const ESSENTIAL: Cookie[] = [
  {
    name: 'sb-auth-token',
    purpose: 'Keeps you logged in to your LISTD account',
    duration: 'Session',
  },
  {
    name: 'sb-refresh-token',
    purpose: 'Refreshes your authentication session automatically',
    duration: '7 days',
  },
]

const ANALYTICS: Cookie[] = [
  {
    name: '_ga',
    purpose: 'Google Analytics : tracks page views and sessions',
    duration: '2 years',
  },
  {
    name: '_ga_*',
    purpose: 'Google Analytics : session identifier',
    duration: '2 years',
  },
]

const FUNCTIONAL: Cookie[] = [
  {
    name: 'ui-theme',
    purpose: 'Stores your light/dark mode preference',
    duration: '1 year',
  },
]

export default function CookiesPage() {
  return (
    <div className="pt-16 pb-24 px-6 md:px-12">
      <SeoJsonLd path="/cookies" />
      <div className="max-w-[820px] mx-auto">
        <h1 className="font-display text-4xl text-foreground mb-2">
          Cookie Policy
        </h1>
        <p className="text-sm text-muted-foreground mb-12">
          Last updated: February 2026
        </p>

        <div className="space-y-10 text-foreground">
          <Section title="1. What Are Cookies?">
            <p>
              Cookies are small text files placed on your device when you visit a
              website. They help websites remember your preferences, keep you
              logged in, and understand how you use the site.
            </p>
          </Section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Cookies We Use
            </h2>
            <div className="space-y-6">
              <CookieGroup
                title="Essential Cookies"
                description="Required for the platform to function. Cannot be disabled."
                cookies={ESSENTIAL}
              />
              <CookieGroup
                title="Analytics Cookies"
                description="Help us understand how visitors use the platform (anonymised). You can opt out."
                cookies={ANALYTICS}
              />
              <CookieGroup
                title="Functional Cookies"
                description="Remember your preferences and settings."
                cookies={FUNCTIONAL}
              />
            </div>
          </section>

          <Section title="3. Managing Cookies">
            <p className="mb-3">
              You can control and delete cookies through your browser settings.
              Note that disabling essential cookies will prevent you from logging
              in or using core platform features.
            </p>
            <p>
              For browser-specific instructions, visit:{' '}
              <a
                href="https://www.aboutcookies.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                aboutcookies.org
              </a>
              .
            </p>
          </Section>

          <Section title="4. Third-Party Cookies">
            <p>
              Some features may load content from third parties (e.g. Google
              Maps, embedded widgets). These third parties may set their own
              cookies governed by their privacy policies. LISTD does not control
              these cookies.
            </p>
          </Section>

          <Section title="5. Updates">
            <p>
              We may update this Cookie Policy as our platform evolves. Check
              this page periodically for changes.
            </p>
          </Section>

          <Section title="6. Contact">
            <p>
              Questions about our cookie use? Email{' '}
              <a
                href="mailto:support@listd.co.uk"
                className="text-primary hover:underline"
              >
                support@listd.co.uk
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-foreground mb-3">{title}</h2>
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </section>
  )
}

type CookieGroupProps = {
  title: string
  description: string
  cookies: Cookie[]
}

function CookieGroup({ title, description, cookies }: CookieGroupProps) {
  return (
    <div className="border border-border rounded-lg p-5">
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      <div className="space-y-2">
        {cookies.map((c) => (
          <div
            key={c.name}
            className="grid grid-cols-[1fr_2fr_auto] gap-4 text-xs text-muted-foreground border-t border-border pt-2"
          >
            <code className="text-foreground font-mono">{c.name}</code>
            <span>{c.purpose}</span>
            <span>{c.duration}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
