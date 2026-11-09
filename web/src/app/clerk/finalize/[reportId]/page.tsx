import { PlaceholderPage } from '@/components/placeholder-page'

type Props = { params: Promise<{ reportId: string }> }

export default async function ClerkReportFinalizePage({ params }: Props) {
  const { reportId } = await params
  return (
    <PlaceholderPage
      title={`Clerk · Finalize Report ${reportId}`}
      port="src/pages/clerk/ReportFinalize.tsx"
    />
  )
}
