import type { Metadata } from 'next'
import { EarlyAccessForm } from './early-access-form'

export const metadata: Metadata = {
  title: 'Private Rollout – Early Access | LISTD',
  description: 'Request early access to the LISTD platform.',
  robots: { index: false, follow: false },
}

export default function EarlyAccessPage() {
  return <EarlyAccessForm />
}
