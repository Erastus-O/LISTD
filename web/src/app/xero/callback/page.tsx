import { PlaceholderPage } from '@/components/placeholder-page'

/**
 * Xero OAuth callback landing page. Receives `?success=true&tenant=…` or
 * `?error=…` query params from `/api/xero/callback` after the token exchange.
 *
 * Currently a placeholder; the original page parsed the query and showed
 * success/failure copy.
 */
export const metadata = { title: 'Xero · Connection' }

export default function XeroCallbackPage() {
  return (
    <PlaceholderPage
      title="Xero · Callback"
      port="src/pages/XeroCallback.tsx"
    />
  )
}
