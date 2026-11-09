import { redirect } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getSession } from '@/lib/dal'
import { ForcePasswordResetForm } from './_components/force-password-reset-form'

export const metadata = { title: 'Set new password' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Forced password reset page — landed on after `requireSession()` sees
 * `profile.password_must_change=true` (worker invite flow). Calls
 * `getSession()` directly to bypass that guard so the user can actually
 * reach this surface.
 *
 * The `force=1` query param surfaces explanatory copy ("you must set a new
 * password to continue"). Without it, the page is a self-service password
 * change anyone can hit voluntarily.
 */
export default async function ForcePasswordResetPage({ searchParams }: Props) {
  const session = await getSession()
  if (!session) redirect('/login')
  const sp = await searchParams
  const forced =
    sp.force === '1' || !!session.profile?.passwordMustChange

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-10 sm:px-6">
      <Card className="w-full shadow-lg">
        <CardContent className="space-y-5 p-8">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-3xl text-foreground">
              {forced ? 'Set a new password' : 'Change password'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {forced
                ? 'Your account was created with a temporary password. Choose a new password to continue.'
                : 'Pick a new password for your account.'}
            </p>
          </div>
          <ForcePasswordResetForm forced={forced} />
        </CardContent>
      </Card>
    </div>
  )
}
