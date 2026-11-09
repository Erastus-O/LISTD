import 'server-only'

/**
 * Email template version registry (M2 #14).
 *
 * Every transactional / notification template the platform sends has a
 * stable identifier — currently the `functionName` we already log at every
 * `getResend().emails.send()` call site — paired with a version string.
 * `logEmail()` ([resend.ts](./resend.ts)) auto-attaches the version to
 * `email_logs.metadata.templateVersion`, so historical records pin the
 * exact template that produced them.
 *
 * **Bump rules** — increment when:
 *   - The HTML body changes in a way that affects what the recipient sees
 *     (copy edit, layout change, new CTA, removed disclaimer)
 *   - A new dynamic field is interpolated into the template
 *   - The subject line changes
 *
 * **Don't bump** for changes that don't reach the recipient (e.g. swapping
 * the in-app notification side, refactoring the handler, adding metadata).
 *
 * Version strings are opaque — semver is overkill. Use `v1`, `v2`, `v3` (or
 * `v2-2026-04-29` if you want a date hint). The audit-log dashboard groups
 * by `(functionName, templateVersion)` for re-send fidelity.
 */
export const EMAIL_TEMPLATE_VERSIONS = {
  // Auth + invites
  'send-password-reset': 'v1',
  'send-clerk-invite': 'v1',
  'send-team-invite': 'v1',
  'send-worker-credentials': 'v1',
  // Billing — invoice lifecycle (Phase 1 of the inbuilt invoice
  // generator, Docs/LISTD_Invoice_Generator_Plan.md).
  'send-invoice': 'v1',

  // Notifications fanned out by the existing notify-* handlers
  'notify-admin': 'v1',
  'notify-invitation-accepted': 'v1',
  'notify-job-completed': 'v1',
  'notify-job-published': 'v1',
  'notify-pre-inspection-ack': 'v1',
  'notify-report-submitted': 'v1',
  'notify-tenant-checkin': 'v1',

  // Marketing / batch
  'send-review-request': 'v1',
  'waitlist': 'v1',

  // Admin-issued
  'admin-clerk-verification': 'v1',

  // Webhook receiver — not a template per se, but it writes audit rows
  // through the same logEmail path; pin a sentinel so the dashboard can
  // distinguish "we sent" vs "Resend told us about a delivery".
  'webhook-resend': 'sentinel',
} as const satisfies Record<string, string>

export type EmailTemplateId = keyof typeof EMAIL_TEMPLATE_VERSIONS

/**
 * Look up the current version for a template id. Returns `null` for unknown
 * ids so the caller can decide to log without a version (vs. throwing —
 * email sends should never fail because of audit metadata).
 */
export function getTemplateVersion(functionName: string): string | null {
  if (functionName in EMAIL_TEMPLATE_VERSIONS) {
    return EMAIL_TEMPLATE_VERSIONS[functionName as EmailTemplateId]
  }
  return null
}

/** All known template ids — useful for the M2 #12 dashboard dropdown. */
export const ALL_TEMPLATE_IDS = Object.keys(EMAIL_TEMPLATE_VERSIONS) as EmailTemplateId[]
