import { eq } from 'drizzle-orm'
import Link from 'next/link'
import type { Metadata } from 'next'
import { XCircle } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { clerkInvitations, withServiceRole } from '@/db'
import { getSession } from '@/lib/dal'
import { AcceptInviteActions } from './accept-invite-actions'

export const metadata: Metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
}

type Props = { searchParams: Promise<{ token?: string }> }

async function loadInvitation(token: string) {
  return withServiceRole(async (tx) => {
    const [row] = await tx
      .select({
        id: clerkInvitations.id,
        email: clerkInvitations.email,
        status: clerkInvitations.status,
        expiresAt: clerkInvitations.expiresAt,
        providerId: clerkInvitations.providerId,
      })
      .from(clerkInvitations)
      .where(eq(clerkInvitations.token, token))
      .limit(1)
    return row
  })
}

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams
  const session = await getSession()

  if (!token) {
    return (
      <ErrorCard title="Invalid Invitation" description="No token provided." />
    )
  }

  const invitation = await loadInvitation(token).catch(() => null)
  if (!invitation) {
    return (
      <ErrorCard
        title="Invalid Invitation"
        description="Invalid or expired invitation link."
      />
    )
  }
  if (new Date(invitation.expiresAt) < new Date()) {
    return (
      <ErrorCard
        title="Invitation Expired"
        description="This invitation has expired. Please contact LISTD to request a new invitation."
      />
    )
  }
  if (invitation.status === 'accepted') {
    return (
      <ErrorCard
        title="Already Accepted"
        description="This invitation has already been accepted."
      />
    )
  }

  const userRoleSet = new Set(session?.roles ?? [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <AcceptInviteActions
        token={token}
        isSignedIn={!!session}
        isAlreadyClerk={userRoleSet.has('clerk')}
        invitationEmail={invitation.email}
      />
    </div>
  )
}

function ErrorCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild>
            <Link href="/">Go to Home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
