import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { marketingHomeHref } from '@/lib/hosts'
import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage() {
  const host = (await headers()).get('host')
  return (
    <AuthShell homeHref={marketingHomeHref(host)}>
      <ResetPasswordForm />
    </AuthShell>
  )
}
