import { AlertTriangle } from 'lucide-react'

type Reason =
  | 'missing'
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'wrong_scope'
  | 'grace_window_expired'
  | 'rate_limit'

const COPY: Record<Reason, { title: string; body: string }> = {
  missing: {
    title: 'Link is missing',
    body: 'This page needs an access token to load. Use the link your letting agent or property manager sent you.',
  },
  unknown: {
    title: 'Invalid link',
    body: 'We couldn’t find this link. Please ask your letting agent or property manager for a new one.',
  },
  expired: {
    title: 'Link has expired',
    body: 'This access link has expired. Please ask your letting agent or property manager for a new link.',
  },
  revoked: {
    title: 'Link has been revoked',
    body: 'This link is no longer active. Please ask your letting agent or property manager for a new one.',
  },
  wrong_scope: {
    title: 'Access not allowed',
    body: 'Your link doesn’t cover this action. Please ask your letting agent or property manager for an updated link.',
  },
  grace_window_expired: {
    title: 'Link has expired',
    body: 'This link was rotated and the grace window has now closed. Please use the most recent link your letting agent sent you.',
  },
  rate_limit: {
    title: 'Too many requests',
    body: 'You’ve made too many requests in a short time. Please wait a moment and try again.',
  },
}

export function PortalError({ reason }: { reason: Reason }) {
  const copy = COPY[reason]
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="mb-2 text-lg font-semibold text-foreground">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  )
}
