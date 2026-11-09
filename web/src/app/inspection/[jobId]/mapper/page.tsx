import { PlaceholderPage } from '@/components/placeholder-page'

type Props = { params: Promise<{ jobId: string }> }

export default async function ConditionMapperPage({ params }: Props) {
  const { jobId } = await params
  return (
    <PlaceholderPage
      title={`Inspection · Condition Mapper (job ${jobId})`}
      port="src/pages/inspection/ConditionMapperPage.tsx"
    />
  )
}
