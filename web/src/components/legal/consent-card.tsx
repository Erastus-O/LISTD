import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { profiles, withServiceRole } from '@/db'
import { PRIVACY_POLICY_VERSION } from '@/lib/legal/policy'

/**
 * "Legal & privacy" section for the role settings pages. Shows which Privacy
 * Policy version the user consented to and when, with links to read the
 * current documents.
 *
 * Best-effort: if the consent columns aren't present yet (a database that
 * hasn't run migration 0031) the query is caught and the card degrades to
 * a links-only view rather than throwing the whole settings page.
 */
export async function ConsentCard({ userId }: { userId: string }) {
  let version: string | null = null
  let acceptedAt: string | null = null
  try {
    const [row] = await withServiceRole((tx) =>
      tx
        .select({
          version: profiles.privacyPolicyVersion,
          acceptedAt: profiles.privacyPolicyAcceptedAt,
          createdAt: profiles.createdAt,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1)
    )
    version = row?.version ?? null
    // Fall back to account-creation date for any row not yet backfilled.
    acceptedAt = row?.acceptedAt ?? row?.createdAt ?? null
  } catch {
    // Pre-migration: consent columns missing — fall through to links-only.
  }

  const acceptedLabel = acceptedAt
    ? new Date(acceptedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null
  const isStale = Boolean(version && version !== PRIVACY_POLICY_VERSION)

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Legal &amp; privacy</h2>
        </div>

        {acceptedLabel ? (
          <p className="text-sm text-muted-foreground">
            You accepted our Privacy Policy
            {version ? ` (version ${version})` : ''} on{' '}
            <span className="font-medium text-foreground">{acceptedLabel}</span>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Review the documents that govern your use of LISTD.
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link
            href="/privacy"
            target="_blank"
            className="font-medium text-primary hover:underline"
          >
            {version
              ? `Privacy Policy (v${version})`
              : 'Privacy Policy'}
          </Link>
          <Link
            href="/terms"
            target="_blank"
            className="font-medium text-primary hover:underline"
          >
            Terms of Service
          </Link>
          <Link
            href="/compliance"
            className="font-medium text-primary hover:underline"
          >
            Insurance certificate
          </Link>
        </div>

        {isStale && (
          <p className="text-xs text-muted-foreground">
            Our Privacy Policy has been updated since you accepted it (current
            version {PRIVACY_POLICY_VERSION}). The link above always shows the
            latest.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
