import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

/**
 * Legacy upload-only flow — replaced by the structured inspection wizard
 * at `/clerk/jobs/[jobId]/inspect`. This page only exists to forward any
 * outstanding bookmarks / notification links so a clerk who follows an
 * older URL lands on the right surface.
 */
export default async function LegacySubmitReportRedirect({ params }: Props) {
  const { jobId } = await params
  redirect(`/clerk/jobs/${jobId}/inspect`)
}
