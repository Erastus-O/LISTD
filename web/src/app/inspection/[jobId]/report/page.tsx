import { PlaceholderPage } from '@/components/placeholder-page'

type Props = { params: Promise<{ jobId: string }> }

export default async function ConditionReportPage({ params }: Props) {
  const { jobId } = await params
  return (
    <PlaceholderPage
      title={`Inspection · Condition Report (job ${jobId})`}
      port="src/pages/inspection/ConditionReportPage.tsx"
    />
  )
}
