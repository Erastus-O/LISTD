import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { getSession } from '@/lib/dal'
import { marketingHomeHref } from '@/lib/hosts'
import { AuthForm } from './auth-form'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default async function AuthPage() {
  // Server-side gate: already-signed-in users skip straight to their landing.
  const session = await getSession()
  if (session) redirect('/post-signin')

  const host = (await headers()).get('host')
  return (
    <AuthShell homeHref={marketingHomeHref(host)}>
      <AuthForm />
    </AuthShell>
  )
}
