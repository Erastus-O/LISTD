import { and, eq, sql } from 'drizzle-orm'
import {
  errorResponse,
  escapeHtml,
  forbidden,
  notFound,
  ok,
  serverError,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  organisationMembers,
  profiles,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 30
export const runtime = 'nodejs'

type Params = Promise<{ userId: string }>

/**
 * POST /api/client/workers/[userId]/resend-invite — owner generates a
 * fresh temp password for an existing worker and emails it to them.
 *
 * Used when the original invite email got lost or filtered. The flow:
 *   1. Permission gate: caller must be the worker's org owner (or admin).
 *   2. Generate a new random temp password.
 *   3. Update the Supabase auth user's password (admin-side).
 *   4. Flip `profiles.password_must_change=true` so the worker is forced
 *      to set their own password on next login.
 *   5. Send the credentials email (template `send-worker-credentials`).
 *   6. Audit `account_status/worker.invite_resent`.
 *
 * The temp password is never persisted anywhere except the auth backend
 * and the in-flight email; it's not written to the audit payload.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { userId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const supabaseAdmin = getSupabaseAdmin()

    // 1. Verify caller is the worker's org owner.
    const [callerMembership] = await withServiceRole(async (tx) =>
      tx
        .select({
          organisationId: organisationMembers.organisationId,
          orgRole: organisationMembers.orgRole,
        })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, session.userId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
    )
    const isAdmin = session.roles.includes('admin')
    if (!isAdmin && (!callerMembership || callerMembership.orgRole !== 'owner')) {
      return forbidden('Only the organisation owner can resend invites.')
    }

    // Verify target is a worker in the same org + grab their profile name.
    const lookup = await withServiceRole(async (tx) => {
      const [target] = await tx
        .select({
          organisationId: organisationMembers.organisationId,
          orgRole: organisationMembers.orgRole,
          fullName: profiles.fullName,
        })
        .from(organisationMembers)
        .leftJoin(profiles, eq(profiles.userId, organisationMembers.userId))
        .where(eq(organisationMembers.userId, userId))
        .limit(1)
      return target ?? null
    })
    if (!lookup) return notFound('Worker not found.')
    if (lookup.orgRole !== 'worker') {
      return forbidden('Target is not a worker in your organisation.')
    }
    if (
      !isAdmin &&
      callerMembership &&
      callerMembership.organisationId !== lookup.organisationId
    ) {
      return forbidden('Worker belongs to a different organisation.')
    }

    // Resolve the worker's email from Supabase auth (not stored on
    // `profiles`). Bail out if Supabase can't find them — that suggests
    // the auth user was deleted manually.
    const lookupAuth = await supabaseAdmin.auth.admin.getUserById(userId)
    const email = lookupAuth.data?.user?.email ?? null
    if (!email) {
      return serverError('Could not resolve worker email from Supabase auth.')
    }

    // 2–4. Generate password, update auth user, flip the must-change flag.
    const tempPassword = generateTempPassword()
    const updated = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
    })
    if (updated.error) {
      return serverError(
        `Could not reset password: ${updated.error.message}`
      )
    }

    await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({ passwordMustChange: true, updatedAt: sql`now()` })
        .where(eq(profiles.userId, userId))
      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'worker.invite_resent',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: userId,
        payload: {
          organisationId: lookup.organisationId,
          emailHint: maskEmail(email),
        },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    // 5. Send the credentials email. Best-effort: the password has already
    //    been rotated above, so throwing a 500 here would leave the worker
    //    locked out behind a generic error with no way to know the email
    //    failed. Report delivery status so the UI can tell the owner exactly
    //    what happened and prompt a retry.
    let emailDelivered = true
    try {
      await sendCredentialsEmail({
        email,
        fullName: lookup.fullName ?? '',
        tempPassword,
        invitedBy: session.userId,
      })
    } catch (err) {
      emailDelivered = false
      console.error('[client/workers/resend-invite] credentials email failed:', err)
    }

    return ok({ success: true, emailDelivered })
  } catch (err) {
    console.error('[client/workers/resend-invite] error:', err)
    return errorResponse(err)
  }
}

/**
 * 16-char cryptographically random temp password with mixed case,
 * digits, and a symbol. Local copy of the helper from
 * `/api/client/workers/invite/route.ts` — both routes own their own
 * generator so a future change in one doesn't accidentally weaken the
 * other.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*'
  const all = upper + lower + digits + symbols
  const required = [
    pickFrom(upper),
    pickFrom(lower),
    pickFrom(digits),
    pickFrom(symbols),
  ]
  const rest = Array.from({ length: 12 }, () => pickFrom(all))
  return shuffle([...required, ...rest]).join('')
}

function pickFrom(charset: string): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return charset[buf[0]! % charset.length]!
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0]! % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const visible = local.length <= 2 ? local[0]! : `${local[0]}${local[1]}`
  return `${visible}***@${domain}`
}

async function sendCredentialsEmail(params: {
  email: string
  fullName: string
  tempPassword: string
  invitedBy: string
}): Promise<void> {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
  const loginUrl = `${origin}/auth?next=${encodeURIComponent('/worker/dashboard')}`
  const safeName = escapeHtml(params.fullName || 'there')
  const safeEmail = escapeHtml(params.email)
  const safePassword = escapeHtml(params.tempPassword)
  const safeUrl = escapeHtml(loginUrl)
  const subject = 'Your LISTD Pro login (resent)'
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:16px;">Hi ${safeName}</h1>
      <p style="color:#555;font-size:16px;line-height:1.5;">A new temporary password has been generated for your LISTD Pro worker account. Use the credentials below to log in : you'll be asked to set a new password straight away.</p>
      <div style="margin:24px 0;padding:16px;border:1px solid #e5e5e5;border-radius:8px;background:#fafafa;">
        <p style="color:#1a1a1a;font-size:14px;margin:0 0 6px;"><strong>Email:</strong> ${safeEmail}</p>
        <p style="color:#1a1a1a;font-size:14px;margin:0;"><strong>Temporary password:</strong> <code style="font-family:Menlo,monospace;background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #e5e5e5;">${safePassword}</code></p>
      </div>
      <div style="margin:32px 0;">
        <a href="${safeUrl}" style="background-color:#22c55e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Log in</a>
      </div>
      <p style="color:#999;font-size:12px;">If you didn't request this, contact your organisation owner : your previous password no longer works.</p>
    </div>
  `.trim()

  const { data, error } = await getResend().emails.send({
    from: FROM_TRANSACTIONAL,
    to: [params.email],
    subject,
    html,
  })

  await logEmail({
    functionName: 'send-worker-credentials',
    recipientEmails: [params.email],
    subject,
    resendId: data?.id ?? null,
    errorMessage: error ? error.message : null,
    metadata: { invitedBy: params.invitedBy, resend: true },
  })
  if (error) throw new Error(`Email delivery failed: ${error.message}`)
}
