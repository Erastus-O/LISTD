import type { Metadata } from 'next'
import { Inter_Tight, Raleway, Rammetto_One } from 'next/font/google'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import { IconSprite } from '@/components/listd/icon'
import { Providers } from './providers'
import './globals.css'

// LISTD design system faces. globals.css points the token font stacks at these.
const interTight = Inter_Tight({
  variable: '--font-inter-tight',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const raleway = Raleway({
  variable: '--font-raleway',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
})

const rammetto = Rammetto_One({
  variable: '--font-rammetto',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
})

export const metadata: Metadata = {
  // Canonical host. Relative `alternates.canonical` / openGraph URLs on
  // individual pages resolve against this — keep it in step with the domain
  // the app is actually served from (currently www).
  metadataBase: new URL('https://www.listd.co.uk'),
  title: {
    default: 'LISTD | The Property Services Platform',
    template: '%s | LISTD',
  },
  description:
    'Book inventories, inspections, cleaning and property services through one transparent platform. Verified Pros, real-time updates, evidence-backed delivery.',
  authors: [{ name: 'LISTD' }],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // Light only for now: existing screens carry hard-coded light colours,
      // so the token set's automatic dark mode stays off until they're rebuilt.
      data-theme="light"
      className={`${interTight.variable} ${raleway.variable} ${rammetto.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <IconSprite />
        <Providers>{children}</Providers>
        {/* Vercel Analytics — page-view + Web Vitals reporter. Lives at the
         * document level so every route fires its own pageview when the
         * App Router pushes a new entry; respects the visitor's DNT
         * setting automatically. No PII is sent. */}
        <Analytics />
        {/* Trustpilot widget bootstrap. Loaded once at the document level so
         * `window.Trustpilot.loadFromElement(...)` is available to the
         * landing page's TrustpilotWidget client component. Strategy
         * `afterInteractive` keeps it off the critical path.
         *
         * CSP origins (M2 #15) — when a Content-Security-Policy header is
         * added, it MUST allow:
         *   - script-src  https://*.trustpilot.com  (this bootstrap)
         *   - frame-src   https://widget.trustpilot.com  (iframe rendered by the bootstrap)
         *   - img-src     https://*.trustpilot.com  (star imagery + author avatars)
         *   - connect-src https://*.trustpilot.com  (review fetch)
         * See [Docs/M2-CSP-Requirements.md](../../Docs/M2-CSP-Requirements.md). */}
        <Script
          src="//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
