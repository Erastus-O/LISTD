import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import { getSession, type AppRole } from '@/lib/dal'

/** Each role's settings page, in priority order for multi-role users. */
const SETTINGS_BY_ROLE: Array<[AppRole, string]> = [
  ['admin', '/admin/settings'],
  ['clerk', '/clerk/settings'],
  ['cleaner', '/cleaner/settings'],
  ['client', '/client/settings'],
]

/**
 * Chrome for the shared /account pages (notification preferences, password
 * change). They sit outside every role shell, so this gives them a top bar
 * with a way back to the user's own settings.
 *
 * Uses getSession() rather than requireSession(): the forced password reset
 * page must stay reachable while `password_must_change` is set, and
 * requireSession() would redirect it back to itself. Each page does its own
 * auth check.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const settingsHref =
    SETTINGS_BY_ROLE.find(([role]) => session?.roles.includes(role))?.[1] ??
    '/post-signin'

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/post-signin"
              className="font-semibold text-xl font-semibold tracking-tight text-foreground"
            >
              LISTD<span className="text-primary">.</span>Pro
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
            <span className="hidden text-sm text-muted-foreground sm:block">
              Account
            </span>
          </div>
          {session && (
            <div className="flex items-center gap-3">
              <Link
                href={settingsHref}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to settings
              </Link>
              <ProfileAvatar
                url={session.profile?.avatarUrl ?? null}
                name={session.profile?.fullName ?? null}
                emailFallback={session.email}
                size="sm"
              />
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 [&_[data-slot=card]]:rounded-2xl">{children}</main>
    </div>
  )
}
