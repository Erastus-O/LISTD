import Link from 'next/link'
import type { Metadata } from 'next'
import { buildMarketingMetadata } from '@/lib/seo-meta'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'
import { PRIVACY_POLICY_LABEL, PRIVACY_POLICY_VERSION } from '@/lib/legal/policy'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/privacy')
}

export default function PrivacyPage() {
  return (
    <div className="pt-16 pb-24 px-6 md:px-12">
      <SeoJsonLd path="/privacy" />
      <div className="max-w-[820px] mx-auto">
        <h1 className="font-display text-4xl text-foreground mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-muted-foreground mb-12">
          Version {PRIVACY_POLICY_VERSION} · Last updated {PRIVACY_POLICY_LABEL}
        </p>

        <div className="space-y-10 text-foreground">
          <Section title="1. Who We Are">
            <p>
              LISTD operates the property services platform at listd.co.uk. For
              the purposes of UK GDPR, LISTD is the data controller for personal
              information collected through this platform. Contact us at{' '}
              <a
                href="mailto:support@listd.co.uk"
                className="text-primary hover:underline"
              >
                support@listd.co.uk
              </a>
              .
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <ul>
              <li>
                <strong className="text-foreground">Account data:</strong> Name,
                email address, phone number, company name.
              </li>
              <li>
                <strong className="text-foreground">Professional data (Pros):</strong>{' '}
                Qualifications, verification documents, DBS information,
                professional indemnity insurance details.
              </li>
              <li>
                <strong className="text-foreground">Property data:</strong>{' '}
                Property addresses, room counts, inspection details.
              </li>
              <li>
                <strong className="text-foreground">Transaction data:</strong>{' '}
                Payment amounts, job history, payout records.
              </li>
              <li>
                <strong className="text-foreground">Usage data:</strong> Log data,
                IP addresses, device information, page views.
              </li>
              <li>
                <strong className="text-foreground">Communications:</strong>{' '}
                Messages exchanged on the platform, support enquiries.
              </li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul>
              <li>To provide and operate the LISTD platform.</li>
              <li>To verify Pro identity and professional qualifications.</li>
              <li>To process payments and manage escrow.</li>
              <li>To facilitate job matching, communication, and report delivery.</li>
              <li>To send service updates, notifications, and support responses.</li>
              <li>To comply with legal obligations.</li>
              <li>To improve our platform based on usage patterns (anonymised).</li>
            </ul>
          </Section>

          <Section title="4. Legal Basis for Processing">
            <p>
              We process your data on the following legal bases: (a) contract
              performance: to deliver the services you have signed up for; (b)
              legitimate interests: to operate and improve our platform; (c)
              legal obligation: where required by law; and (d) consent: where
              you have explicitly opted in.
            </p>
          </Section>

          <Section title="5. Data Sharing">
            <p className="mb-3">
              We do not sell your data. We share data only where necessary:
            </p>
            <ul>
              <li>
                <strong className="text-foreground">Pros:</strong> Property
                address and client instructions for assigned jobs.
              </li>
              <li>
                <strong className="text-foreground">Clients:</strong> Assigned
                Pro name and contact information for booked jobs.
              </li>
              <li>
                <strong className="text-foreground">Payment processors:</strong>{' '}
                For transaction processing only.
              </li>
              <li>
                <strong className="text-foreground">Legal authorities:</strong>{' '}
                Where required by law or court order.
              </li>
              <li>
                <strong className="text-foreground">Service providers:</strong>{' '}
                Hosting, email delivery, and support tools under data processing
                agreements.
              </li>
            </ul>
          </Section>

          <Section title="6. Data Retention">
            <p>
              We retain personal data for as long as your account is active and
              for up to 7 years thereafter to comply with legal and financial
              obligations. Inspection reports may be retained for up to 10 years
              in line with property tenancy dispute requirements.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p className="mb-3">Under UK GDPR, you have the right to:</p>
            <ul>
              <li>Access a copy of your personal data.</li>
              <li>Correct inaccurate data we hold about you.</li>
              <li>Request deletion of your data (subject to legal obligations).</li>
              <li>Object to processing or request restriction of processing.</li>
              <li>Data portability in a machine-readable format.</li>
              <li>Withdraw consent at any time where processing is based on consent.</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact{' '}
              <a
                href="mailto:support@listd.co.uk"
                className="text-primary hover:underline"
              >
                support@listd.co.uk
              </a>
              . You also have the right to lodge a complaint with the Information
              Commissioner&rsquo;s Office (ICO) at ico.org.uk.
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              We use essential cookies to operate the platform (session
              management, authentication). We may use analytics cookies to
              understand usage. See our{' '}
              <Link href="/cookies" className="text-primary hover:underline">
                Cookie Policy
              </Link>{' '}
              for full details.
            </p>
          </Section>

          <Section title="9. Security">
            <p>
              We implement appropriate technical and organisational security
              measures to protect your data, including encryption in transit and
              at rest, access controls, and regular security reviews.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. We will notify
              registered users of material changes by email. Continued use of the
              platform after changes are published constitutes acceptance.
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
      <div className="text-muted-foreground leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  )
}
