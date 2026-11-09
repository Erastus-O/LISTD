'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function OnboardingActions() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleComplete() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/onboarding/complete', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push('/post-signin')
      router.refresh()
    } catch (err) {
      console.error('[onboarding] complete failed:', err)
      toast.error('Failed to complete onboarding', {
        description: 'Please try again or contact support.',
      })
      setSubmitting(false)
    }
  }

  return (
    <Button size="lg" onClick={handleComplete} disabled={submitting}>
      {submitting ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Completing...
        </>
      ) : (
        'Complete onboarding'
      )}
    </Button>
  )
}
