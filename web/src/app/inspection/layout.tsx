import { requireRole } from '@/lib/dal'

/**
 * Lightweight layout for the standalone inspection capture flow that lives
 * outside the main `/clerk` shell. Same role gate (`clerk` or `admin`) as the
 * clerk layout — full-bleed UI to maximise capture surface area.
 */
export default async function InspectionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireRole('clerk', 'admin')
  return <div className="min-h-screen bg-background">{children}</div>
}
