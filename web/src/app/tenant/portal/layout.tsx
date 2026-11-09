import Link from 'next/link'
import { SupportChat } from '@/components/assistant/support-chat'
import { PortalTabNav } from './_components/portal-tab-nav'

/**
 * Tenant portal chrome.
 *
 * Token validation lives in the individual page server components, not
 * here, because Next.js layouts don't get `searchParams` and the token is
 * the entire credential. Each page resolves the token before rendering;
 * this layout is purely the visual shell.
 */
export default function TenantPortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/tenant/portal" className="font-semibold text-lg">
            LISTD
          </Link>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Tenant Portal
          </span>
        </div>
      </header>

      <PortalTabNav />

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>

      <footer className="border-t border-border py-4 text-center text-[10px] text-muted-foreground">
        Powered by LISTD · Property Inspection Platform
      </footer>

      <SupportChat
        endpoint="/api/assistant/tenant-chat"
        tenantMode
        greeting="Hi! I’m LISTD Helper. Ask me about your report, how to sign it, or what anything means."
        suggestions={[
          'How do I sign my report?',
          'What does this report mean?',
          'How do I raise a query?',
        ]}
      />
    </div>
  )
}
