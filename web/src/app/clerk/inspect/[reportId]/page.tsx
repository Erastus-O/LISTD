import { PlaceholderPage } from '@/components/placeholder-page'

type Props = { params: Promise<{ reportId: string }> }

export default async function ClerkInspectionCapturePage({ params }: Props) {
  const { reportId } = await params
  return (
    <PlaceholderPage
      title={`Clerk · Inspection Capture (report ${reportId})`}
      port="src/pages/clerk/InspectionCapture.tsx"
    />
  )
}
