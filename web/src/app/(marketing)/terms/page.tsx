import type { Metadata } from 'next'
import { buildMarketingMetadata } from '@/lib/seo-meta'
import { SeoJsonLd } from '@/components/seo/seo-json-ld'

// Meta is CMS-editable: code defaults live in lib/seo-meta.ts and admin
// overrides (set on /admin/seo) are layered on top at request time.
export function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata('/terms')
}

export default function TermsPage() {
  return (
    <div className="pt-16 pb-24 px-6 md:px-12">
      <SeoJsonLd path="/terms" />
      <div className="max-w-[820px] mx-auto">
        <h1 className="font-display text-4xl text-foreground mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-muted-foreground mb-12">
          Last updated: February 2026
        </p>

        <div className="prose prose-sm max-w-none space-y-10 text-foreground">
          <Section title="1. About LISTD">
            <p>
              LISTD (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the
              platform&rdquo;) is a property services platform that connects
              clients (letting agents, landlords, and property managers) with
              verified professionals (&ldquo;Pros&rdquo;) delivering
              inventories, inspections, cleaning and other property services. By
              registering or using LISTD, you agree to these Terms of Service in
              full. If you do not agree, you must not use our platform.
            </p>
          </Section>

          <Section title="2. User Accounts &amp; Eligibility">
            <ul>
              <li>You must be at least 18 years old and able to form a legally binding contract.</li>
              <li>You must provide accurate, complete, and up-to-date information during registration.</li>
              <li>You are responsible for keeping your account credentials secure.</li>
              <li>LISTD reserves the right to suspend or terminate accounts that violate these terms.</li>
              <li>Pros must complete identity verification and onboarding before accessing live jobs.</li>
            </ul>
          </Section>

          <Section title="3. Platform Use">
            <p className="mb-3">You agree not to:</p>
            <ul>
              <li>Circumvent the platform to engage in private arrangements with Pros or clients found through LISTD.</li>
              <li>Provide false information, impersonate others, or misrepresent qualifications.</li>
              <li>Use the platform for any unlawful purpose.</li>
              <li>Interfere with the platform&rsquo;s operation or security.</li>
              <li>Resell access or share your account with third parties.</li>
            </ul>
          </Section>

          <Section title="4. Booking &amp; Job Acceptance">
            <ul>
              <li>Clients submit job requests which are published to eligible Pros on the platform.</li>
              <li>Jobs are matched based on Pro tier, availability, and location.</li>
              <li>Once a Pro accepts a job, both parties are contractually obligated to fulfil it.</li>
              <li>LISTD reserves the right to reassign jobs in cases of Pro cancellation or non-performance.</li>
            </ul>
          </Section>

          <Section title="5. Payment &amp; Escrow">
            <ul>
              <li>Clients pay the agreed job price upon booking confirmation.</li>
              <li>Funds are held in escrow by LISTD until the client accepts the delivered report.</li>
              <li>Pro payouts are released within the timeframe stated in the platform after client sign-off.</li>
              <li>LISTD retains a platform service fee from each transaction.</li>
              <li>Cancellation fees may apply based on how close to the job date the cancellation occurs.</li>
              <li>Refunds are issued at LISTD&rsquo;s discretion following dispute resolution.</li>
            </ul>
          </Section>

          <Section title="6. Service Tiers">
            <p>
              LISTD operates a tiered service structure (Flex, Pro, Elite) with
              corresponding quality standards and pricing. The service tier
              selected at booking determines the standards the assigned Pro
              must meet. Clients must select the appropriate tier for their
              property requirements.
            </p>
          </Section>

          <Section title="7. Pro Conduct &amp; Standards">
            <ul>
              <li>Pros must hold appropriate qualifications and professional indemnity insurance.</li>
              <li>Pros must attend jobs punctually and deliver reports to the agreed standard.</li>
              <li>Pros who fail to meet standards may receive strikes. Three active strikes may result in suspension.</li>
              <li>Pros must sign a Non-Circumvention Agreement before accessing live jobs.</li>
              <li>Pros progress through levels (1–5) based on jobs completed and client ratings.</li>
            </ul>
          </Section>

          <Section title="8. Disputes">
            <p>
              All disputes must be raised through the LISTD platform within 7
              days of report delivery. LISTD will review evidence from all
              parties and issue a resolution. LISTD&rsquo;s decision on disputes
              is final unless the matter is escalated to a competent court of
              jurisdiction.
            </p>
          </Section>

          <Section title="9. Non-Circumvention">
            <p>
              All users agree not to engage in direct commercial transactions
              with other users discovered through LISTD, outside of the
              platform, for a period of 24 months from the last platform-managed
              interaction. Breach of this agreement may result in account
              termination and legal action.
            </p>
          </Section>

          <Section title="10. Intellectual Property">
            <p>
              All platform content, software, branding, and design is the
              intellectual property of LISTD. You may not copy, reproduce, or
              distribute any part of the platform without prior written consent.
            </p>
          </Section>

          <Section title="11. Limitation of Liability">
            <p>
              LISTD acts as an intermediary platform. To the fullest extent
              permitted by law, LISTD shall not be liable for indirect,
              consequential, or incidental damages arising from the use of the
              platform. Our total liability shall not exceed the fees paid by
              you in the preceding 30 days.
            </p>
          </Section>

          <Section title="12. Termination">
            <p>
              LISTD reserves the right to suspend or terminate any account at
              its discretion for breach of these terms. Users may close their
              account at any time by contacting support. Outstanding jobs or
              payment obligations must be resolved before account closure.
            </p>
          </Section>

          <Section title="13. Governing Law">
            <p>
              These terms are governed by the laws of England and Wales. Any
              disputes shall be subject to the exclusive jurisdiction of the
              courts of England and Wales.
            </p>
          </Section>

          <Section title="14. Contact">
            <p>
              For queries about these Terms, contact us at{' '}
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
      <div className="text-muted-foreground leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  )
}
