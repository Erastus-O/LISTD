'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  LogIn,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type Props = {
  token: string
  isSignedIn: boolean
  isAlreadyClerk: boolean
  invitationEmail: string
}

export function AcceptInviteActions({
  token,
  isSignedIn,
  isAlreadyClerk,
}: Props) {
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (success) {
    return (
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-4" />
          <CardTitle>Welcome to LISTD!</CardTitle>
          <CardDescription>
            You&rsquo;ve successfully joined as a Pro. Redirecting
            to your dashboard...
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Not signed in: prompt sign-up / sign-in with redirect back here.
  if (!isSignedIn) {
    const redirectBack = `/accept-invite?token=${encodeURIComponent(token)}`
    return (
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <UserPlus className="w-12 h-12 text-primary mx-auto mb-4" />
          <CardTitle>You&rsquo;re Invited!</CardTitle>
          <CardDescription>
            You&rsquo;ve been invited to join LISTD as a Pro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Create an account or log in to accept this invitation.
          </p>
          <div className="flex flex-col gap-3">
            <Button asChild size="lg">
              <Link
                href={`/auth?tab=signup&redirect=${encodeURIComponent(redirectBack)}`}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Account
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/auth?redirect=${encodeURIComponent(redirectBack)}`}>
                <LogIn className="w-4 h-4 mr-2" />
                Log In
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Already a clerk: tell them, send to dashboard.
  if (isAlreadyClerk) {
    return (
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <XCircle className="w-12 h-12 text-warning mx-auto mb-4" />
          <CardTitle>Already a Pro</CardTitle>
          <CardDescription>
            You&rsquo;re already registered as a Pro on LISTD.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild>
            <Link href="/clerk/dashboard">Go to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      const res = await fetch('/api/invitations/clerk/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string })
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setSuccess(true)
      setTimeout(() => {
        router.push('/clerk/dashboard')
        router.refresh()
      }, 2000)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to accept invitation.'
      )
    } finally {
      setAccepting(false)
    }
  }

  return (
    <Card className="max-w-md w-full">
      <CardHeader className="text-center">
        <UserPlus className="w-12 h-12 text-primary mx-auto mb-4" />
        <CardTitle>Join LISTD as a Pro</CardTitle>
        <CardDescription>
          Accept this invitation to join as a Pro. You&rsquo;ll be
          able to conduct inspections and submit reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm text-center">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={handleAccept} disabled={accepting}>
            {accepting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Accepting...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Accept Invitation
              </>
            )}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Cancel</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
