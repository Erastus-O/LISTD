import { redirect } from 'next/navigation'

type Props = { params: Promise<{ jobId: string }> }

/**
 * Worker report detail — redirects to the canonical client viewer at
 * `/client/reports/[jobId]`. Workers are `client`-role users with an
 * org-worker membership, and the client viewer's auth check
 * (`loadClientJobDetail` scoped to `session.userId`) already passes
 * for them.
 *
 * Why a redirect and not a duplicate page: the body of the worker
 * viewer would be byte-for-byte identical to the client viewer (same
 * data, same auth, same sign-off-CTA logic) — keeping two copies
 * means every future tweak ships twice. The redirect preserves the
 * `/worker/...` URL space for navigation consistency while keeping
 * one canonical implementation.
 */
export default async function WorkerReportRedirect({ params }: Props) {
  const { jobId } = await params
  redirect(`/client/reports/${jobId}`)
}
